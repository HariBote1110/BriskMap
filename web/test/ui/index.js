// Entry point for `node --test web/test/ui/`.
// Node resolves a directory argument to its index.js rather than scanning it,
// so this file loads every *.test.mjs beside it (serve.mjs and mock-engine.mjs are not tests).
// ES module syntax: web/package.json declares "type": "module".
import { readdirSync } from 'node:fs';

const here = new URL('./', import.meta.url);
const files = readdirSync(here).filter((name) => name.endsWith('.test.mjs')).sort();
for (const name of files) await import(new URL(name, here).href);
