import type { Format, MinifyOption } from 'fontext'
import type { InlineConfig, Logger, LogType, ResolveFn, Plugin } from 'vite'

export type Target = Omit<MinifyOption, 'formats'>

export interface PluginOption {
  targets: Target[] | Target
  cache?: string | boolean
  apply?: Plugin['apply']
  logLevel?: InlineConfig['logLevel']
}

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
  face: string
  aliases: string[]
  options: OptionsWithCacheSid
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
