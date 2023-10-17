import {mkdirSync, existsSync, writeFileSync, readFileSync, rmSync} from "node:fs";
import {normalizePath} from "vite";

export class Cache {
    public readonly path: string;

    constructor(sid: string, root: string, to: string = 'node_modules') {
        this.path = this.getPathTo(root, to, `font-extractor-${sid}`);
        this.createDir();
    }

    get exist() {
        return existsSync(this.path);
    }

    check(key: string) {
        return existsSync(this.getPathTo(key))
    }

    get(key: string) {
        return readFileSync(this.getPathTo(key))
    }

    set(key: string, data: Buffer) {
        writeFileSync(this.getPathTo(key), data)
    }

    createDir() {
        if (this.exist) {
            return;
        }
        mkdirSync(this.path)
    }

    clearCache() {
        rmSync(this.path, {recursive: true, force: true})
        this.createDir();
    }

    getPathTo(...to: string[]) {
        return normalizePath([this.path, ...to].filter(Boolean).join('/'))
    }
}
