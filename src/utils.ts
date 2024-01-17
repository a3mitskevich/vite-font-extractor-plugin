import { normalizePath, type ResolvedConfig, type ResolveFn } from 'vite'
import { extname, join } from 'node:path'
import { createHash } from 'node:crypto'
import type { Format } from 'fontext'
import { FONT_FACE_BLOCK_REGEX, FONT_FAMILY_RE, FONT_URL_REGEX, GOOGLE_FONT_URL_RE, POSTFIX_URL_RE } from './constants'
import type { ImportResolvers } from './types'

export const mergePath = (...paths: string[]): string => normalizePath(join(...paths.filter(Boolean)))

export const getHash = (text: Buffer | string, length = 8): string => createHash('sha256').update(text).digest('hex').substring(0, length)

export const getExtension = <T extends string>(filename: string): T => extname(filename).slice(1) as T

export const getFontExtension = (fontFileName: string): Format => getExtension<Format>(fontFileName)
export function exists<T> (value: T): value is NonNullable<T> {
  return value !== null && value !== undefined
}

export function difference<T> (array1: T[], array2: T[]): T[] {
  return array1.filter(item => !array2.includes(item))
}

export const escapeComments = (str: string): string => str.replaceAll(/\/\/.+\s/g, '')

export function cleanUrl (url: string): string {
  return url.replace(POSTFIX_URL_RE, '')
}

export function createResolvers (config: ResolvedConfig): ImportResolvers {
  let fontResolve: ResolveFn | undefined
  return {
    get common () {
      return (
        fontResolve ??
          (fontResolve = config.createResolver({
            extensions: [],
            tryIndex: false,
            preferRelative: false,
          }))
      )
    },
  }
}

export const extractFontFaces = (code: string): string[] => {
  const faces = []
  let match = null
  FONT_FACE_BLOCK_REGEX.lastIndex = 0
  while ((match = FONT_FACE_BLOCK_REGEX.exec(code))) {
    const face = match[0]
    if (face) {
      faces.push(face)
    }
  }
  return faces
}

export const extractFonts = (fontFaceString: string): string[] => {
  const fonts = []
  let match = null
  FONT_URL_REGEX.lastIndex = 0
  while ((match = FONT_URL_REGEX.exec(fontFaceString))) {
    const url = match[1]
    if (url) {
      fonts.push(url)
    }
  }
  return fonts
}

export const extractGoogleFontsUrls = (code: string): string[] => {
  const urls = []
  let match = null
  GOOGLE_FONT_URL_RE.lastIndex = 0
  while ((match = GOOGLE_FONT_URL_RE.exec(code))) {
    const url = match[1]
    if (url) {
      urls.push(url)
    }
  }
  return urls
}

export const extractFontName = (fontFaceString: string): string => {
  const fontName = FONT_FAMILY_RE.exec(fontFaceString)?.[1]
  return fontName?.replace(/["']/g, '') ?? ''
}
