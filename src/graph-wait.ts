import { isAbsolute } from "node:path";

// Auto mode needs the glyphs of every CSS module before the font of an @font-face is emitted,
// and Rolldown can not change an asset once it is emitted. A module with such a font waits in
// `transform` until every other module the build has discovered is transformed: CSS modules are
// leaves of the graph, so none of them waits for the font module.

// A stuck wait (a plugin loading the waiting module itself) is released after this idle time;
// the final check in buildEnd then reports glyphs the font missed
export const GRAPH_IDLE_TIMEOUT_MS = 20_000;

export interface GraphState {
  // Discovered modules that are not parsed yet; externals and waiting modules stay here
  readonly unparsed: Set<string>;
  readonly parsed: Set<string>;
  readonly waiting: Set<string>;
  release: (() => void) | null;
  pending: Promise<void> | null;
  timer: NodeJS.Timeout | null;
  timedOut: boolean;
  reset(): void;
}

export interface ModuleLookup {
  getModuleInfo(id: string): object | null;
}

interface ParsedModule {
  id: string;
  importedIds: readonly string[];
  dynamicallyImportedIds: readonly string[];
}

export function createGraphState(): GraphState {
  const state: GraphState = {
    unparsed: new Set(),
    parsed: new Set(),
    waiting: new Set(),
    release: null,
    pending: null,
    timer: null,
    timedOut: false,
    reset() {
      if (state.timer) clearTimeout(state.timer);
      state.release?.();
      state.unparsed.clear();
      state.parsed.clear();
      state.waiting.clear();
      state.release = null;
      state.pending = null;
      state.timer = null;
      state.timedOut = false;
    },
  };
  return state;
}

// Rolldown has no module info for externals (`vue`, `node:path`); a module of the build starts
// loading as soon as it is discovered and gets its info then. Absolute paths and \0 ids are files
// and virtual modules of the build
const isExternal = (lookup: ModuleLookup, id: string): boolean =>
  !isAbsolute(id) && !id.startsWith("\0") && lookup.getModuleInfo(id) === null;

// A module that is not parsed yet holds the wait unless it waits itself or is external. A module
// with `code` but no moduleParsed yet is not settled: its imports are not known
const isPending = (state: GraphState, lookup: ModuleLookup, id: string): boolean =>
  !state.waiting.has(id) && !isExternal(lookup, id);

const discover = (state: GraphState, id: string): void => {
  if (!state.parsed.has(id)) state.unparsed.add(id);
};

function releaseWaiters(state: GraphState): void {
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  const release = state.release;
  state.release = null;
  state.pending = null;
  release?.();
}

function checkGraph(state: GraphState, lookup: ModuleLookup): void {
  if (!state.release) return;
  // Only unparsed modules are scanned, so the check does not grow with the graph
  for (const id of state.unparsed) {
    if (isPending(state, lookup, id)) return;
  }
  releaseWaiters(state);
}

function armTimer(state: GraphState): void {
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timedOut = true;
    releaseWaiters(state);
  }, GRAPH_IDLE_TIMEOUT_MS);
  state.timer.unref();
}

export function addEntries(state: GraphState, ids: Iterable<string>): void {
  for (const id of ids) discover(state, id);
}

// moduleParsed: records the module and everything it imports
export function onModuleParsed(state: GraphState, lookup: ModuleLookup, info: ParsedModule): void {
  state.parsed.add(info.id);
  state.unparsed.delete(info.id);
  info.importedIds.forEach((id) => discover(state, id));
  info.dynamicallyImportedIds.forEach((id) => discover(state, id));
  if (state.release) {
    armTimer(state);
    checkGraph(state, lookup);
  }
}

// Resolves once every discovered module except the waiting ones is transformed
export function waitForGraph(state: GraphState, lookup: ModuleLookup, id: string): Promise<void> {
  state.waiting.add(id);
  if (!state.pending) {
    state.pending = new Promise<void>((resolve) => {
      state.release = resolve;
    });
    armTimer(state);
  }
  const pending = state.pending;
  queueMicrotask(() => checkGraph(state, lookup));
  return pending.finally(() => state.waiting.delete(id));
}
