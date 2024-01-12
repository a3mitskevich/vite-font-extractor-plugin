import color from 'picocolors'
import { basename, dirname, sep } from 'node:path'
import type { Colors } from 'picocolors/types'
import { type StyleMessage } from './types'

const DEFAULT = (message: string): string => message

const aliases = {
  warn: color.yellow,
  tag: color.cyan,
  error: color.red,
  path: (message: string): string => [color.dim(dirname(message) + sep), color.green(basename(message))].join(''),
}

export default new Proxy({}, {
  get (_: any, key: string): any {
    if (key in aliases) {
      return aliases[key as keyof typeof aliases]
    }
    if (key in color) {
      return (message: string) => color[key as Exclude<keyof Colors, 'isColorSupported'>](message)
    }
    return DEFAULT
  },
}) as StyleMessage<keyof typeof aliases | Exclude<keyof Colors, 'isColorSupported'> | 'default'>
