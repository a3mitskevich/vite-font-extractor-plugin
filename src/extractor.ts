import {isCSSRequest, type Plugin, type TransformResult} from 'vite'
import type {OutputAsset} from 'rollup'
import path, {isAbsolute} from 'node:path';
import extract, { type Format } from 'fontext';
import type {PluginOption, Target} from "./types";
import {createHash} from 'node:crypto'
import {Cache} from './cache';
import {mergePath} from "./utils";


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
    let cache: Cache | null;
    const targets = Array.isArray(pluginOption.targets) ? pluginOption.targets : [pluginOption.targets];
    const optionsMap: Map<Target['fontName'], Target> = new Map(
        targets.map(target => [target.fontName, target])
    )

    const progress: Set<string> = new Set();
    const transformMap: Map<string, Map<string, string>> = new Map();

    const tryTransform = async function (result: TransformResult): Promise<TransformResult> {
        let code = result?.code || '';
        if (!FONT_FACE_BLOCK_REGEX.test(code)) {
            return result;
        }
        const {fonts, fontName} = extractFontInfo(code);

        if (!optionsMap.has(fontName)) {
            return result;
        }

        if (progress.has(fontName)) {
            this.error('Multiply fonts files! Pls contact with developer for resolve it case!');
        } else {
            progress.add(fontName);
        }


        const fontNameTransformMap = new Map<string, string>();
        fonts.forEach(font => {
            const assetUrlRE = /__VITE_ASSET__([\w$]+)__(?:\$_(.*?)__)?/g
            const oldReferenceId = assetUrlRE.exec(font)[1]
            const referenceId = this.emitFile({
                type: 'asset',
                name: 'fontExtractor.woff',
                source: sid + oldReferenceId,
            });
            fontNameTransformMap.set(oldReferenceId, referenceId);
            code = code.replace(font, font.replace(oldReferenceId, referenceId))
        })
        transformMap.set(fontName, fontNameTransformMap);

        return {
            ...result,
            code,
        };
    }

    const hijackTransformPlugin = (plugin: Plugin) => {
        if (!plugin.transform) {
            return;
        }

        const originalFn = typeof plugin.transform === 'function' ? plugin.transform : plugin.transform.handler

        const wrappedFn: Plugin['transform'] = async function (...args) {
            const id = args[1];
            const result: TransformResult = await originalFn.apply(this, args);
            if (isCSSRequest(id)) {
                return tryTransform.call(this, result)
            }
            return result;
        }

        if (typeof plugin.transform === 'function') {
            plugin.transform = wrappedFn;
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
        configResolved(config) {
            if (pluginOption.cache) {
                const cachePath = (typeof pluginOption.cache === 'string' && pluginOption.cache) || 'node_modules';
                cache = new Cache(sid, isAbsolute(cachePath) ? cachePath : mergePath(config.root, cachePath))
            }

            const viteCssPlugin = config.plugins.find(plugin => plugin.name === 'vite:css');
            hijackTransformPlugin(viteCssPlugin);
        },
        async generateBundle(_, bundle) {
            if (cache) {
                if (pluginOption.cache) {
                    this.debug(`Cache created in - ${cache.path}`)
                } else {
                    this.debug(`Cache cleaned and destroyed`)
                    cache.clearCache();
                    cache = null;
                }
            }
            try {
                const findAssetByReferenceId = (referenceId: string): OutputAsset =>
                    Object.values(bundle).find(asset => asset.fileName.includes(this.getFileName(referenceId))) as OutputAsset;

                const fontsTransformQueues = Array.from(transformMap.keys())
                    .map(fontName => {
                        const map = transformMap.get(fontName);
                        return Array.from(map.keys())
                            .map(oldReferenceId => {
                                const newReferenceId = map.get(oldReferenceId);
                                return ({
                                    old: findAssetByReferenceId(oldReferenceId),
                                    new: findAssetByReferenceId(newReferenceId),
                                    cache: !!cache?.check(newReferenceId),
                                    cacheKey: newReferenceId,
                                    fontName,
                                });
                            })
                    });

                await Promise.all(fontsTransformQueues.map(async transformQueue => {
                    const entryPoint = transformQueue.find(transform => SUPPORT_START_FONT_REGEX.test(transform.old.fileName));
                    if (!entryPoint) {
                        this.error('No find supported fonts file extensions for extracting process')
                    }
                    const option = optionsMap.get(entryPoint.fontName);

                    const needExtracting = transformQueue.some(transform => !transform.cache)

                    const minifiedBuffers = {};

                    if (needExtracting) {
                        if (cache) {
                            this.debug('Clear cache because some files have a different content')
                            cache.clearCache();
                        }
                        const result = await extract(Buffer.from(entryPoint.old.source), {
                            ...option,
                            formats: transformQueue.map(transform => getFontExtension(transform.old.fileName)),
                        });
                        Object.assign(minifiedBuffers, result)
                    }

                    transformQueue.forEach(transform => {
                        const extension = getFontExtension(transform.old.fileName);

                        const minifiedBuffer = needExtracting
                            ? minifiedBuffers[extension]
                            : cache.get(transform.cacheKey);

                        if (cache && needExtracting) {
                            this.debug('Save a minified font buffer to cache')
                            cache.set(transform.cacheKey, minifiedBuffer);
                        }

                        const originalBuffer = Buffer.from(transform.old.source);
                        const resultLessThanOriginal = minifiedBuffer?.length < originalBuffer.length;


                        const fixedFilename = transform.new.fileName.replace('woff', extension);
                        this.debug(`changes temporal name from "${transform.new.fileName}" to ${fixedFilename} and update content`)
                        if (resultLessThanOriginal) {
                            Object.keys(bundle).forEach(key => {
                                const asset = bundle[key];
                                if (asset.type === 'asset' && typeof asset.source === 'string' && asset.source.includes(transform.new.fileName)) {
                                    this.debug(`change name from "${transform.new.fileName}" to ${fixedFilename} in ${key}`)
                                    asset.source = asset.source.replace(transform.new.fileName, fixedFilename);
                                }
                                if (key.includes(transform.old.fileName)) {
                                    this.debug(`delete ${key}`)
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
