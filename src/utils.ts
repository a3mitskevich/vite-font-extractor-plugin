import { normalizePath } from 'vite'
import { extname, join } from 'node:path'
import { createHash } from 'node:crypto'
import type { Format } from 'fontext'

export const mergePath = (...paths: string[]): string => normalizePath(join(...paths.filter(Boolean)))

export const getHash = (text: Buffer | string): string => createHash('sha256').update(text).digest('hex').substring(0, 8)

export const getFontExtension = (fontFileName: string): Format => extname(fontFileName).slice(1) as Format
