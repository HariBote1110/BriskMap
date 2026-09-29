// Entry point for `node --test web/test/ui/`.
// Node resolves a directory argument to its index.js rather than scanning it,
// so this file loads every *.test.mjs beside it (serve.mjs and mock-engine.mjs are not tests).
'use strict';

const { readdirSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const files = readdirSync(__dirname).filter((name) => name.endsWith('.test.mjs')).sort();
  for (const name of files) await import(pathToFileURL(join(__dirname, name)).href);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
