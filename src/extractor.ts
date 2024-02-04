import { isCSSRequest, type Plugin, send } from 'vite'
import type { OutputAsset, RollupError, TransformPluginContext } from 'rollup'
import { basename, isAbsolute } from 'node:path'
import { extract, type ExtractedResult, type Format } from 'fontext'
import {
  type FontFaceMeta,
  type GoogleFontMeta,
  type ImportResolvers,
  type InternalLogger,
  type MinifyFontOptions,
  type OptionsWithCacheSid,
  type PluginOption,
  type ResourceTransformMeta,
  type Target,
  type TargetOptionsMap,
} from './types'
import Cache from './cache'
import {
  createResolvers,
  intersection,
  exists,
  extractFontFaces,
  extractFontName,
  extractFonts,
  extractGoogleFontsUrls,
  getFontExtension,
  getHash,
  mergePath, findUnicodeGlyphs, escapeString,
} from './utils'
import { readFileSync } from 'node:fs'
import {
  PLUGIN_NAME,
  PROCESS_EXTENSION,
  SUPPORT_START_FONT_REGEX,
  SUPPORTED_RESULTS_FORMATS,
} from './constants'
import styler from './styler'
import { createInternalLogger } from './internal-loger'
import groupBy from 'lodash.groupby'
import camelcase from 'lodash.camelcase'

export default function FontExtractor (pluginOption: PluginOption = { type: 'auto' }): Plugin {
  const mode: PluginOption['type'] = pluginOption.type ?? 'manual'
  let cache: Cache | null
  let importResolvers: ImportResolvers
  let logger: InternalLogger

  let isServe: boolean = false
  const fontServeProxy = new Map<string, {
    extension: Format
    content: Buffer
  }>()

  const autoTarget: Required<Target> = {
    fontName: '[auto detected font name]',
    raws: [],
    withWhitespace: true,
    ligatures: [],
  }

  const autoProxyOption = new Proxy<OptionsWithCacheSid>({
    sid: '[calculating...]',
    target: autoTarget,
  }, {
    get (_: OptionsWithCacheSid, key: keyof OptionsWithCacheSid): any {
      if (key === 'sid') {
        return JSON.stringify(autoTarget)
      }
      if (key === 'target') {
        return autoTarget
      }
    },
  })

  const targets = pluginOption.targets
    ? Array.isArray(pluginOption.targets) ? pluginOption.targets : [pluginOption.targets]
    : []

  const casualOptionsMap = new Map(
    targets.map(target => [target.fontName, { sid: JSON.stringify(target), target }]),
  )

  const optionsMap = {
    get: (key: string) => {
      const option = casualOptionsMap.get(key)
      return mode === 'auto' ? option ?? autoProxyOption : option
    },
    has: (key: string) => mode === 'auto' || casualOptionsMap.has(key),
  } satisfies TargetOptionsMap

  const progress = new Map<string, string>()
  const transformMap = new Map<string, string>()

  const changeResource = function (
    this: TransformPluginContext,
    code: string,
    transform: ResourceTransformMeta,
  ): string {
    const sid = getHash(transform.sid)
    const assetUrlRE = /__VITE_ASSET__([\w$]+)__(?:\$_(.*?)__)?/g
    const oldReferenceId = assetUrlRE.exec(transform.alias)![1]
    const referenceId = this.emitFile({
      type: 'asset',
      name: transform.name + PROCESS_EXTENSION,
      source: Buffer.from(sid + oldReferenceId),
    })
    transformMap.set(oldReferenceId, referenceId)
    // TODO: rework to generate new url strings by config instead replace a old reference id
    return code.replace(transform.alias, transform.alias.replace(oldReferenceId, referenceId))
  }

  const getSourceByUrl = async (url: string, importer?: string): Promise<Buffer | null> => {
    const entrypointFilePath = isAbsolute(url)
      ? url
      : await importResolvers.common(url, importer)

    if (!entrypointFilePath) {
      logger.warn(`Can not resolve entrypoint font by url: ${styler.path(url)}`)
      return null
    }

    return readFileSync(entrypointFilePath)
  }

  const processMinify = async (
    fontName: string,
    fonts: MinifyFontOptions[],
    options: OptionsWithCacheSid,
  ): Promise<ExtractedResult | null> => {
    const unsupportedFont = fonts.find(font => !SUPPORTED_RESULTS_FORMATS.includes(font.extension))
    if (unsupportedFont) {
      logger.error(`Font face has unsupported extension - ${unsupportedFont.extension ?? 'undefined'}`)
      return null
    }

    const entryPoint = fonts.find(font => SUPPORT_START_FONT_REGEX.test(font.extension))

    if (!entryPoint) {
      logger.error('No find supported fonts file extensions for extracting process')
      return null
    }

    const sid = options.sid
    const cacheKey = camelcase(fontName) + '-' + getHash(sid + entryPoint.url)

    const needExtracting = fonts.some(font => !cache?.check(cacheKey + `.${font.extension}`))

    const minifiedBuffers: ExtractedResult = { meta: [] }

    if (needExtracting) {
      if (cache) {
        logger.info(`Clear cache for ${fontName} because some files have a different content`)
        cache.clearCache(fontName)
      }

      const source = entryPoint.source ?? await getSourceByUrl(entryPoint.url, entryPoint.importer)

      if (!source) {
        logger.error(`No found source for ${fontName}:${styler.path(entryPoint.url)}`)
        return null
      }

      const minifyResult = await extract(
        Buffer.from(source),
        {
          ...options.target,
          fontName,
          formats: fonts.map(font => font.extension),
        },
      )
      Object.assign(minifiedBuffers, minifyResult)

      if (cache) {
        fonts.forEach(font => {
          const minifiedBuffer = minifyResult[font.extension]
          if (minifiedBuffer) {
            logger.info(`Save a minified buffer for ${fontName} to cache`)
            cache!.set(cacheKey + `.${font.extension}`, minifiedBuffer)
          }
        })
      }
    } else {
      logger.info(`Get minified fonts from cache for ${fontName}`)
      const cacheResult = Object.fromEntries(
        fonts.map(font => [font.extension, cache!.get(cacheKey + `.${font.extension}`)]),
      )
      Object.assign(minifiedBuffers, cacheResult)
    }

    return minifiedBuffers
  }

  const checkFontProcessing = (name: string, id: string): void | never => {
    const duplicateId = progress.get(name)

    if (duplicateId) {
      const placeInfo = `Font placed in "${styler.path(id)}" and "${styler.path(duplicateId)}"`
      const errorMessage = `Plugin not support a multiply files with same font name [${name}]. ${placeInfo}`
      // TODO: have chance to conflict by `unicode-range` attribute. Fix it
      logger.error(errorMessage)
      throw new Error(errorMessage)
    } else {
      progress.set(name, id)
    }
  }

  const processFont = async function (
    this: TransformPluginContext,
    code: string,
    id: string,
    font: FontFaceMeta,
  ): Promise<string> {
    checkFontProcessing(font.name, id)
    if (isServe) {
      if (mode === 'auto') {
        logger.warn('Serve minification disabled in "auto" mode')
        return code
      }

      const minifiedBuffers = await processMinify(
        font.name,
        font.aliases.map<MinifyFontOptions>(url => ({
          url,
          importer: id,
          extension: getFontExtension(url),
        })),
        font.options,
      )
      if (minifiedBuffers) {
        font.aliases.forEach(url => {
          const extension = getFontExtension(url)
          fontServeProxy.set(url, {
            extension,
            content: minifiedBuffers[extension]!,
          })
        })
      }
    } else {
      if (mode === 'auto') {
        const message = `"auto" mod detected. "${font.name}" font` +
          ' is stubbed and result file hash will be recalculated randomly that may potential problem with external cache systems.' +
          ' If this font is not target please add it to ignore'
        logger.warn(message)
      }
      font.aliases.forEach(alias => {
        code = changeResource.call(
          this,
          code,
          {
            alias,
            name: font.name,
            // TODO: must be reworked
            sid: mode === 'auto' ? Math.random().toString() : font.options.sid,
          },
        )
      })
    }
    return code
  }

  const processGoogleFontUrl = function (
    this: TransformPluginContext,
    code: string,
    id: string,
    font: GoogleFontMeta,
  ): string {
    checkFontProcessing(font.name, id)
    const oldText = font.url.searchParams.get('text')
    if (oldText) {
      logger.warn(`Font [${font.name}] in ${id} has duplicated logic for minification`)
    }
    const text = [oldText, ...font.options.target.ligatures ?? []]
      .filter(exists)
      .join(' ')
    const originalUrl = font.url.toString()
    const fixedUrl = new URL(originalUrl)
    fixedUrl.searchParams.set('text', text)
    return code.replace(originalUrl, fixedUrl.toString())
  }

  return {
    name: PLUGIN_NAME,
    configResolved (config) {
      logger = createInternalLogger(pluginOption.logLevel ?? config.logLevel, config.customLogger)
      logger.fix()
      logger.info(`Plugin starts in "${mode}" mode`)

      const intersectionIgnoreWithTargets = intersection(pluginOption.ignore ?? [], targets.map(target => target.fontName))
      if (intersectionIgnoreWithTargets.length) {
        logger.warn(`Ignore option has intersection with targets: ${intersectionIgnoreWithTargets.toString()}`)
      }

      importResolvers = createResolvers(config)

      if (pluginOption.cache) {
        const cachePath = (typeof pluginOption.cache === 'string' && pluginOption.cache) || 'node_modules'
        const resolvedPath = isAbsolute(cachePath) ? cachePath : mergePath(config.root, cachePath)
        cache = new Cache(resolvedPath)
      }
    },
    configureServer (server) {
      isServe = true
      server.middlewares.use((req, res, next) => {
        const url = req.url!
        const stub = fontServeProxy.get(url)
        if (stub) {
          logger.fix()
          logger.info(`Stub server response for: ${styler.path(url)}`)
          send(req, res, stub.content, `font/${stub.extension}`, { headers: server.config.server.headers })
        } else {
          next()
        }
      })
    },
    async transform (code, id) {
      logger.fix()

      const isCssFile = isCSSRequest(id)
      const isAutoType = mode === 'auto'
      const isCssFileWithFontFaces = isCssFile && code.includes('@font-face')

      if (isAutoType && isCssFile) {
        const glyphs = findUnicodeGlyphs(code)
        autoTarget.raws.push(...glyphs)
      }
      if (
        (id.endsWith('.html') || (isCssFile && code.includes('@import'))) &&
          code.includes('fonts.googleapis.com')
      ) {
        const googleFonts = extractGoogleFontsUrls(code)
          .map<GoogleFontMeta | null>(raw => {
          const url = new URL(raw)
          const name = url.searchParams.get('family')
          if (pluginOption.ignore?.includes(name!)) {
            return null
          }
          if (!name) {
            logger.warn(`No specified google font name in ${styler.path(id)}`)
            return null
          }
          if (name.includes('|')) {
            // TODO: add extracting font url with minification
            logger.warn('Google font url includes multiple families. Not supported')
            return null
          }

          const options = optionsMap.get(name)
          if (!options) {
            logger.warn(`Font "${name}" has no minify options`)
            return null
          }

          return {
            name,
            options,
            url,
          }
        })
          .filter(exists)

        for (const font of googleFonts) {
          try {
            code = processGoogleFontUrl.call(this, code, id, font)
          } catch (e) {
            logger.error(`Process ${font.name} Google font is failed`, { error: e as Error })
          }
        }
      }
      if (isCssFileWithFontFaces) {
        const fonts = extractFontFaces(code)
          .map<FontFaceMeta | null>(face => {
          const name = extractFontName(face)
          if (pluginOption.ignore?.includes(name)) {
            return null
          }
          const options = optionsMap.get(name)

          if (!options) {
            logger.warn(`Font "${name}" has no minify options`)
            return null
          }

          const aliases = extractFonts(face)

          const urlSources = aliases.filter(alias => alias.startsWith('http'))
          if (urlSources.length) {
            logger.warn(`Font "${name}" has external url sources: ${urlSources.toString()}`)
            return null
          }

          return {
            name,
            face,
            aliases,
            options,
          }
        })
          .filter(exists)
        for (const font of fonts) {
          try {
            code = await processFont.call(this, code, id, font)
          } catch (e) {
            logger.error(`Process ${font.name} local font is failed`, { error: e as Error })
          }
        }
      }
      return code
    },
    async generateBundle (_, bundle) {
      if (!transformMap.size) {
        return
      }
      logger.fix()
      try {
        const findAssetByReferenceId = (referenceId: string): OutputAsset =>
          Object.values(bundle).find(
            asset => asset.fileName.includes(this.getFileName(referenceId)),
          ) as OutputAsset

        const resources = Array.from(transformMap.entries())
          .map<[OutputAsset, OutputAsset]>(([oldReferenceId, newReferenceId]) => {
          return [
            findAssetByReferenceId(oldReferenceId),
            findAssetByReferenceId(newReferenceId),
          ]
        })

        const unminifiedFonts = groupBy(
          resources.filter(([_, newFont]) => newFont.fileName.endsWith(PROCESS_EXTENSION)),
          ([_, newFont]) => newFont.name!.replace(PROCESS_EXTENSION, ''),
        )

        const stringAssets: Array<{ source: string, fileName: string }> = Object.values(bundle)
          .filter(asset => asset.type === 'asset' && typeof asset.source === 'string') as any

        await Promise.all(Object.entries(unminifiedFonts)
          .map(async ([fontName, transforms]) => {
            const minifiedBuffer = await processMinify(
              fontName,
              transforms.map<MinifyFontOptions>(([originalFont, newFont]) => ({
                extension: getFontExtension(originalFont.fileName),
                source: Buffer.from(originalFont.source),
                url: '',
              })),
              optionsMap.get(fontName)!,
            )

            transforms.forEach(([originalFont, newFont]) => {
              const extension = getFontExtension(originalFont.fileName)
              const fixedName = originalFont.name ? basename(originalFont.name, `.${extension}`) : camelcase(fontName)
              const temporalNewFontFilename = newFont.fileName
              const fixedBasename = (basename(newFont.fileName, PROCESS_EXTENSION) + `.${extension}`)
                .replace(fontName, fixedName)
              newFont.name = fixedName + `.${extension}`
              newFont.fileName = newFont.fileName.replace(basename(temporalNewFontFilename), fixedBasename)

              const temporalNewFontBasename = escapeString(temporalNewFontFilename)

              stringAssets.forEach(asset => {
                if (asset.source.includes(temporalNewFontBasename)) {
                  logger.info(`Change name from "${temporalNewFontBasename}" to ${newFont.fileName} in ${asset.fileName}`)
                  asset.source = asset.source.replace(temporalNewFontBasename, newFont.fileName)
                }
              })

              newFont.source = minifiedBuffer?.[extension] ?? Buffer.alloc(0)
            })
          }))

        resources.forEach(([originalFont, newFont]) => {
          const originalBuffer = Buffer.from(originalFont.source)
          const newLength = newFont.source.length
          const originalLength = originalBuffer.length
          const resultLessThanOriginal = newLength > 0 && newLength < originalLength

          if (!resultLessThanOriginal) {
            const comparePreview = styler.red(`[${newLength} < ${originalLength}]`)
            logger.warn(`New font no less than original ${comparePreview}. Revert content to original font`)
            newFont.source = originalBuffer
          }
          logger.info(`Delete old asset from: ${styler.path(originalFont.fileName)}`)
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete bundle[originalFont.fileName]
        })
      } catch (error) {
        logger.error('Clean up generated bundle is filed', { error: error as RollupError })
      }
    },
  }
}
