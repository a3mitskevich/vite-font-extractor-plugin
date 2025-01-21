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
  type Logger as LoggerV5,
} from 'vite-5'
import {
  type ResolvedConfig,
} from 'vite'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, rmSync } from 'node:fs'
import type { FontExtractorPlugin, Target, PluginOption } from '../src'
import type { RollupOutput } from 'rollup'

export type InlineConfig = InlineConfigV4 & InlineConfigV5
export type Plugin = PluginV4 & PluginV5
export type ContainerVersion = typeof versionV4 | typeof versionV5
export type Logger = LoggerV5 & LoggerV4
export interface LoggerMessage { type: 'error' | 'warn' | 'info', message: string }
export type FakeLogger = Logger & { messages: LoggerMessage[] }
export type CssMinify = ResolvedConfig['build']['cssMinify']

export function createCachedImport<T> (imp: () => Promise<T>): () => T | Promise<T> {
  let cached: T | Promise<T>
  return async () => {
    if (!cached) {
      cached = imp().then((module) => {
        cached = module
        return module
      })
    }
    return cached
  }
}

export interface BuildOptions {
  pluginOptions?: PluginOption
  customLogger?: FakeLogger
  cache?: false
  fixture?: string
  targets?: string[]
  cssMinify?: CssMinify
}

export interface Font {
  name: string
  urls: string[]
}

export interface Fixture {
  path: string
  fonts: Font[]
  description?: string
}

export const dir = dirname(fileURLToPath(import.meta.url))
export const fixturesDir = join(dir, 'fixtures')

export const getFontSize = (ext: string): number => readFileSync(join(fixturesDir, 'fonts', `font.${ext}`)).length

export const fontsLength = {
  eot: getFontSize('eot'),
  ttf: getFontSize('ttf'),
  woff: getFontSize('woff'),
  woff2: getFontSize('woff2'),
}

export const outDir = join(dir, 'dist')

export const DEFAULT_FONT: Font = {
  name: 'Font Name',
  urls: [
    '../fonts/font.eot',
    '../fonts/font.ttf',
    '../fonts/font.woff',
    '../fonts/font.woff2',
  ],
}

export const createFixture = (name: string, options: Omit<Fixture, 'path'> = {
  fonts: [DEFAULT_FONT],
}): Fixture => ({
  path: join(fixturesDir, name),
  ...options,
})

export const DEFAULT_GOOGLE_FONT = { fonts: [{ name: 'Index', urls: [] }, { name: 'Css font', urls: [] }] }

export const fixtures = {
  'import-css': createFixture('import-css'),
  'import-js': createFixture('import-js'),
  mixins: createFixture('mixins', { fonts: [{ ...DEFAULT_FONT, urls: ['../fonts/font.woff'] }] }),
  plain: createFixture('plain'),
  'plain-html': createFixture('plain-html'),
  'google-font': createFixture('google-font', DEFAULT_GOOGLE_FONT),
  'google-font-warn': createFixture('google-font-warn', DEFAULT_GOOGLE_FONT),
  'font-family-resource-is-url': createFixture('font-family-resource-is-url', { fonts: [{ ...DEFAULT_FONT, urls: [] }] }),
  auto: createFixture('auto'),
} as const

export type FixturesNames = Array<keyof typeof fixtures>

export const importTargets = {
  local: createCachedImport(async () => import('../src')),
  dist: createCachedImport(async () => import('../dist')),
}

export const plugin = async (...args: Parameters<FontExtractorPlugin>): Promise<Plugin> => {
  const testTarget = process.env.TEST_TARGET as keyof typeof importTargets
  const { default: index } = await importTargets[testTarget ?? 'local']()
  return index.apply(null, args)
}

export const generateId = (): string => Math.random().toString(32).slice(2, 10)

export const viteBuild = {
  [versionV4]: buildV4,
  [versionV5]: buildV5,
}

const createLogger = (): FakeLogger => {
  const messages: LoggerMessage[] = []
  return new Proxy({}, {
    get (_: any, key: any): any {
      if (key === 'messages') {
        return messages
      }
      if (['clearScreen', 'hasErrorLogged'].includes(key as string)) {
        return () => false
      }
      return (message: string) => {
        messages.push({ type: key, message })
      }
    },
  }) as FakeLogger
}

export const buildByVersion = async (version: ContainerVersion, options: BuildOptions = {
  fixture: fixtures.plain.path,
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
}) => {
  const id = generateId() + `-V${version}`
  const out = join(outDir, id)

  const targets = options.targets?.map<Target>(fontName => ({
    fontName,
    ligatures: ['close', 'play_arrow'],
  })) ?? []

  const pluginOptions = options.pluginOptions ?? {
    type: 'manual',
    targets,
    cache: options.cache == null ? out : options.cache,
  }

  const FontExtract = await plugin(pluginOptions)
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
      sourcemap: false,
      cssMinify: options.cssMinify,
    },
  }
  const bundle = await viteBuild[version](inlineConfig) as RollupOutput

  rmSync(out, { recursive: true, force: true })

  return {
    output: bundle.output,
    out,
    messages: customLogger.messages,
  }
}
