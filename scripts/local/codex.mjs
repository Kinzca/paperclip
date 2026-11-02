import { mkdirSync } from 'node:fs';
import { codexCli, codexHome, runNode } from './common.mjs';
mkdirSync(codexHome, { recursive: true });
runNode([codexCli, ...(process.argv.slice(2).length ? process.argv.slice(2) : ['login'])]);
