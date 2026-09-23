import { mkdirSync, existsSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
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
    this.createDir();
  }

  get exist(): boolean {
    return existsSync(this.path);
  }

  check(key: string): boolean {
    return existsSync(this.getPathTo(key));
  }

  get(key: string): Buffer {
    this.usedKeys.add(key);
    return readFileSync(this.getPathTo(key));
  }

  set(key: string, data: Buffer | string): void {
    this.usedKeys.add(key);
    this.createDir();
    writeFileSync(this.getPathTo(key), data);
  }

  createDir(): void {
    if (this.exist) {
      return;
    }
    mkdirSync(this.path, { recursive: true });
  }

  resetUsage(): void {
    this.usedKeys.clear();
  }

  // Removes entries that were not used by the current build
  prune(): void {
    if (!this.exist) {
      return;
    }
    for (const entry of readdirSync(this.path, { withFileTypes: true })) {
      if (entry.isFile() && !this.usedKeys.has(entry.name)) {
        rmSync(this.getPathTo(entry.name));
      }
    }
  }

  getPathTo(...to: string[]): string {
    return mergePath(this.path, ...to);
  }
}
