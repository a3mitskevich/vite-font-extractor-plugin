import { existsSync, mkdirSync, rmSync } from "node:fs";
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { mergePath } from "./utils";

export const CACHE_DIR_NAME = ".font-extractor-cache";
// Keys each owner (a build of one config, a dev server) used last time
const USAGE_DIR_NAME = ".usage";
// An owner that did not run for this long no longer protects its entries
const USAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Dev writes its usage when minifications settle
const USAGE_WRITE_DELAY_MS = 1000;

interface Usage {
  keys: string[];
}

export default class Cache {
  static removeIfExists(parentDir: string): void {
    const cachePath = mergePath(parentDir, CACHE_DIR_NAME);
    if (existsSync(cachePath)) {
      rmSync(cachePath, { recursive: true });
    }
  }

  public readonly path: string;
  private readonly usagePath: string;
  // Keys read or written since the last resetUsage()
  private readonly usedKeys = new Set<string>();
  private usageTimer: NodeJS.Timeout | null = null;
  private writes = 0;
  // Owner of the running build: one per build environment of the config
  private environmentOwner: string;

  /**
   * @param to directory the cache directory is created in
   * @param owner stable id of the build or dev server using the cache: entries another owner
   *   used recently survive a prune
   * @param isLongRunning a dev server records its usage as it goes and never prunes
   */
  constructor(
    to: string,
    private readonly owner: string,
    private readonly isLongRunning = false,
  ) {
    this.environmentOwner = owner;
    this.path = mergePath(to, CACHE_DIR_NAME);
    this.usagePath = mergePath(this.path, USAGE_DIR_NAME);
    mkdirSync(this.path, { recursive: true });
  }

  async check(key: string): Promise<boolean> {
    try {
      await access(this.getPathTo(key));
      return true;
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<Buffer> {
    this.use(key);
    return readFile(this.getPathTo(key));
  }

  async set(key: string, data: Buffer | string): Promise<void> {
    this.use(key);
    await mkdir(this.path, { recursive: true });
    // A build killed mid-write must not leave a truncated font behind a valid key
    const temporary = this.getPathTo(`.${key}.${process.pid}.${++this.writes}.tmp`);
    await writeFile(temporary, data);
    await rename(temporary, this.getPathTo(key));
  }

  // Called when a build starts: client and SSR builds of one config record their usage apart
  resetUsage(environment = ""): void {
    this.usedKeys.clear();
    this.environmentOwner = environment ? `${this.owner}-${environment}` : this.owner;
  }

  // Removes entries that neither this build nor another recent owner used
  async prune(): Promise<void> {
    if (!existsSync(this.path)) return;
    await this.writeUsage();
    const protectedKeys = await this.readRecentUsage();
    const entries = await readdir(this.path, { withFileTypes: true });
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isFile() && !entry.name.endsWith(".tmp") && !protectedKeys.has(entry.name),
        )
        .map((entry) => rm(this.getPathTo(entry.name), { force: true })),
    );
  }

  getPathTo(...to: string[]): string {
    return mergePath(this.path, ...to);
  }

  private use(key: string): void {
    this.usedKeys.add(key);
    if (!this.isLongRunning) return;
    if (this.usageTimer) clearTimeout(this.usageTimer);
    this.usageTimer = setTimeout(() => {
      this.usageTimer = null;
      this.writeUsage().catch(() => undefined);
    }, USAGE_WRITE_DELAY_MS);
    this.usageTimer.unref();
  }

  private async writeUsage(): Promise<void> {
    await mkdir(this.usagePath, { recursive: true });
    const usage: Usage = { keys: [...this.usedKeys].sort() };
    await writeFile(
      mergePath(this.usagePath, `${this.environmentOwner}.json`),
      JSON.stringify(usage),
    );
  }

  // Keys of every owner that ran within the TTL; usage of owners gone for longer is removed
  private async readRecentUsage(): Promise<Set<string>> {
    const keys = new Set(this.usedKeys);
    const files = await readdir(this.usagePath).catch(() => [] as string[]);
    await Promise.all(
      files.map(async (file) => {
        const path = mergePath(this.usagePath, file);
        try {
          if (Date.now() - (await stat(path)).mtimeMs > USAGE_TTL_MS) {
            await rm(path, { force: true });
            return;
          }
          const usage = JSON.parse(await readFile(path, "utf8")) as Usage;
          usage.keys.forEach((key) => keys.add(key));
        } catch {
          // A broken usage file protects nothing
        }
      }),
    );
    return keys;
  }
}
