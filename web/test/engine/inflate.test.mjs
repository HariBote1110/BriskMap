import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { deflateRawSync, inflateRawSync, constants } from 'node:zlib';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { loadMesher } from '../../src/engine/wasm.mjs';

const root = new URL('../fixtures-out/overworld/', import.meta.url);

function payloads(bytes) {
  let at = 16;
  const varint = () => {
    let value = 0, shift = 0, byte;
    do { byte = bytes[at++]; value += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128);
    return value;
  };
  const strings = () => { for (let i = varint(); i > 0; i--) { const length = varint(); at += length; } };
  strings();
  if (bytes[5] === 1) strings();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = [];
  for (let i = 0; i < 1024; i++) {
    const start = view.getUint32(at + i * 8), length = view.getUint32(at + i * 8 + 4);
    if (length) chunks.push(bytes.subarray(start, start + length));
  }
  return chunks;
}

function bitStream(fields) {
  const bits = [];
  for (const [value, width] of fields) for (let bit = 0; bit < width; bit++) bits.push((value >> bit) & 1);
  return Uint8Array.from({ length: Math.ceil(bits.length / 8) }, (_, byte) => bits.slice(byte * 8, byte * 8 + 8).reduce((value, bit, at) => value | (bit << at), 0));
}

if (!isMainThread) {
  const { inflateRaw } = await loadMesher();
  parentPort.postMessage(workerData.every(bytes => {
    try { inflateRaw(Uint8Array.from(bytes)); return false; }
    catch { return true; }
  }));
} else {
  test('WASM inflate matches zlib for every fixture chunk in all 2D and 3D regions', async () => {
    const { inflateRaw } = await loadMesher();
    const files = (await readdir(root)).filter(name => /\.b[23]d$/.test(name)).sort();
    assert.equal(files.length, 8);
    let count = 0;
    for (const file of files) for (const bytes of payloads(await readFile(new URL(file, root)))) {
      assert.deepEqual(inflateRaw(bytes), Uint8Array.from(inflateRawSync(bytes)), `${file} chunk ${count}`);
      count++;
    }
    assert.ok(count >= 4096);
  });

  test('WASM inflate handles stored, fixed and dynamic synthetic streams', async () => {
    const { inflateRaw } = await loadMesher();
    const sizes = [0, 1, 257, 65535, 65536, 1024 * 1024];
    for (const size of sizes) {
      const random = new Uint8Array(size);
      let state = 0x12345678;
      for (let i = 0; i < size; i++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; random[i] = state & 255; }
      const repetitive = Uint8Array.from({ length: size }, (_, i) => i % 23 < 20 ? 65 : 66);
      for (const input of [random, repetitive]) for (const level of [0, 1, 6, 9]) for (const strategy of [constants.Z_DEFAULT_STRATEGY, constants.Z_FIXED, constants.Z_HUFFMAN_ONLY, constants.Z_RLE]) {
        const compressed = deflateRawSync(input, { level, strategy });
        assert.deepEqual(inflateRaw(compressed), input, `size=${size} level=${level} strategy=${strategy}`);
      }
    }
  });

  test('WASM inflate rejects malformed input without hanging or crashing', async () => {
    const small = deflateRawSync(Buffer.from('a repeated pattern '.repeat(8)));
    const damaged = [];
    for (let end = 0; end < small.length; end++) damaged.push([...small.subarray(0, end)]);
    damaged.push([0x07]); // Reserved block type.
    damaged.push([0x01, 0x01, 0x00, 0x00, 0x00, 0x41]); // Wrong stored-length complement.
    damaged.push([0x03, 0x02, 0x00]); // Match distance exceeds empty output.
    const dynamicHeader = [[5, 3], [0, 5], [0, 5], [0, 4]];
    damaged.push([...bitStream([...dynamicHeader, [1, 3], [1, 3], [1, 3], [1, 3]])]); // Over-subscribed code lengths.
    damaged.push([...bitStream([...dynamicHeader, [2, 3], [0, 3], [0, 3], [0, 3]])]); // Incomplete code lengths.
    let seed = 0xdeadbeef;
    for (let i = 0; i < 20; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      const changed = Buffer.from(small);
      changed[Math.abs(seed) % changed.length] ^= 1 << (i % 8);
      try { inflateRawSync(changed); } catch { damaged.push([...changed]); }
    }
    const worker = new Worker(new URL(import.meta.url), { workerData: damaged });
    let timer;
    try {
      const result = await Promise.race([
        new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); worker.once('exit', code => { if (code) reject(new Error(`Inflater worker exited ${code}`)); }); }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Inflater timed out')), 5000); }),
      ]);
      assert.equal(result, true);
    } finally { clearTimeout(timer); await worker.terminate(); }
  });
}
