import { describe, it, expect } from "vitest";
import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build, type Logger } from "vite";
import {
  createFakeLogger,
  createFixture,
  fixturesDir,
  fontsLength,
  generateId,
  type LoggerMessage,
  openFont,
  outDir,
  plugin,
  rendersLigature,
} from "./utils";
import type { PluginOption } from "../src";

const watchFixture = createFixture("watch-rebuild");
const FONT_FILES = ["icon-font.woff2", "icon-font.woff"];
const FONT_FACE = readFileSync(join(watchFixture.path, "index.css"), "utf8");
const MAIN_JS = readFileSync(join(watchFixture.path, "main.js"), "utf8");
// Lets the file watcher settle before the next change
const WATCH_SETTLE_MS = 300;

interface WatchEvent {
  code: string;
  error?: Error;
  result?: { close?: () => unknown };
}

interface Watcher {
  on(event: "event", listener: (event: WatchEvent) => void): unknown;
  close(): Promise<void>;
}

interface Snapshot {
  fonts: Record<string, Buffer>;
  fontRefs: string[];
  problems: LoggerMessage[];
}

// Resolves once per finished (re)build, in order
function createBuildQueue(watcher: Watcher): () => Promise<void> {
  const finished: Array<Error | null> = [];
  const waiters: Array<(outcome: Error | null) => void> = [];
  watcher.on("event", (event) => {
    if (event.code === "BUNDLE_END") event.result?.close?.();
    if (event.code !== "END" && event.code !== "ERROR") return;
    const outcome = event.code === "ERROR" ? (event.error ?? new Error("watch error")) : null;
    const waiter = waiters.shift();
    if (waiter) waiter(outcome);
    else finished.push(outcome);
  });
  return () =>
    new Promise((resolve, reject) => {
      const settle = (outcome: Error | null): void => (outcome ? reject(outcome) : resolve());
      if (finished.length) settle(finished.shift()!);
      else waiters.push(settle);
    });
}

function createProject(): { root: string; out: string; workDir: string } {
  const workDir = join(outDir, `watch-${generateId()}`);
  const root = join(workDir, "project");
  cpSync(watchFixture.path, root, { recursive: true });
  for (const file of FONT_FILES) {
    cpSync(join(fixturesDir, "fonts", file), join(workDir, "fonts", file));
  }
  return { root, out: join(workDir, "out"), workDir };
}

function takeSnapshot(out: string, messages: LoggerMessage[]): Snapshot {
  // Windows lists `assets\icon.woff2`; the CSS references `assets/icon.woff2`
  const files = readdirSync(out, { recursive: true }).map((file) =>
    String(file).replaceAll("\\", "/"),
  );
  const css = files
    .filter((file) => file.endsWith(".css"))
    .map((file) => readFileSync(join(out, file), "utf8"))
    .join("\n");
  const fonts = Object.fromEntries(
    files
      .filter((file) => /\.(woff2?|ttf|eot)$/.test(file))
      .map((file) => [file, readFileSync(join(out, file))]),
  );
  return {
    fonts,
    fontRefs: Array.from(css.matchAll(/assets\/[^"')\s]+\.(?:woff2?|ttf|eot)/g), (m) => m[0]),
    problems: messages.splice(0).filter((m) => m.type === "warn" || m.type === "error"),
  };
}

function expectMinified(snapshot: Snapshot): void {
  expect(snapshot.problems).toEqual([]);
  expect(snapshot.fontRefs.length).toBeGreaterThan(0);
  expect(snapshot.fontRefs.filter((ref) => !snapshot.fonts[ref])).toEqual([]);
  for (const [file, source] of Object.entries(snapshot.fonts)) {
    const ext = file.split(".").pop() as keyof typeof fontsLength;
    expect(source.length, file).toBeLessThan(fontsLength[ext]);
    expect(rendersLigature(openFont(source), "close"), file).toBe(true);
  }
}

const ICON_TARGET_OPTIONS: PluginOption = {
  type: "manual",
  cache: false,
  targets: [{ fontName: "Font Name", ligatures: ["close"] }],
};

async function startWatcher(root: string, out: string, logger: Logger): Promise<Watcher> {
  return (await build({
    root,
    configFile: false,
    logLevel: "silent",
    customLogger: logger,
    plugins: [await plugin(ICON_TARGET_OPTIONS)],
    build: { outDir: out, emptyOutDir: true, watch: {} },
  })) as Watcher;
}

const settle = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, WATCH_SETTLE_MS);
  });

// Text outputs of the build: a rebuild that changed nothing gives the same text
const readOutputText = (out: string): string =>
  readdirSync(out, { recursive: true })
    .map(String)
    .filter((file) => /\.(?:css|js)$/.test(file))
    .sort()
    .map((file) => `${file}\n${readFileSync(join(out, file), "utf8")}`)
    .join("\n");

// One file change may trigger several rebuilds (Windows reports it twice): waits until the
// output reflects the change, not until the next build event
const MAX_REBUILDS_PER_CHANGE = 4;

async function rebuildUntilChanged(
  out: string,
  nextBuild: () => Promise<void>,
  write: () => void,
): Promise<void> {
  const before = readOutputText(out);
  write();
  for (let rebuilds = 0; rebuilds < MAX_REBUILDS_PER_CHANGE; rebuilds++) {
    await nextBuild();
    if (readOutputText(out) !== before) return;
  }
}

const subsetImportJs = (characters: string): string =>
  `import "./index.css";\nimport font from "../fonts/text-font.woff2?subset=${characters}";\n\ndocument.title = font;\n`;

describe("Build watch mode", () => {
  it(`should keep fonts minified and references intact across rebuilds`, async () => {
    const { root, out, workDir } = createProject();
    const logger = createFakeLogger();
    const { messages } = logger;
    const watcher = await startWatcher(root, out, logger);
    const nextBuild = createBuildQueue(watcher);
    const rebuildAfter = async (file: string, content: string): Promise<Snapshot> => {
      await settle();
      await rebuildUntilChanged(out, nextBuild, () => writeFileSync(join(root, file), content));
      return takeSnapshot(out, messages);
    };

    try {
      await nextBuild();
      expectMinified(takeSnapshot(out, messages));

      // CSS untouched
      expectMinified(await rebuildAfter("main.js", `${MAIN_JS}document.title = "changed";\n`));

      const withoutFace = await rebuildAfter("index.css", ".icon { color: red; }\n");
      expect(withoutFace.problems).toEqual([]);
      expect(withoutFace.fontRefs).toEqual([]);

      expectMinified(await rebuildAfter("index.css", FONT_FACE));
    } finally {
      await watcher.close();
      rmSync(workDir, { recursive: true, force: true });
    }
  }, 60_000);

  it(`should drop the result of a ?subset= import changed between rebuilds`, async () => {
    const { root, out, workDir } = createProject();
    cpSync(
      join(fixturesDir, "fonts", "text-font.woff2"),
      join(workDir, "fonts", "text-font.woff2"),
    );
    writeFileSync(join(root, "main.js"), subsetImportJs("XY"));
    const logger = createFakeLogger();
    const { messages } = logger;
    const watcher = await startWatcher(root, out, logger);
    const nextBuild = createBuildQueue(watcher);

    try {
      await nextBuild();
      await settle();
      await rebuildUntilChanged(out, nextBuild, () =>
        writeFileSync(join(root, "main.js"), subsetImportJs("XYZ")),
      );

      const snapshot = takeSnapshot(out, messages);
      expect(snapshot.problems).toEqual([]);
      const textFonts = Object.entries(snapshot.fonts).filter(([file]) =>
        file.includes("text-font"),
      );
      expect(textFonts.map(([file]) => file)).toHaveLength(1);
      const font = openFont(textFonts[0][1]);
      for (const char of "XYZ") {
        expect(font.hasGlyphForCodePoint(char.codePointAt(0)!), char).toBe(true);
      }
    } finally {
      await watcher.close();
      rmSync(workDir, { recursive: true, force: true });
    }
  }, 60_000);
});
