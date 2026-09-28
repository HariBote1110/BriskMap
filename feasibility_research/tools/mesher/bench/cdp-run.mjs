// Runs bench/browser.html in headless Chromium via the DevTools Protocol and prints window.__benchResult.
// Usage: node bench/cdp-run.mjs --chrome <binary> --url <benchmark url> [--timeout-ms 900000]
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const value = (name, fallback) => { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1]; };
const chrome = value('--chrome'), url = value('--url'), timeoutMs = Number(value('--timeout-ms', 900000));
if (!chrome || !url) throw new Error('Use --chrome BIN --url URL');
const port = 9333;
const profile = mkdtempSync(join(tmpdir(), 'brisk-cdp-'));
const browser = spawn(chrome, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try { target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json(); } catch { await sleep(200); }
  }
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => socket.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map();
  socket.addEventListener('message', event => { const m = JSON.parse(event.data); pending.get(m.id)?.(m); pending.delete(m.id); });
  const evaluate = expression => new Promise(r => { const n = ++id; pending.set(n, r); socket.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, returnByValue: true } })); });
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const m = await evaluate('window.__benchDone ? JSON.stringify(window.__benchResult) : null');
    if (m.result?.result?.value) { console.log(m.result.result.value); process.exitCode = 0; break; }
    await sleep(1000);
  }
  if (Date.now() - start >= timeoutMs) { console.error('timeout'); process.exitCode = 1; }
  socket.close();
} finally { browser.kill(); }
