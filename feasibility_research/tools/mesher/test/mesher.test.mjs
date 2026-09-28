import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { encodeRegion } from './encode.mjs';
import { decodeRegion } from '../src/format.mjs';
import { colourFor } from '../src/colour.mjs';
import { meshChunk as meshJs } from '../src/mesh-js.mjs';
import { loadMesher } from '../src/wasm.mjs';

const popcount = mask => { let n = 0; while (mask) { n += mask & 1; mask >>>= 1; } return n; };
const fixture = () => {
  const blocks = [{ p: 0, palette: 0, mask: 63 }, { p: 4095, palette: 1, mask: 8 }, { p: 4096, palette: 0, mask: 1 }];
  const full = Array.from({ length: 4096 }, (_, p) => ({ p: 2 * 4096 + p, palette: p & 1, mask: 8 }));
  return { palette: ['minecraft:stone', 'minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]'], chunks: new Map([[0, blocks], [35, full]]) };
};

test('v2 round trip: palette, absent chunks, empty and full sections', async () => {
  const source = fixture();
  const decoded = await decodeRegion(encodeRegion({ x: -2, z: 3, ...source }), data => inflateRawSync(data));
  assert.equal(decoded.x, -2); assert.equal(decoded.z, 3);
  assert.deepEqual(decoded.palette, source.palette);
  assert.equal(decoded.chunks.length, 2);
  assert.equal(decoded.chunks[0].index, 0); assert.equal(decoded.chunks[1].index, 35);
  for (const chunk of decoded.chunks) {
    const expected = source.chunks.get(chunk.index);
    assert.deepEqual(Array.from(chunk.positions), expected.map(v => v.p));
    assert.deepEqual(Array.from(chunk.paletteIndices), expected.map(v => v.palette));
    assert.deepEqual(Array.from(chunk.masks), expected.map(v => v.mask));
  }
});

function corners(p, normal) {
  const xyz = [p & 15, p >>> 8, (p >>> 4) & 15];
  const axis = normal >>> 1, positive = normal & 1;
  const u = (axis + 1) % 3, v = (axis + 2) % 3;
  xyz[axis] += positive;
  const points = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([a, b]) => { const point = [...xyz]; point[u] += a; point[v] += b; return point; });
  return positive ? points : [points[0], points[3], points[2], points[1]];
}
function readQuads(mesh) {
  const view = new DataView(mesh.vertices.buffer, mesh.vertices.byteOffset, mesh.vertices.byteLength);
  const quads = [];
  for (let q = 0; q < mesh.quads; q++) {
    const points = []; let normal, colour;
    for (let n = 0; n < 4; n++) {
      const at = (q * 4 + n) * 12;
      points.push([view.getUint16(at, true), view.getUint16(at + 2, true), view.getUint16(at + 4, true)]);
      normal = view.getUint8(at + 6); colour = view.getUint32(at + 8, true);
      assert.equal(view.getUint8(at + 7), 0);
    }
    assert.deepEqual(Array.from(mesh.indices.slice(q * 6, q * 6 + 6)), [q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3]);
    quads.push({ points, normal, colour });
  }
  return quads;
}
function coverage(mesh) {
  const faces = new Map();
  for (const { points, normal, colour } of readQuads(mesh)) {
    const axis = normal >>> 1, u = (axis + 1) % 3, v = (axis + 2) % 3;
    const plane = points[0][axis];
    const us = points.map(point => point[u]), vs = points.map(point => point[v]);
    for (let b = Math.min(...vs); b < Math.max(...vs); b++) for (let a = Math.min(...us); a < Math.max(...us); a++) {
      const key = `${normal}/${colour}/${plane}/${a}/${b}`;
      assert.equal(faces.has(key), false, `overlap: ${key}`); faces.set(key, true);
    }
  }
  return [...faces.keys()].sort();
}
function input(blocks, palette = ['minecraft:stone', 'minecraft:dirt']) {
  return { positions: Uint32Array.from(blocks.map(v => v.p)), paletteIndices: Uint32Array.from(blocks.map(v => v.palette)), masks: Uint8Array.from(blocks.map(v => v.mask)), colours: Uint32Array.from(palette.map(colourFor)) };
}

test('transparent black remains a present face', () => {
  const sample = { positions: Uint32Array.of(0), paletteIndices: Uint32Array.of(0), masks: Uint8Array.of(8), colours: Uint32Array.of(0) };
  for (const mode of ['culled', 'greedy']) assert.equal(meshJs(sample, mode).quads, 1);
});

test('culled emits exactly the set faces with outward corners', () => {
  const block = input([{ p: 5 * 256 + 3 * 16 + 2, palette: 0, mask: 63 }]);
  const mesh = meshJs(block, 'culled');
  assert.equal(mesh.quads, block.masks.reduce((n, mask) => n + popcount(mask), 0));
  const quads = readQuads(mesh);
  assert.deepEqual(quads.map(quad => quad.normal).sort((a, b) => a - b), Array.from({ length: 6 }, (_, normal) => normal));
  for (const quad of quads) assert.deepEqual(quad.points, corners(block.positions[0], quad.normal));
});

let seed = 0x12345678;
function random() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; }
const samples = Array.from({ length: 3 }, () => {
  const blocks = new Map();
  for (let n = 0; n < 500; n++) { const p = (random() % 8) * 256 + (random() % 16) * 16 + random() % 16; blocks.set(p, { p, palette: random() % 2, mask: 1 + random() % 63 }); }
  return input([...blocks.values()]);
});

samples.push({ positions: Uint32Array.of(0), paletteIndices: Uint32Array.of(0), masks: Uint8Array.of(8), colours: Uint32Array.of(0) });

test('greedy coverage matches culled with no gaps or overlaps', () => {
  for (const sample of samples) {
    const culled = meshJs(sample, 'culled'), greedy = meshJs(sample, 'greedy');
    assert.deepEqual(coverage(greedy), coverage(culled));
    assert.ok(greedy.quads <= culled.quads);
  }
});

test('JS and WASM buffers are byte-identical in both modes', async () => {
  const wasm = await loadMesher();
  for (const sample of samples) for (const mode of ['culled', 'greedy']) {
    const js = meshJs(sample, mode), rs = wasm.meshChunk(sample, mode);
    assert.deepEqual(rs.vertices, js.vertices);
    assert.deepEqual(new Uint8Array(rs.indices.buffer), new Uint8Array(js.indices.buffer));
  }
});
