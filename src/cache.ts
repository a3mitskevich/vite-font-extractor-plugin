import { mkdirSync, existsSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { mergePath } from './utils'
import glob from 'fast-glob'

// TODO: add mechanism for auto deleting old cache if `cache` props changes to false
export default class Cache {
  public readonly path: string

  constructor (to: string) {
    this.path = mergePath(to, '.font-extractor-cache')
    this.createDir()
  }

  get exist (): boolean {
    return existsSync(this.path)
  }

  check (key: string): boolean {
    return existsSync(this.getPathTo(key))
  }

  get (key: string): Buffer {
    return readFileSync(this.getPathTo(key))
  }

  set (key: string, data: Buffer | string): void {
    this.createDir()
    writeFileSync(this.getPathTo(key), data)
  }

  createDir (): void {
    if (this.exist) {
      return
    }
    mkdirSync(this.path, { recursive: true })
  }

  clearCache (pattern?: string): void {
    const remove = (target: string, recursive: boolean = false): void => {
      rmSync(target, { recursive })
      this.createDir()
    }

    if (pattern) {
      glob.sync(pattern + '/**', {
        absolute: true,
        onlyFiles: true,
        cwd: this.path,
      }).forEach(target => { remove(target) })
    } else {
      remove(this.path, true)
    }
  }

  getPathTo (...to: string[]): string {
    return mergePath(this.path, ...to)
  }
}
