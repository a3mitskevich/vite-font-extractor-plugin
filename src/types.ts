import {OutputAsset} from "rollup";
import {MinifyOption} from "fontext";

export interface PotentialReplacementFile extends OutputAsset {
    source: string,
}

export type Target = Omit<MinifyOption, 'formats'>

export interface ExtractInfo {
    fonts: OutputAsset[],
    option: Target,
}

export interface PluginOption {
    targets: Target[] | Target,
}
