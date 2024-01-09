import { isCSSRequest, type Plugin, type TransformResult } from 'vite'
import type { OutputAsset, TransformPluginContext, RollupError } from 'rollup'
import { isAbsolute, basename } from 'node:path'
import {
  type ExtractedResult,
  type Format,
  extract,
} from 'fontext'
import type { PluginOption, Target } from './types'
import { Cache } from './cache'
import { mergePath, getHash, getFontExtension } from './utils'

const FONT_URL_REGEX = /url\(['"]?(.*?)['"]?\)/g
const FONT_FAMILY_RE = /font-family:\s*(.*?);/
const SUPPORT_START_FONT_REGEX = /\.(otf|ttf|woff|woff2|ttc|dfont)$/
const FONT_FACE_BLOCK_REGEX = /@font-face\s*{([\s\S]*?)}/

const extractFonts = (fontFaceString: string): string[] => {
  const fonts = []
  let match = null
  FONT_URL_REGEX.lastIndex = 0
  while ((match = FONT_URL_REGEX.exec(fontFaceString))) {
    const url = match[1]
    if (url) {
      fonts.push(url)
    }
  }
  return fonts
}

const extractFontFace = (code: string): string => {
  const [fontFaceString] = FONT_FACE_BLOCK_REGEX.exec(code)!
  return fontFaceString
}

const extractFontName = (fontFaceString: string): string => {
  const fontName = FONT_FAMILY_RE.exec(fontFaceString)?.[1]
  return fontName?.replace(/["']/g, '') ?? ''
}

export default function FontExtractor (pluginOption: PluginOption): Plugin {
  const sid = getHash(JSON.stringify(pluginOption))
  let cache: Cache | null
  const targets = Array.isArray(pluginOption.targets) ? pluginOption.targets : [pluginOption.targets]
  const optionsMap = new Map<Target['fontName'], Target>(
    targets.map(target => [target.fontName, target]),
  )

  const progress = new Set<string>()
  const transformMap = new Map<string, Map<string, string>>()

  const tryTransform = async function (this: TransformPluginContext, result: TransformResult, originalCode: string): Promise<TransformResult> {
    let code = result?.code || ''
    if (!FONT_FACE_BLOCK_REGEX.test(code)) {
      return result
    }
    const resultFontFace = extractFontFace(result.code)
    const originalFontFace = extractFontFace(originalCode)
    const fontName = extractFontName(resultFontFace)
    const resultFonts = extractFonts(resultFontFace)
    const originalFonts = extractFonts(originalFontFace)

    if (resultFonts.length !== originalFonts.length) {
      this.error('Resulted font face not equals with original')
    }

    const fonts = resultFonts.map((resultFont, index) => ({
      viteAlias: resultFont,
      originalUrl: originalFonts[index],
    }))

    if (!optionsMap.has(fontName)) {
      return result
    }

    if (progress.has(fontName)) {
      this.error('Multiply fonts files! Pls contact with developer for resolve it case!')
    } else {
      progress.add(fontName)
    }
    // TODO: replace extracting to here
    // TODO: add split mechanics by unicode
    const fontNameTransformMap = new Map<string, string>()
    fonts.forEach(font => {
      const assetUrlRE = /__VITE_ASSET__([\w$]+)__(?:\$_(.*?)__)?/g
      const oldReferenceId = assetUrlRE.exec(font.viteAlias)![1]
      const referenceId = this.emitFile({
        type: 'asset',
        name: basename(font.originalUrl),
        source: sid + oldReferenceId,
      })
      fontNameTransformMap.set(oldReferenceId, referenceId)
      // TODO: rework to generate new url strings by config instead replace a old reference id
      code = code.replace(font.viteAlias, font.viteAlias.replace(oldReferenceId, referenceId))
    })
    transformMap.set(fontName, fontNameTransformMap)

    return {
      ...result,
      code,
    }
  }

  const hijackPluginTransformHook = (plugin?: Plugin): void => {
    if (!plugin?.transform) {
      throw new Error(`Target plugin (${plugin?.name}) not contain a transform hook`)
    }

    const originalFn = typeof plugin.transform === 'function' ? plugin.transform : plugin.transform.handler

    const wrappedFn: Plugin['transform'] = async function (this: TransformPluginContext, ...args) {
      const [code, id] = args
      const result = await originalFn.apply(this, args) as TransformResult
      if (isCSSRequest(id)) {
        return tryTransform.call(this, result, code)
      }
      return result
    }

    if (typeof plugin.transform === 'function') {
      plugin.transform = wrappedFn
    } else {
      plugin.transform = {
        ...plugin.transform,
        handler: wrappedFn,
      }
    }
  }

  return {
    name: 'vite-font-extractor-plugin',
    apply: 'build',
    configResolved (config) {
      if (pluginOption.cache) {
        const cachePath = (typeof pluginOption.cache === 'string' && pluginOption.cache) || 'node_modules'
        cache = new Cache(sid, isAbsolute(cachePath) ? cachePath : mergePath(config.root, cachePath))
      }

      const viteCssPlugin = config.plugins.find(plugin => plugin.name === 'vite:css')
      hijackPluginTransformHook(viteCssPlugin)
    },
    async generateBundle (_, bundle) {
      if (cache) {
        if (pluginOption.cache) {
          this.debug(`Cache created in - ${cache.path}`)
        } else {
          this.debug('Cache cleaned and destroyed')
          cache.clearCache()
          cache = null
        }
      }
      try {
        const findAssetByReferenceId = (referenceId: string): OutputAsset =>
          Object.values(bundle).find(asset => asset.fileName.includes(this.getFileName(referenceId))) as OutputAsset

        const fontsTransformQueues = Array.from(transformMap.entries())
          .map(([fontName, map]) => Array.from(map.entries())
            .map(([oldReferenceId, newReferenceId]) => ({
              old: findAssetByReferenceId(oldReferenceId),
              new: findAssetByReferenceId(newReferenceId),
              cache: !!cache?.check(newReferenceId),
              cacheKey: newReferenceId,
              fontName,
            }),
            ))

        await Promise.all(fontsTransformQueues.map(async transformQueue => {
          const entryPoint = transformQueue.find(transform => SUPPORT_START_FONT_REGEX.test(transform.old.fileName))
          if (!entryPoint) {
            this.error('No find supported fonts file extensions for extracting process')
          }
          const option = optionsMap.get(entryPoint.fontName)!

          const needExtracting = transformQueue.some(transform => !transform.cache) || !cache

          const minifiedBuffers: ExtractedResult = {
            meta: [],
          }

          if (needExtracting) {
            if (cache) {
              this.debug('Clear cache because some files have a different content')
              cache.clearCache()
            }

            const result = await extract(Buffer.from(entryPoint.old.source), {
              ...option,
              formats: transformQueue.map<Format>(transform => getFontExtension(transform.old.fileName)),
            })
            Object.assign(minifiedBuffers, result)
          }

          transformQueue.forEach(transform => {
            const extension: Format = getFontExtension(transform.old.fileName)

            const minifiedBuffer = needExtracting
              ? minifiedBuffers[extension]
              : cache?.get(transform.cacheKey)

            if (cache && needExtracting && minifiedBuffer) {
              this.debug('Save a minified font buffer to cache')
              cache.set(transform.cacheKey, minifiedBuffer)
            }

            const originalBuffer = Buffer.from(transform.old.source)
            const resultLessThanOriginal = minifiedBuffer && minifiedBuffer.length < originalBuffer.length

            if (resultLessThanOriginal) {
              Object.keys(bundle).forEach(key => {
                if (key.includes(transform.old.fileName)) {
                  this.debug(`delete ${key}`)
                  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                  delete bundle[key]
                }
              })
            }
            transform.new.source = resultLessThanOriginal ? minifiedBuffer : originalBuffer
          })
        }))
      } catch (error) {
        this.error(error as RollupError)
      }
    },
  }
}
