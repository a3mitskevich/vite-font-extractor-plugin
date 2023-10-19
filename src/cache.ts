import {mkdirSync, existsSync, writeFileSync, readFileSync, rmSync} from "node:fs";
import {mergePath} from "./utils";

export class Cache {
    public readonly path: string;

    constructor(sid: string, to: string) {
        this.path = mergePath(to, `font-extractor-${sid}`);
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
        return mergePath(this.path, ...to)
    }
}
