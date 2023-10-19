import {normalizePath} from "vite";
import { join } from 'node:path';

export const mergePath = (...paths: string[]): string => normalizePath(join(...paths.filter(Boolean)))
