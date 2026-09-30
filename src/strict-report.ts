import type { Rollup } from "vite";
import { type SharedContext, getLogger } from "./context";

// A strict build stops on it; thrown from a hook, it fails the build like `this.error`
export class StrictModeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`Strict mode: ${message}`, options);
    this.name = "StrictModeError";
  }
}

export interface ProblemDetails {
  // The log level when the build goes on, `warn` by default
  level?: "warn" | "error";
  error?: Error;
  // The text of the failure when the logged one says the original font is kept
  strictMessage?: string;
}

// Something leaves a font unminified: logged, or thrown when a strict build must not ship it
export type ProblemReport = (message: string, details?: ProblemDetails) => void;

/**
 * The problem report of a face: strict builds fail on the problems of a target (a configured one,
 * one `resolveTarget` returned, the auto target). A `?subset=` url without a target is the choice
 * of that url alone and only logs; so does the dev server, which must never stop.
 */
export function createProblemReport(ctx: SharedContext, isTarget: boolean): ProblemReport {
  const isFatal = isTarget && !!ctx.pluginOption.strict && !ctx.isServe;
  return (message, { level = "warn", error, strictMessage } = {}) => {
    if (isFatal) throw new StrictModeError(strictMessage ?? message, { cause: error });
    getLogger(ctx)[level](message, error ? { error: error as Rollup.RollupError } : undefined);
  };
}
