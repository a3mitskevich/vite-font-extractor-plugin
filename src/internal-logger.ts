import {
  createLogger,
  type LogErrorOptions,
  type Logger,
  type LogOptions,
  type LogType,
} from "vite";
import type { DebugMessage, InternalLogger, MinifyStats, PluginOption } from "./types";
import { PLUGIN_NAME } from "./constants";
import color from "picocolors";
import styler, { formatBar, formatReduction, formatSize } from "./styler";

const ICONS = {
  font: "🔤",
  config: "⚙ ",
  minify: "✂ ",
  success: "✓ ",
  warn: "⚠ ",
  error: "✗ ",
  cache: "↻ ",
};

const TREE = {
  item: "     ├─ ",
  last: "     └─ ",
  sub: "     │  ├─ ",
  subLast: "     │  └─ ",
};

// `DEBUG=vite-font-extractor` (or `*`, `vite-font-extractor:*`), like the `debug` package
const DEBUG_NAMESPACE = "vite-font-extractor";
const DEBUG_SEPARATOR_RE = /[\s,]+/;

export function isDebugEnabled(
  option: PluginOption["debug"],
  env: string | undefined = process.env.DEBUG,
): boolean {
  if (option !== undefined) return option;
  return (env ?? "")
    .split(DEBUG_SEPARATOR_RE)
    .some((name) => name === "*" || name.startsWith(DEBUG_NAMESPACE));
}

export interface DebugOptions {
  isEnabled: boolean;
  // Paths under the root (Vite's normalized `config.root`) are printed relative to it
  root?: string;
}

export const createInternalLogger = (
  logLevel: PluginOption["logLevel"],
  customLogger?: Logger,
  { isEnabled: isDebug, root }: DebugOptions = { isEnabled: false },
): InternalLogger => {
  const logger = createLogger(logLevel, {
    prefix: `[${PLUGIN_NAME}]`,
    customLogger,
    allowClearScreen: true,
  });

  let needFix = false;
  let cachedFonts = 0;
  const rootPrefix = root ? `${root.replace(/\/$/, "")}/` : null;
  const toShortPaths = (text: string): string =>
    rootPrefix ? text.replaceAll(rootPrefix, "") : text;

  const raw = (level: LogType, message: string, options?: LogOptions | LogErrorOptions): void => {
    if (needFix) {
      logger.info("");
      needFix = false;
    }
    logger[level](message, options);
  };

  return {
    info: (message: string, options?: LogOptions): void => raw("info", message, options),
    warn: (message: string, options?: LogOptions): void =>
      raw("warn", `  ${color.yellow(ICONS.warn)}${color.yellow(message)}`, options),
    error: (message: string, options?: LogErrorOptions): void =>
      raw("error", `  ${color.red(ICONS.error)}${color.red(message)}`, options),
    fix: () => {
      needFix = true;
    },

    isDebug,
    // The message is built only when debug is on: pass a thunk for anything costly
    debug(message: DebugMessage, id?: string) {
      if (!isDebug) return;
      const text = typeof message === "function" ? message() : message;
      const where = id ? ` ${color.dim("—")} ${styler.path(toShortPaths(id))}` : "";
      raw("info", `  ${color.dim("[debug]")} ${toShortPaths(text)}${where}`);
    },

    banner() {
      raw("info", "");
      raw("info", `  ${ICONS.font} ${color.bold(color.cyan(PLUGIN_NAME))}`);
    },

    config(mode: string, details: string) {
      raw("info", `  ${ICONS.config}${color.dim("Config")} — ${mode} mode, ${details}`);
    },

    phase(icon: string, name: string) {
      raw("info", "");
      raw("info", `  ${icon} ${color.bold(name)}`);
    },

    found(type: string, name: string, detail?: string) {
      const suffix = detail ? ` ${color.dim(`(${detail})`)}` : "";
      raw("info", `${TREE.item}${type} ${color.green(`"${name}"`)}${suffix}`);
    },

    minified(_fontName: string, ext: string, original: number, result: number, isLast = false) {
      const prefix = isLast ? TREE.subLast : TREE.sub;
      const extPadded = `.${ext}`.padEnd(6);
      const origPadded = formatSize(original).padStart(9);
      const resPadded = formatSize(result).padStart(9);
      const ratio = 1 - result / original;
      raw(
        "info",
        `${prefix}${color.dim(extPadded)} ${color.dim(origPadded)} → ${color.bold(resPadded)}  ${formatBar(ratio)} ${formatReduction(original, result)}`,
      );
    },

    cached(fontName: string) {
      cachedFonts++;
      raw(
        "info",
        `${TREE.item}${ICONS.cache} ${color.dim("cached")} ${color.green(`"${fontName}"`)}`,
      );
    },

    cachedCount: () => cachedFonts,

    skipped(fontName: string, reason: string) {
      raw(
        "info",
        `${TREE.item}${color.dim("skip")} ${color.yellow(`"${fontName}"`)} — ${color.dim(reason)}`,
      );
    },

    summary(stats: MinifyStats) {
      raw("info", "");
      const parts = [];
      if (stats.minified > 0) parts.push(color.green(`${stats.minified} fonts minified`));
      if (stats.cached > 0) parts.push(color.dim(`${stats.cached} cached`));
      if (stats.saved > 0) parts.push(color.bold(formatSize(stats.saved) + " saved"));
      raw("info", `  ${color.green(ICONS.success)}${color.bold("Done")} — ${parts.join(", ")}`);
      raw("info", "");
    },
  };
};
