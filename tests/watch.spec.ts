import { describe, it, expect } from "vitest";
import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as fontkit from "fontkit";
import {
  type ContainerVersion,
  createFixture,
  fixturesDir,
  fontsLength,
  generateId,
  type LoggerMessage,
  outDir,
  plugin,
  viteBuild,
} from "./utils";

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

function createMessageLogger(): { logger: any; messages: LoggerMessage[] } {
  const messages: LoggerMessage[] = [];
  const logger = new Proxy(
    {},
    {
      get(_: any, key: any): any {
        if (key === "clearScreen" || key === "hasErrorLogged") return () => false;
        return (message: string) => messages.push({ type: key, message: String(message) });
      },
    },
  );
  return { logger, messages };
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
  const files = readdirSync(out, { recursive: true }).map(String);
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
    const glyphs = (fontkit.create(source) as fontkit.Font).layout("close").glyphs;
    expect(glyphs.length === 1 && glyphs[0].id !== 0, file).toBe(true);
  }
}

describe.sequential("Build watch mode", () => {
  Object.keys(viteBuild).forEach((version) => {
    it(`vite@${version}: should keep fonts minified and references intact across rebuilds`, async () => {
      const { root, out, workDir } = createProject();
      const { logger, messages } = createMessageLogger();
      const build = viteBuild[version as ContainerVersion] as (config: object) => Promise<unknown>;
      const watcher = (await build({
        root,
        configFile: false,
        logLevel: "silent",
        customLogger: logger,
        plugins: [
          await plugin({
            type: "manual",
            cache: false,
            targets: [{ fontName: "Font Name", ligatures: ["close"] }],
          }),
        ],
        build: { outDir: out, emptyOutDir: true, watch: {} },
      })) as Watcher;
      const nextBuild = createBuildQueue(watcher);
      const rebuildAfter = async (file: string, content: string): Promise<Snapshot> => {
        await new Promise((resolve) => {
          setTimeout(resolve, WATCH_SETTLE_MS);
        });
        writeFileSync(join(root, file), content);
        await nextBuild();
        return takeSnapshot(out, messages);
      };

      try {
        await nextBuild();
        expectMinified(takeSnapshot(out, messages));

        // CSS untouched — Vite 5–7 reuse its cached transform
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
  });
});
