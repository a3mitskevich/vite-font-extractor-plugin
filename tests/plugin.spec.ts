import {
  build as buildV4,
  type InlineConfig as InlineConfigV4,
  version as versionV4,
  type Plugin as PluginV4,
  type Logger as LoggerV4,
} from 'vite-4'
import {
  build as buildV5,
  type InlineConfig as InlineConfigV5,
  version as versionV5,
  type Plugin as PluginV5,
  type Logger as LoggerV5, type ResolvedConfig,
} from 'vite'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Target, FontExtractorPlugin } from '../src'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import type { OutputAsset, RollupOutput } from 'rollup'
import { createCachedImport } from './utils'

type InlineConfig = InlineConfigV5 & InlineConfigV4
type Plugin = PluginV4 & PluginV5
type ContainerVersion = typeof versionV4 | typeof versionV5
type Logger = LoggerV5 & LoggerV4
interface LoggerMessage { type: string, message: string }
type FakeLogger = Logger & { messages: LoggerMessage[] }
type CssMinify = ResolvedConfig['build']['cssMinify']

interface BuildOptions {
  customLogger?: FakeLogger
  cache?: false
  fixture?: string
  targets?: string[]
  cssMinify?: CssMinify
}

interface Font {
  name: string
  urls: string[]
}

interface Fixture {
  path: string
  fonts: Font[]
  description?: string
}

const dir = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(dir, 'fixtures')

const getFontSize = (ext: string): number => readFileSync(join(fixturesDir, 'fonts', `font.${ext}`)).length

const fontsLength = {
  eot: getFontSize('eot'),
  ttf: getFontSize('ttf'),
  woff: getFontSize('woff'),
  woff2: getFontSize('woff2'),
}

const outDir = join(dir, 'dist')

const DEFAULT_FONT: Font = {
  name: 'FontName',
  urls: [
    '../fonts/font.eot',
    '../fonts/font.ttf',
    '../fonts/font.woff',
    '../fonts/font.woff2',
  ],
}

const createFixture = (name: string, options: Omit<Fixture, 'path'> = {
  fonts: [DEFAULT_FONT],
}): Fixture => ({
  path: join(fixturesDir, name),
  ...options,
})

const fixtures = {
  'import-css': createFixture('import-css'),
  'import-js': createFixture('import-js'),
  mixins: createFixture('mixins', { fonts: [{ ...DEFAULT_FONT, urls: ['../fonts/font.woff'] }] }),
  plain: createFixture('plain'),
  'plain-html': createFixture('plain-html'),
} as const

type FixturesNames = Array<keyof typeof fixtures>

const importTargets = {
  local: createCachedImport(async () => import('../src')),
  dist: createCachedImport(async () => import('../dist')),
}

const plugin = async (...args: Parameters<FontExtractorPlugin>): Promise<Plugin> => {
  const testTarget = process.env.TEST_TARGET as keyof typeof importTargets
  const { default: index } = await importTargets[testTarget ?? 'local']()
  return index.apply(null, args)
}

const generateId = (): string => Math.random().toString(32).slice(2, 10)

const viteBuild = {
  [versionV5]: buildV5,
  [versionV4]: buildV4,
}

const createLogger = (): FakeLogger => {
  const messages: LoggerMessage[] = []
  return new Proxy({}, {
    get (target: any, key: string): any {
      if (key === 'messages') {
        return messages
      }
      if (['clearScreen', 'hasErrorLogged'].includes(key)) {
        return () => false
      }
      return (message: string) => {
        messages.push({ type: key, message })
      }
    },
  }) as FakeLogger
}

describe('Plugin', () => {
  const sources = new Set<string>()

  afterAll(() => {
    sources.forEach(path => {
      rmSync(path, { recursive: true, force: true })
    })
  })

  const buildByVersion = async (version: ContainerVersion, options: BuildOptions = {
    fixture: fixtures.plain.path,
  }) => {
    const id = generateId() + `-V${version}`
    const out = join(outDir, id)

    const targets = options.targets?.map<Target>(fontName => ({
      fontName,
      ligatures: ['close'],
    })) ?? []

    const FontExtract = await plugin({
      targets,
      cache: options.cache == null ? out : options.cache,
    })
    const customLogger = options.customLogger ?? createLogger()
    const inlineConfig: InlineConfig = {
      root: options.fixture,
      configFile: false,
      // No affect custom logger
      logLevel: 'silent',
      customLogger,
      plugins: [
        FontExtract,
      ],
      build: {
        outDir: out,
        emptyOutDir: true,
        cssMinify: options.cssMinify,
      },
    }
    const bundle = await viteBuild[version](inlineConfig) as RollupOutput

    sources.add(out)

    return {
      output: bundle.output,
      out,
      messages: customLogger.messages,
    }
  }

  const runTests = (version: ContainerVersion, fixturesNames: FixturesNames) => {
    describe(`Test for vite@${version}`, () => {
      fixturesNames.forEach((fixtureName) => {
        const fixture = fixtures[fixtureName]
        Array.from(['lightningcss', 'esbuild'] as CssMinify[]).forEach(cssMinify => {
          describe(`Build test for ${fixtureName} fixture with ${cssMinify} css minification`, () => {
            const build = async (options?: BuildOptions) => buildByVersion(version, {
              ...options,
              fixture: fixture.path,
              targets: fixture.fonts.map(font => font.name),
            })

            it('should return a bundle with minified fonts', async () => {
              const { out, output } = await build()
              expect(existsSync(out)).toBeTruthy()
              const fontAssets = output
                .filter((asset): asset is OutputAsset => asset.type === 'asset' && asset.fileName.includes('font-'))

              expect(fontAssets).toHaveLength(fixture.fonts.flatMap(font => font.urls).length)

              fontAssets
                .map<OutputAsset>(asset => asset)
                .forEach(asset => {
                  const ext = extname(asset.name).slice(1)
                  expect(asset.source.length < fontsLength[ext]).toBeTruthy()
                })
            })

            it('should correct log', async () => {
              const { messages } = await build()
              const hasCacheMessage = messages.some(({ message }) => message.includes('Save a minified buffer for'))
              const hasDeleteOldFontMessage = messages.some(({ message }) => message.includes('Delete old redundant asset from:'))
              const hasErrorMessages = messages.some(({ type }) => type === 'error')
              expect(hasCacheMessage).toBeTruthy()
              expect(hasDeleteOldFontMessage).toBeTruthy()
              expect(hasErrorMessages).toBeFalsy()
            })

            it('should not contain cache messages', async () => {
              const { messages } = await build({ cache: false })
              const hasCacheMessage = messages.some(({ message }) => message.includes('Save a minified buffer for'))
              expect(hasCacheMessage).toBeFalsy()
            })
          })
        })
      })
    })
  }

  const runAllTests = () => {
    Object.keys(viteBuild).forEach(version => { runTests(version, Object.keys(fixtures) as FixturesNames) })
  }

  runAllTests()
  // runTests(versionV4, ['plain-html']) // for single debug
})
