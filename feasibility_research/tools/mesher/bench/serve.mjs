import { createServer } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const value = name => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
const data = value('--data') && resolve(value('--data'));
const port = Number(value('--port') ?? 8787);
if (!data || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Use --data DIR [--port 8787]');
const types = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm', '.b3d': 'application/octet-stream' };
createServer(async (request, response) => {
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/data/index.json') {
      const files = (await readdir(data)).filter(name => name.endsWith('.b3d')).sort();
      response.setHeader('Content-Type', types['.json']); response.end(JSON.stringify(files)); return;
    }
    const isData = url.pathname.startsWith('/data/');
    const base = isData ? data : root;
    const name = isData ? url.pathname.slice(6) : url.pathname.slice(1);
    const path = resolve(base, decodeURIComponent(name));
    if (!name || relative(base, path).startsWith('..') || path === base) { response.statusCode = 404; response.end('Not found'); return; }
    response.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
    response.end(await readFile(path));
  } catch (error) { response.statusCode = error.code === 'ENOENT' ? 404 : 500; response.end(error.message); }
}).listen(port, () => console.error(`Serving at http://localhost:${port}/bench/browser.html`));
