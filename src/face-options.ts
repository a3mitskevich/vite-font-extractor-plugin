import type { FontFaceInfo, OptionsWithCacheSid, Target } from "./types";
import { type PluginContext, getLogger } from "./context";
import { hasSubsetParam } from "./subset-options";
import { assertTarget, toTargetOptions } from "./target-match";
import { createProblemReport, type ProblemReport } from "./strict-report";
import { type IgnoreReason, toReportSource } from "./report";
import { createSubsetOptions } from "./utils";

const REMOTE_URL_RE = /^(?:https?:)?\/\//i;

export const isRemoteUrl = (url: string): boolean => REMOTE_URL_RE.test(url);

// The plugin leaves the face alone: ignored, outside `include`/`exclude`, or `resolveTarget` said so
export const SKIP_FACE = "skip";

// A face left alone, and why: a face without a family has nothing to report
interface SkippedFace {
  skipped: IgnoreReason | null;
}

type FaceDecision = OptionsWithCacheSid | SkippedFace | null;

const isSkipped = (decision: FaceDecision): decision is SkippedFace =>
  !!decision && "skipped" in decision;

function decideFaceTarget(ctx: PluginContext, face: FontFaceInfo): FaceDecision {
  const logger = getLogger(ctx);
  const id = face.id || undefined;
  if (!face.family) {
    logger.debug("options: no font-family", id);
    return { skipped: null };
  }
  if (face.id && !ctx.isModuleIncluded(face.id)) {
    logger.debug(`options: "${face.family}" is outside include/exclude`, id);
    return { skipped: "include/exclude" };
  }
  const isIgnored = ctx.ignoreMatchers.some((matches) => matches(face));
  const matched = isIgnored ? undefined : ctx.targetMatchers.find((target) => target.matches(face));
  const decision = ctx.pluginOption.resolveTarget?.(face, matched?.target ?? null);
  if (decision === null) {
    logger.debug(`options: resolveTarget skipped "${face.family}"`, id);
    return { skipped: "resolveTarget" };
  }
  if (decision !== undefined) return useTarget(ctx, decision, face);
  if (matched) return useTarget(ctx, matched.target, face, matched.options);
  if (isIgnored) {
    logger.debug(`options: "${face.family}" is ignored`, id);
    return { skipped: "ignore" };
  }
  return ctx.mode === "auto" ? ctx.autoProxyOption : null;
}

/**
 * The one decision on a face, shared by build, dev and Google Fonts: the options of its target,
 * SKIP_FACE, or null when no target applies (a `?subset=` url may still minify it).
 * Order: `include`/`exclude` of the stylesheet, `ignore`, the first matching target, auto mode —
 * then `resolveTarget` gets the last word.
 */
export function resolveFaceTarget(
  ctx: PluginContext,
  face: FontFaceInfo,
): OptionsWithCacheSid | typeof SKIP_FACE | null {
  const decision = decideFaceTarget(ctx, face);
  return isSkipped(decision) ? SKIP_FACE : decision;
}

function useTarget(
  ctx: PluginContext,
  target: Target,
  face: FontFaceInfo,
  options?: OptionsWithCacheSid,
): OptionsWithCacheSid {
  if (!options) assertTarget(target, `resolveTarget for "${face.family}"`);
  if (!ctx.isServe) ctx.matchedTargets.add(target.fontName);
  const source = options ? "target" : "resolveTarget";
  getLogger(ctx).debug(
    `options: "${face.family}" → ${source} "${target.fontName}"`,
    face.id || undefined,
  );
  return options ?? toTargetOptions(target);
}

export interface FaceOptionsRequest extends FontFaceInfo {
  // The final (compiled CSS) pass reports every face it can not minify; the dev server only
  // remote sources; the pass before vite:css stays silent
  report: "all" | "remote" | "none";
}

export interface FaceOptions {
  options: OptionsWithCacheSid;
  // Problems that leave the face unminified; fatal for a target in strict builds
  reportProblem: ProblemReport;
}

/**
 * Options to minify an @font-face with: its target, or its `?subset=` alone. null when the face
 * is skipped, has nothing to minify it with, or loads from another host.
 */
export function resolveFaceOptions(
  ctx: PluginContext,
  request: FaceOptionsRequest,
): FaceOptions | null {
  const { family, urls, report } = request;
  const logger = getLogger(ctx);
  const id = request.id || undefined;
  // The build report lists each face once: from the pass after vite:css
  const isReported = report === "all" && !ctx.isServe;
  const target = decideFaceTarget(ctx, request);
  if (isSkipped(target)) {
    if (isReported && target.skipped) {
      ctx.addReportRecord({
        kind: "ignored",
        fontName: family,
        id: toReportSource(ctx, request.id),
        reason: target.skipped,
      });
    }
    return null;
  }
  if (!target) {
    if (urls.some(hasSubsetParam)) {
      logger.debug(`options: "${family}" has no target, minified by its ?subset=`, id);
      return {
        options: createSubsetOptions(family, {}),
        reportProblem: createProblemReport(ctx, false),
      };
    }
    logger.debug(`options: "${family}" has no target and no ?subset= — not minified`, id);
    if (isReported) {
      ctx.addReportRecord({ kind: "skipped", fontName: family, reason: "no minify options" });
    }
    if (report === "all") {
      logger.warn(`Font "${family}" has no minify options — add to targets or use ?subset=`);
    }
    return null;
  }
  const reportProblem = createProblemReport(ctx, true);
  const remote = urls.filter(isRemoteUrl);
  if (remote.length) {
    logger.debug(
      () => `options: "${family}" has remote urls (${remote.join(", ")}) — not minified`,
      id,
    );
    if (isReported) {
      ctx.addReportRecord({
        kind: "skipped",
        fontName: family,
        reason: `external url sources: ${remote.join(", ")}`,
      });
    }
    if (report !== "none") {
      reportProblem(`Font "${family}" has external url sources: ${remote.toString()}`);
    }
    return null;
  }
  if (target.auto) logger.debug(`options: "${family}" → auto glyphs`, id);
  if (report === "all" && target.auto) {
    logger.warn(
      `"auto" mode detected. "${family}" font is stubbed based on auto-detected glyphs.` +
        " If this font is not a target please add it to ignore.",
    );
  }
  return { options: target, reportProblem };
}

/**
 * Urls of the face point at files in `public/`: Vite copies them as they are, so the font ships
 * original. A problem of strict builds only; otherwise traced and listed in the report.
 */
export function reportPublicUrls(
  ctx: PluginContext,
  face: FontFaceInfo,
  reportProblem: ProblemReport,
): void {
  const urls = face.urls.join(", ");
  getLogger(ctx).debug(
    `"${face.family}": ${urls} in public/ — copied as it is, not minified`,
    face.id || undefined,
  );
  ctx.addReportRecord({
    kind: "skipped",
    fontName: face.family,
    reason: `${urls} in public/ — copied as it is`,
  });
  if (!ctx.pluginOption.strict) return;
  const problem = `Font "${face.family}" loads ${urls} from public/, which Vite copies as it is`;
  reportProblem(`${problem} — keeping original`, {
    strictMessage: `${problem}; move the file out of public/ to minify it`,
  });
}
