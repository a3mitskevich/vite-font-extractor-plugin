import { mkdirSync, existsSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { mergePath } from './utils'

export class Cache {
  public readonly path: string

  constructor (sid: string, to: string) {
    this.path = mergePath(to, `font-extractor-${sid}`)
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

  set (key: string, data: Buffer): void {
    writeFileSync(this.getPathTo(key), data)
  }

  createDir (): void {
    if (this.exist) {
      return
    }
    mkdirSync(this.path)
  }

  clearCache (): void {
    rmSync(this.path, { recursive: true, force: true })
    this.createDir()
  }

  getPathTo (...to: string[]): string {
    return mergePath(this.path, ...to)
  }
}
