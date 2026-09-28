import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { deflateRawSync, deflateSync } from 'node:zlib';
import { crc32, decodePng, encodePng } from '../png.mjs';
import { ZipReader } from '../zip.mjs';
import { buildMaterials, resolveModel, rotateFace } from '../models.mjs';

const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const chunk = (name, data) => Buffer.concat([u32(data.length), Buffer.from(name), data, u32(crc32(Buffer.concat([Buffer.from(name), data])))]);
function rawPng(type, width, height, rows, palette, transparency, depth = 8) {
  const head = Buffer.alloc(13); head.writeUInt32BE(width); head.writeUInt32BE(height, 4); head[8] = depth; head[9] = type;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', head), ...(palette ? [chunk('PLTE', palette)] : []), ...(transparency ? [chunk('tRNS', transparency)] : []), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

test('CRC32 reference and RGBA encode/decode', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  const pixels = Buffer.from([255, 0, 12, 255, 0, 20, 255, 50]);
  assert.deepEqual(decodePng(encodePng(2, 1, pixels)).pixels, pixels);
});

test('PNG colour types and tRNS', () => {
  const cases = [
    [0, Buffer.from([0, 90]), null, null, [90,90,90,255]],
    [2, Buffer.from([0, 1,2,3]), null, null, [1,2,3,255]],
    [3, Buffer.from([0, 1]), Buffer.from([4,5,6,7,8,9]), Buffer.from([255,20]), [7,8,9,20]],
    [4, Buffer.from([0, 40,50]), null, null, [40,40,40,50]],
    [6, Buffer.from([0, 1,2,3,4]), null, null, [1,2,3,4]],
  ];
  for (const [type, rows, palette, transparency, expected] of cases) assert.deepEqual([...decodePng(rawPng(type, 1, 1, rows, palette, transparency)).pixels], expected);
});

test('packed palette and greyscale images in the client jar', () => {
  const palette = Buffer.from([0,0,0,255,0,255]);
  assert.deepEqual([...decodePng(rawPng(3, 2, 1, Buffer.from([0, 0x01]), palette, Buffer.from([255,128]), 4)).pixels], [0,0,0,255,255,0,255,128]);
  assert.deepEqual([...decodePng(rawPng(0, 2, 1, Buffer.from([0, 0x40]), null, null, 2)).pixels], [85,85,85,255,0,0,0,255]);
});

test('PNG filters 0 through 4', () => {
  for (let filter = 0; filter < 5; filter++) {
    const prior = [10,20,30], wanted = [30,50,70];
    const predictors = [0, 0, 10, 20, 15][filter];
    const row = Buffer.from([filter, ...wanted.map((v, i) => (v - (filter === 2 ? prior[i] : filter === 3 ? Math.floor(prior[i]/2) : filter === 4 ? prior[i] : predictors) + 256) % 256)]);
    const png = rawPng(2, 1, 2, Buffer.concat([Buffer.from([0,...prior]), row]));
    assert.deepEqual([...decodePng(png).pixels.subarray(4)], [...wanted,255], `filter ${filter}`);
  }
});

function zipFixture(entries) {
  const local = [], central = []; let offset = 0;
  for (const [name, content, method] of entries) {
    const filename = Buffer.from(name), packed = method === 8 ? deflateRawSync(content) : content;
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50); h.writeUInt16LE(method, 8); h.writeUInt32LE(crc32(content), 14); h.writeUInt32LE(packed.length, 18); h.writeUInt32LE(content.length, 22); h.writeUInt16LE(filename.length, 26);
    local.push(h, filename, packed);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(method, 10); c.writeUInt32LE(crc32(content), 16); c.writeUInt32LE(packed.length, 20); c.writeUInt32LE(content.length, 24); c.writeUInt16LE(filename.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, filename); offset += h.length + filename.length + packed.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}
test('ZIP stored and deflated', () => {
  const zip = new ZipReader(zipFixture([['a', Buffer.from('stored'), 0], ['b', Buffer.from('deflated'), 8]]));
  assert.equal(zip.read('a').toString(), 'stored'); assert.equal(zip.read('b').toString(), 'deflated');
});

test('parent textures and recursive texture references', () => {
  const files = new Map([
    ['assets/minecraft/models/block/base.json', JSON.stringify({textures:{all:'block/stone', side:'#all'}, elements:[{from:[0,0,0],to:[16,16,16],faces:{north:{texture:'#side'}}}]})],
    ['assets/minecraft/models/block/child.json', JSON.stringify({parent:'block/base',textures:{all:'block/dirt'}})],
  ]);
  const model = resolveModel('block/child', path => files.get(path));
  assert.equal(model.texture('#side'), 'minecraft:block/dirt');
  assert.equal(model.elements.length, 1);
});

test('face rotations follow x then y', () => {
  assert.equal(rotateFace(2,90,90), 0);
  assert.equal(rotateFace(3,90,90), 1);
  assert.equal(rotateFace(4,90,0), 3);
  assert.equal(rotateFace(4,0,90), 0);
});

const jar = 'feasibility_research/output/client/minecraft-client-26.3.jar';
test('real jar block materials', {skip: !existsSync(jar) && 'Minecraft client jar is absent'}, () => {
  const result = buildMaterials(new ZipReader(readFileSync(jar)));
  const {blocks, textures} = result;
  const stone = blocks['minecraft:stone'][0];
  assert.equal(new Set(stone.faces).size, 1); assert.equal(stone.fullCube, true); assert.equal(stone.transparent, false);
  const leaves = blocks['minecraft:oak_leaves'][0]; assert.equal(leaves.transparent, true); assert.ok(leaves.tints.includes(2));
  const water = blocks['minecraft:water'][0]; assert.deepEqual(water.tints, [3,3,3,3,3,3]); assert.equal(textures[water.faces[0]], 'minecraft:block/water_still');
  const grass = blocks['minecraft:grass_block'].find(e => e.when.snowy === 'false');
  assert.equal(grass.tints[3], 1); assert.equal(textures[grass.faces[2]], 'minecraft:block/dirt');
  for (const axis of ['x','y','z']) {
    const log = blocks['minecraft:oak_log'].find(e => e.when.axis === axis);
    const ends = axis === 'x' ? [0,1] : axis === 'y' ? [2,3] : [4,5];
    for (const face of ends) assert.equal(textures[log.faces[face]], 'minecraft:block/oak_log_top');
  }
});
