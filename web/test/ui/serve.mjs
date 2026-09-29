#!/usr/bin/env node
// Development server for the BriskMap viewer UI (Node built-ins only).
//
//   node web/test/ui/serve.mjs --mock --port 8300
//     serves web/src at /, the mock engine at /engine/index.mjs and
//     web/test/ui/fixtures/maps at /maps/.
//   node web/test/ui/serve.mjs --port 8300 --maps <dir> [--textures <dir>]
//     serves the real web/src/engine and real map data.
//
// Options: --host (default 127.0.0.1), --port (default 8300).

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const srcRoot = resolve(here, '../../src');

function parseArgs(argv) {
  const args = { mock: false, port: 8300, host: '127.0.0.1', maps: null, textures: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--mock') args.mock = true;
    else if (arg === '--port') args.port = Number(argv[++i]);
    else if (arg === '--host') args.host = argv[++i];
    else if (arg === '--maps') args.maps = resolve(argv[++i]);
    else if (arg === '--textures') args.textures = resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(args.port) || args.port <= 0) throw new Error('--port needs a number');
  if (args.mock && !args.maps) args.maps = resolve(here, 'fixtures/maps');
  return args;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// Resolves a URL path inside root, refusing anything that escapes it.
function inside(root, urlPath) {
  const target = resolve(root, `.${urlPath}`);
  return target === root || target.startsWith(root + sep) ? target : null;
}

function route(args, pathname) {
  if (pathname === '/') return resolve(srcRoot, 'index.html');
  if (args.mock && pathname === '/engine/index.mjs') return resolve(here, 'mock-engine.mjs');
  if (pathname.startsWith('/maps/')) return args.maps ? inside(args.maps, pathname.slice('/maps'.length)) : null;
  if (pathname.startsWith('/textures/')) {
    return args.textures ? inside(args.textures, pathname.slice('/textures'.length)) : null;
  }
  return inside(srcRoot, pathname);
}

async function handle(args, req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end();
    return;
  }
  const file = route(args, pathname);
  const info = file ? await stat(file).catch(() => null) : null;
  if (!info || !info.isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }
  res.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'content-length': info.size,
    'cache-control': 'no-store',
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
}

const args = parseArgs(process.argv.slice(2));
createServer((req, res) => {
  handle(args, req, res).catch((error) => {
    console.error(error);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
}).listen(args.port, args.host, () => {
  const mode = args.mock ? 'mock engine' : 'real engine';
  console.log(`BriskMap UI dev server (${mode}) on http://${args.host}:${args.port}/`);
  if (args.maps) console.log(`  maps: ${args.maps}`);
  if (args.textures) console.log(`  textures: ${args.textures}`);
});
