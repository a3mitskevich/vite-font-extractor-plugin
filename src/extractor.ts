import {type Plugin} from 'vite'
import type {OutputAsset, OutputBundle, OutputChunk} from 'rollup'
import {type Dictionary, groupBy} from 'lodash'
import path from 'node:path';
import extract, { Format } from 'fontext';
import type {ExtractInfo, PotentialReplacementFile, PluginOption, Target} from "./types";


const FONT_REGEX = /\.(eot|ttf|woff|woff2)$/;
const SUPPORT_START_FONT_REGEX = /\.(otf|ttf|woff|woff2|ttc|dfont)$/;

function byFontName(asset: OutputAsset): string {
    const extension = path.extname(asset.name);
    return path.basename(asset.name, extension);
}

function getFontExtension(fontFileName: string): Format {
    return path.extname(fontFileName).slice(1) as Format;
}

function isFont(asset: OutputAsset | OutputChunk): boolean {
    return asset.type === 'asset' && FONT_REGEX.test(asset.fileName)
}

function findFonts(bundle: OutputBundle): Dictionary<OutputAsset[]> {
    const fonts = Object.values(bundle).filter(isFont) as OutputAsset[];
    return groupBy(fonts, byFontName);
}

function generateExtractInfo(bundle: OutputBundle, extractOptions: Target[]): ExtractInfo[] {
    const fontsGroup = findFonts(bundle);
    return extractOptions.reduce((acc, option) => {
        const fonts = fontsGroup[option.fontName];
        if (fonts) {
            acc.push({fonts, option})
        }
        return acc;
    }, []);
}

function getPotentialReplacementFiles(bundle: OutputBundle): PotentialReplacementFile[] {
    return Object.values(bundle)
        .filter(asset => asset.type === 'asset' && typeof asset.source === 'string') as PotentialReplacementFile[];
}

export default function FontExtractor(pluginOption: PluginOption): Plugin {
    return {
        name: 'vite-font-extractor-plugin',
        apply: 'build',
        async generateBundle(_, bundle) {
            try {
                const targets = Array.isArray(pluginOption.targets) ? pluginOption.targets : [pluginOption.targets];
                const extractInfos = generateExtractInfo(bundle, targets);
                const potentialReplacementFiles = getPotentialReplacementFiles(bundle);
                for (const {fonts, option} of extractInfos) {
                    const supportedFont = fonts.find(font => SUPPORT_START_FONT_REGEX.test(font.name))
                    const minifiedBuffers = await extract(Buffer.from(supportedFont.source), {
                        ...option,
                        formats: fonts.map(font => getFontExtension(font.fileName)),
                    });
                    fonts.forEach(fontAsset => {
                        const extension = getFontExtension(fontAsset.fileName);
                        const minifiedBuffer = minifiedBuffers[extension];
                        if (minifiedBuffer.length < fontAsset.source.length) {
                            const referenceId = this.emitFile({
                                type: 'asset',
                                name: fontAsset.name,
                                needsCodeReference: fontAsset.needsCodeReference,
                                source: minifiedBuffer,
                            });
                            const newFileName = this.getFileName(referenceId);
                            potentialReplacementFiles.forEach(asset => {
                                asset.source = asset.source.replace(fontAsset.fileName, newFileName);
                            })
                            delete bundle[fontAsset.fileName];
                        }
                    })
                }
            } catch (error) {
                this.error(error);
            }
        },
    }
}
