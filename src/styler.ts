import color from "picocolors";
import { basename, dirname, sep } from "node:path";
import type { Colors } from "picocolors/types";
import type { StyleMessage } from "./types";

const DEFAULT = (message: string): string => message;

const aliases = {
  warn: color.yellow,
  tag: color.cyan,
  error: color.red,
  path: (message: string): string =>
    [color.dim(dirname(message) + sep), color.green(basename(message))].join(""),
};

export default new Proxy(
  {},
  {
    get(_: any, key: string): any {
      if (key in aliases) {
        return aliases[key as keyof typeof aliases];
      }
      if (key in color) {
        return (message: string) =>
          color[key as Exclude<keyof Colors, "isColorSupported">](message);
      }
      return DEFAULT;
    },
  },
) as StyleMessage<keyof typeof aliases | Exclude<keyof Colors, "isColorSupported"> | "default">;

// Format utilities for the logger

const BYTES_PER_KB = 1024;
const DEFAULT_BAR_WIDTH = 20;

export function formatSize(bytes: number): string {
  if (bytes < BYTES_PER_KB) return bytes + " B";
  return (bytes / BYTES_PER_KB).toFixed(1) + " KB";
}

export function formatReduction(original: number, result: number): string {
  const pct = Math.round((1 - result / original) * 100);
  return pct > 0 ? color.green(`-${pct}%`) : color.yellow(`+${Math.abs(pct)}%`);
}

export function formatBar(ratio: number, width: number = DEFAULT_BAR_WIDTH): string {
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  return (
    color.dim("▎") + color.green("█".repeat(filled)) + color.dim("░".repeat(empty)) + color.dim("▎")
  );
}

export function formatSizeComparison(original: number, result: number): string {
  const ratio = 1 - result / original;
  return `${color.dim(formatSize(original))} → ${color.bold(formatSize(result))}  ${formatBar(ratio)} ${formatReduction(original, result)}`;
}
