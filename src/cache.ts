import { existsSync, mkdirSync, rmSync } from "node:fs";
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { mergePath } from "./utils";

export const CACHE_DIR_NAME = ".font-extractor-cache";
// Keys each owner (a build environment of one config, a dev server) used last time
const USAGE_DIR_NAME = ".usage";
// An owner that did not run for this long no longer protects its entries
const USAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Dev writes its usage when minifications settle
const USAGE_WRITE_DELAY_MS = 1000;
// Written next to the entries, never in `.usage`: a prune skips them there
const TEMPORARY_EXTENSION = ".tmp";

interface Usage {
  keys: string[];
}

// Entries of the cache as one build environment (or the dev server) uses them
export interface CacheUsage {
  check(key: string): Promise<boolean>;
  get(key: string): Promise<Buffer>;
  set(key: string, data: Buffer | string): Promise<void>;
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
  // Usage file name → keys its environment read or wrote since its last resetUsage(). Client and
  // SSR builds of one config may run in parallel: each records its usage apart
  private readonly usedKeys = new Map<string, Set<string>>();
  private usageTimer: NodeJS.Timeout | null = null;
  private writes = 0;

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
    this.path = mergePath(to, CACHE_DIR_NAME);
    this.usagePath = mergePath(this.path, USAGE_DIR_NAME);
    mkdirSync(this.path, { recursive: true });
  }

  // The entries as `environment` uses them; "" is the dev server
  usage(environment = ""): CacheUsage {
    const name = this.usageName(environment);
    return {
      check: (key) => this.check(key),
      get: (key) => {
        this.use(name, key);
        return readFile(this.getPathTo(key));
      },
      set: (key, data) => {
        this.use(name, key);
        return this.write(key, data);
      },
    };
  }

  // Called when a build of the environment starts; other environments keep their usage
  resetUsage(environment = ""): void {
    this.keysOf(this.usageName(environment)).clear();
  }

  /**
   * Called when the build of `environment` ends: records its usage and removes entries that
   * neither an environment of this process nor another recent owner used. The usage file of an
   * environment still running is left as its last build wrote it: with the keys its build has
   * used so far it would drop the entries it is about to read.
   */
  async prune(environment = ""): Promise<void> {
    if (!existsSync(this.path)) return;
    await this.writeUsage(this.usageName(environment));
    // Listed before the keys are collected: an entry written meanwhile has its key in use already
    const entries = await readdir(this.path, { withFileTypes: true });
    const protectedKeys = await this.readRecentUsage();
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isFile() &&
            !entry.name.endsWith(TEMPORARY_EXTENSION) &&
            !protectedKeys.has(entry.name),
        )
        .map((entry) => rm(this.getPathTo(entry.name), { force: true })),
    );
  }

  getPathTo(...to: string[]): string {
    return mergePath(this.path, ...to);
  }

  private usageName(environment: string): string {
    return environment ? `${this.owner}-${environment}` : this.owner;
  }

  private keysOf(name: string): Set<string> {
    let keys = this.usedKeys.get(name);
    if (!keys) {
      keys = new Set();
      this.usedKeys.set(name, keys);
    }
    return keys;
  }

  private async check(key: string): Promise<boolean> {
    try {
      await access(this.getPathTo(key));
      return true;
    } catch {
      return false;
    }
  }

  private async write(key: string, data: Buffer | string): Promise<void> {
    await mkdir(this.path, { recursive: true });
    await this.writeAtomically(this.getPathTo(key), key, data);
  }

  // A build killed mid-write must not leave a truncated file behind a valid name, and the prune of
  // a parallel environment must not read a usage file half written
  private async writeAtomically(path: string, name: string, data: Buffer | string): Promise<void> {
    const temporary = this.getPathTo(
      `.${name}.${process.pid}.${++this.writes}${TEMPORARY_EXTENSION}`,
    );
    try {
      await writeFile(temporary, data);
      await rename(temporary, path);
    } catch (error) {
      // A prune never removes temporary files
      await rm(temporary, { force: true });
      throw error;
    }
  }

  private use(name: string, key: string): void {
    this.keysOf(name).add(key);
    if (!this.isLongRunning) return;
    if (this.usageTimer) clearTimeout(this.usageTimer);
    this.usageTimer = setTimeout(() => {
      this.usageTimer = null;
      this.writeUsage(name).catch(() => undefined);
    }, USAGE_WRITE_DELAY_MS);
    this.usageTimer.unref();
  }

  private async writeUsage(name: string): Promise<void> {
    await mkdir(this.usagePath, { recursive: true });
    const usage: Usage = { keys: [...this.keysOf(name)].sort() };
    await this.writeAtomically(
      mergePath(this.usagePath, `${name}.json`),
      name,
      JSON.stringify(usage),
    );
  }

  // Keys of every owner that ran within the TTL; usage of owners gone for longer is removed
  private async readRecentUsage(): Promise<Set<string>> {
    const keys = new Set([...this.usedKeys.values()].flatMap((used) => [...used]));
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
