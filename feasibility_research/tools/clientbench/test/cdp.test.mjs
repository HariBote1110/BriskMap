import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CdpClient } from '../cdp.mjs';
import { runOne } from '../run.mjs';

function fakeCdp() {
  const server = createServer();
  server.on('upgrade', (request, socket) => {
    const key = request.headers['sec-websocket-key'];
    const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const send = message => {
      const payload = Buffer.from(JSON.stringify(message));
      const header = payload.length < 126 ? Buffer.from([129, payload.length]) : Buffer.from([129, 126, payload.length >> 8, payload.length & 255]);
      socket.write(Buffer.concat([header, payload]));
    };
    let buffer = Buffer.alloc(0);
    socket.on('data', data => {
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length >= 6) {
        const lengthCode = buffer[1] & 127;
        const extra = lengthCode === 126 ? 2 : lengthCode === 127 ? 8 : 0;
        if (buffer.length < 2 + extra + 4) break;
        const length = lengthCode === 126 ? buffer.readUInt16BE(2) : lengthCode === 127 ? Number(buffer.readBigUInt64BE(2)) : lengthCode;
        const offset = 2 + extra;
        if (buffer.length < offset + 4 + length) break;
        const mask = buffer.subarray(offset, offset + 4);
        const payload = buffer.subarray(offset + 4, offset + 4 + length);
        const unmasked = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
        buffer = buffer.subarray(offset + 4 + length);
        if ((data[0] & 15) === 8) { socket.end(); return; }
        const message = JSON.parse(unmasked.toString());
        let result = {};
        if (message.method === 'Page.navigate') {
          send({ method: 'Page.frameNavigated', params: { frame: { id: '1' } } });
          send({ method: 'Network.requestWillBeSent', params: { requestId: '1', request: { url: 'http://local/data/tile' } } });
          send({ method: 'Network.loadingFinished', params: { requestId: '1', encodedDataLength: 123 } });
        }
        if (message.method === 'Performance.getMetrics') result = { metrics: [{ name: 'JSHeapUsedSize', value: 1048576 }] };
        if (message.method === 'Page.captureScreenshot') result = { data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==' };
        if (message.method === 'Runtime.evaluate') {
          const expression = message.params.expression;
          let value;
          if (expression.includes('new Promise')) value = [0, 16, 32, 48];
          else if (expression.includes('window.__glStats')) value = { buffer_bytes: 7, texture_bytes: 9, calls: 2 };
          else value = { longTasks: [], ready: true, error: null, stats: { t_upload_done_ms: 100 } };
          result = { result: { value } };
        }
        send({ id: message.id, result });
      }
    });
  });
  return server;
}

test('fake CDP socket produces a complete JSON line', async () => {
  const server = fakeCdp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const directory = mkdtempSync(join(tmpdir(), 'clientbench-test-'));
  const out = join(directory, 'results.jsonl');
  let socket;
  try {
    const launch = async () => {
      socket = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
      await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
      return { client: new CdpClient(socket), child: { pid: process.pid }, version: { Browser: 'Fake Chrome', 'User-Agent': 'Fake UA' }, close: async () => socket.close() };
    };
    const result = await runOne({ viewer: 'brisk', caseName: 'A', scenarioName: 'top', runNumber: 1,
      scenario: { distance: 400, rotation: 0, angle: 0.1 }, setting: { radius: 256 }, chrome: 'fake',
      headless: true, out, targetY: 50.92, url: 'http://local/viewer/index.html', launch });
    const line = readFileSync(out, 'utf8').trim();
    assert.deepEqual(JSON.parse(line), result);
    assert.equal(result.transfer_bytes, 123);
    assert.equal(result.orbit.frames, 3);
    assert.equal(result.timed_out, false);
    assert.equal(result.target.y, 50.92);
    assert.equal(readFileSync(join(directory, 'brisk-A-top-1.png')).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    console.log(`JSONL sample: ${line}`);
  } finally {
    socket?.close();
    await new Promise(resolve => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
