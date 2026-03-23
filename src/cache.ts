import { mkdirSync, existsSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { mergePath } from "./utils";

export default class Cache {
  static removeIfExists(parentDir: string): void {
    const cachePath = mergePath(parentDir, ".font-extractor-cache");
    if (existsSync(cachePath)) {
      rmSync(cachePath, { recursive: true });
    }
  }
  public readonly path: string;

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
    return readFileSync(this.getPathTo(key));
  }

  set(key: string, data: Buffer | string): void {
    this.createDir();
    writeFileSync(this.getPathTo(key), data);
  }

  createDir(): void {
    if (this.exist) {
      return;
    }
    mkdirSync(this.path, { recursive: true });
  }

  clearCache(pattern?: string): void {
    if (pattern) {
      const targetDir = join(this.path, pattern);
      if (existsSync(targetDir)) {
        const files = readdirSync(targetDir, { recursive: true, withFileTypes: true });
        for (const entry of files) {
          if (entry.isFile()) {
            rmSync(join(entry.parentPath ?? entry.path, entry.name));
          }
        }
      }
    } else {
      rmSync(this.path, { recursive: true });
    }
    this.createDir();
  }

  getPathTo(...to: string[]): string {
    return mergePath(this.path, ...to);
  }
}
