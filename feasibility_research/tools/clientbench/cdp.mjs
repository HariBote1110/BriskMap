import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending?.reject(new Error(message.error.message));
        else pending?.resolve(message.result ?? {});
      } else for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {}, message.sessionId);
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('CDP socket closed'));
      this.pending.clear();
    });
  }
  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }
  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out`));
      }, 30000);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result?.value;
  }
  close() { this.socket.close(); }
}

export async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

const browsers = new Map();
const killGroup = child => {
  try { process.kill(-child.pid, 'SIGKILL'); }
  catch { child.kill('SIGKILL'); }
};
process.on('exit', () => {
  for (const [child, profile] of browsers) {
    killGroup(child);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* Process exit is best effort. */ }
  }
});

export function chromeArguments(port, profile, { headless = false, chromeFlags = [], mobile = false } = {}) {
  const flags = [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, mobile ? '--window-size=412,915' : '--window-size=1600,900', '--force-device-scale-factor=1', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--enable-gpu'];
  if (headless) flags.push('--headless=new');
  flags.push(...chromeFlags);
  flags.push('about:blank');
  return flags;
}

export async function launchChrome(binary, options = {}) {
  const port = await freePort();
  const profile = mkdtempSync(join(tmpdir(), 'clientbench-'));
  const flags = chromeArguments(port, profile, options);
  const child = spawn(binary, flags, { stdio: 'ignore', detached: true });
  let spawnError;
  child.on('error', error => { spawnError = error; });
  browsers.set(child, profile);
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    const exited = child.exitCode !== null || child.signalCode !== null;
    const exit = exited ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve));
    killGroup(child);
    await Promise.race([exit, sleep(3000)]);
    browsers.delete(child);
    rmSync(profile, { recursive: true, force: true });
  };
  try {
    let version;
    for (let i = 0; i < 100; i++) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Chromium exited: ${child.exitCode ?? child.signalCode}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (response.ok) { version = await response.json(); break; }
      } catch { /* Browser is starting. */ }
      await sleep(100);
    }
    if (!version) throw new Error('Chromium CDP start timed out');
    const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
    if (!response.ok) throw new Error(`CDP target creation failed: ${response.status}`);
    const target = await response.json();
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await Promise.race([
      new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); }),
      sleep(10000).then(() => { throw new Error('CDP WebSocket timed out'); }),
    ]);
    return { child, client: new CdpClient(socket), version, close };
  } catch (error) { await close(); throw error; }
}
