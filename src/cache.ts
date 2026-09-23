import { existsSync, mkdirSync, rmSync } from "node:fs";
import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { mergePath } from "./utils";

export default class Cache {
  static removeIfExists(parentDir: string): void {
    const cachePath = mergePath(parentDir, ".font-extractor-cache");
    if (existsSync(cachePath)) {
      rmSync(cachePath, { recursive: true });
    }
  }
  public readonly path: string;
  // Keys read or written since the last resetUsage(), everything else is stale on prune()
  private readonly usedKeys = new Set<string>();

  constructor(to: string) {
    this.path = mergePath(to, ".font-extractor-cache");
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
    this.usedKeys.add(key);
    return readFile(this.getPathTo(key));
  }

  async set(key: string, data: Buffer | string): Promise<void> {
    this.usedKeys.add(key);
    await mkdir(this.path, { recursive: true });
    await writeFile(this.getPathTo(key), data);
  }

  resetUsage(): void {
    this.usedKeys.clear();
  }

  // Removes entries that were not used by the current build
  async prune(): Promise<void> {
    if (!existsSync(this.path)) {
      return;
    }
    const entries = await readdir(this.path, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && !this.usedKeys.has(entry.name))
        .map((entry) => rm(this.getPathTo(entry.name))),
    );
  }

  getPathTo(...to: string[]): string {
    return mergePath(this.path, ...to);
  }
}
