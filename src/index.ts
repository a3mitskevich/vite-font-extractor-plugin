import FontExtractor from './extractor'
export type { PluginOption, Target } from './types'

type FontExtractorPlugin = typeof FontExtractor

export { FontExtractor as default, FontExtractor, type FontExtractorPlugin }
