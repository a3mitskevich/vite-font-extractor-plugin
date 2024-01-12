import { createLogger, type LogErrorOptions, type Logger, type LogOptions, type LogType } from 'vite'
import { type InternalLogger, type PluginOption } from './types'
import { PLUGIN_NAME } from './constants'
import styler from './styler'

export const createInternalLogger = (logLevel: PluginOption['logLevel'], customLogger?: Logger): InternalLogger => {
  const prefix = `[${PLUGIN_NAME}]`
  const logger = createLogger(logLevel, {
    prefix,
    customLogger,
    allowClearScreen: true,
  })

  let needFix = false

  const log = (level: LogType, message: string, options?: LogOptions | LogErrorOptions): void => {
    if (needFix) {
      logger.info('')
      needFix = false
    }
    const tag = options?.timestamp ? '' : styler.tag(prefix) + ' '
    logger[level](`${tag}${styler[level](message)}`, options)
  }

  const error = (message: string, options?: LogErrorOptions): void => { log('error', message, options) }
  const warn = (message: string, options?: LogOptions): void => { log('warn', message, options) }
  const info = (message: string, options?: LogOptions): void => { log('info', message, options) }

  return {
    error,
    warn,
    info,
    fix: () => { needFix = true },
  }
}
