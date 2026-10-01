import FontExtractor from "./extractor";
export type { FaceMatcher, FontFaceInfo, PluginOption, Target } from "./types";

type FontExtractorPlugin = typeof FontExtractor;

export { FontExtractor as default, FontExtractor, type FontExtractorPlugin };
