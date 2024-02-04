import type { Format, MinifyOption } from 'fontext'
import type { InlineConfig, Logger, LogType, ResolveFn, Plugin } from 'vite'

export type Target = Omit<MinifyOption, 'formats'>

export interface PluginCommonConfig {
  cache?: string | boolean
  apply?: Plugin['apply']
  logLevel?: InlineConfig['logLevel']
}

export interface PluginManualOption {
  type: 'manual'
  targets: Target[] | Target
  ignore?: string[]
}

export interface PluginAutoOption {
  type: 'auto'
  targets?: Target[] | Target
  ignore?: string[]
}

export type PluginOption = PluginCommonConfig & (PluginAutoOption | PluginManualOption)

export interface ResourceTransformMeta {
  alias: string
  name: string
  sid: string
}

export interface ImportResolvers {
  common: ResolveFn
}

export interface OptionsWithCacheSid {
  sid: string
  target: Target
}

export interface FontMeta {
  name: string
  options: OptionsWithCacheSid
}

export interface GoogleFontMeta extends FontMeta {
  url: URL
}

export interface FontFaceMeta extends FontMeta {
  face: string
  aliases: string[]
}

export interface MinifyFontOptions {
  source?: Buffer | string
  url: string
  importer?: string
  extension: Format
}

export type InternalLogger = Pick<Logger, LogType> & { fix: () => void }

export type StyledFn = (message: string) => string
export type StyleMessage<K extends string> = { [key in K | string]: StyledFn }
type ReadonlyMap<K, V> = Pick<Map<K, V>, 'get' | 'has'>

export type TargetOptionsMap = ReadonlyMap<Target['fontName'], OptionsWithCacheSid>
