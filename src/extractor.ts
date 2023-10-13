import {isCSSRequest, type Plugin, TransformResult} from 'vite'
import type {OutputAsset} from 'rollup'
import path from 'node:path';
import extract, {Format} from 'fontext';
import type {PluginOption, Target} from "./types";
import {createHash} from 'node:crypto'


const FONT_URL_REGEX = /url\(['"]?(.*?)['"]?\)/g;
const FONT_FAMILY_RE = /font-family:\s*(.*?);/;
const SUPPORT_START_FONT_REGEX = /\.(otf|ttf|woff|woff2|ttc|dfont)$/;
const FONT_FACE_BLOCK_REGEX = /@font-face\s*{([\s\S]*?)}/;

const getFontExtension = (fontFileName: string): Format => path.extname(fontFileName).slice(1) as Format;
const getHash = (text: Buffer | string): string => createHash('sha256').update(text).digest('hex').substring(0, 8);

const extractFontInfo = (code: string): {
    fontName: string,
    fonts: string[],
} => {
    const [fontFaceString] = FONT_FACE_BLOCK_REGEX.exec(code);
    const fonts = [];
    let match = null;
    FONT_URL_REGEX.lastIndex = 0;
    while ((match = FONT_URL_REGEX.exec(fontFaceString))) {
        const url = match[1];
        if (url) {
            fonts.push(url)
        }
    }
    const [_, fontName] = FONT_FAMILY_RE.exec(fontFaceString);
    return {
        fontName: fontName.replace(/["']/g, ''),
        fonts,
    };
}

export default function FontExtractor(pluginOption: PluginOption): Plugin {
    const sid = getHash(JSON.stringify(pluginOption));

    const targets = Array.isArray(pluginOption.targets) ? pluginOption.targets : [pluginOption.targets];
    const optionsMap: Map<Target['fontName'], Target> = new Map(
        targets.map(target => [target.fontName, target])
    )

    const progress: Set<string> = new Set();
    const transformMap: Map<string, Map<string, string>> = new Map();

    const tryTransform = async function (result: TransformResult): Promise<TransformResult> {
        let code = result.code;
        if (!FONT_FACE_BLOCK_REGEX.test(code)) {
            return result;
        }
        const {fonts, fontName} = extractFontInfo(code);

        if (!optionsMap.has(fontName)) {
            return result;
        }

        if (progress.has(fontName)) {
            this.error('[vite-font-extractor-plugin] Multiply fonts files! Pls contact with developer for resolve it case!');
        } else {
            progress.add(fontName);
        }


        const fontNameTransformMap = new Map<string, string>();
        fonts.forEach(font => {
            const assetUrlRE = /__VITE_ASSET__([a-z\d]+)__(?:\$_(.*?)__)?/g
            const oldReferenceId = assetUrlRE.exec(font)[1]
            const referenceId = this.emitFile({
                type: 'asset',
                name: 'fontExtractor.ext',
                source: sid + oldReferenceId,
            });
            fontNameTransformMap.set(oldReferenceId, referenceId);
            code = code.replace(font, font.replace(oldReferenceId, referenceId))
        })
        transformMap.set(fontName, fontNameTransformMap);

        return {
            ...result,
            code,
        }
    }

    return {
        name: 'vite-font-extractor-plugin',
        apply: 'build',
        configResolved(config) {
            const viteCssPlugin = config.plugins.find(plugin => plugin.name === 'vite:css');
            const originalTransform = viteCssPlugin.transform;
            viteCssPlugin.transform = async function (...args) {
                const id = args[1];
                const originalFunction = typeof originalTransform === 'function' ? originalTransform : originalTransform.handler;
                const result: TransformResult = await originalFunction.apply(this, args);
                if (isCSSRequest(id)) {
                    return tryTransform.call(this, result)
                }
                return result;
            }
        },
        async generateBundle(_, bundle) {
            try {
                const findAssetByReferenceId = (referenceId: string): OutputAsset =>
                    Object.values(bundle).find(asset => asset.fileName.includes(this.getFileName(referenceId))) as OutputAsset;

                const fontsTransformQueues = Array.from(transformMap.keys())
                    .map(fontName => {
                        const map = transformMap.get(fontName);
                        return Array.from(map.keys())
                            .map(oldReferenceId => ({
                                old: findAssetByReferenceId(oldReferenceId),
                                new: findAssetByReferenceId(map.get(oldReferenceId)),
                                fontName,
                            }))
                    });

                await Promise.all(fontsTransformQueues.map(async transformQueue => {
                    const entryPoint = transformQueue.find(transform => SUPPORT_START_FONT_REGEX.test(transform.old.fileName));
                    if (!entryPoint) {
                        this.error('No find supported fonts file extensions for extracting process')
                    }
                    const option = optionsMap.get(entryPoint.fontName);
                    const minifiedBuffers = await extract(Buffer.from(entryPoint.old.source), {
                        ...option,
                        formats: transformQueue.map(transform => getFontExtension(transform.old.fileName)),
                    });

                    transformQueue.forEach(transform => {
                        const extension = getFontExtension(transform.old.fileName);
                        const minifiedBuffer = minifiedBuffers[extension];
                        const originalBuffer = Buffer.from(transform.old.source);
                        const resultLessThanOriginal = minifiedBuffer?.length < originalBuffer.length;

                        const fixedFilename = transform.new.fileName.replace('ext', extension);
                        this.info(`changes temporal name from "${transform.new.fileName}" to ${fixedFilename} and update content`)
                        if (resultLessThanOriginal) {
                            Object.keys(bundle).forEach(key => {
                                const asset = bundle[key];
                                if (asset.type === 'asset' && typeof asset.source === 'string' && asset.source.includes(transform.new.fileName)) {
                                    this.info(`change name from "${transform.new.fileName}" to ${fixedFilename} in ${key}`)
                                    asset.source = asset.source.replace(transform.new.fileName, fixedFilename);
                                }
                                if (key.includes(transform.old.fileName)) {
                                    this.info(`delete ${key}`)
                                    delete bundle[key];
                                }
                            })
                        }
                        transform.new.source = resultLessThanOriginal ? minifiedBuffer : originalBuffer;
                        transform.new.fileName = fixedFilename
                    })
                }))
            } catch (error) {
                this.error(error);
            }
        },
    }
}
