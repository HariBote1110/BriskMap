import { deflateRawSync } from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

function varint(value) {
  const bytes = [];
  do { const byte = value & 127; value = Math.floor(value / 128); bytes.push(byte | (value ? 128 : 0)); } while (value);
  return Buffer.from(bytes);
}

export function encodeRegion({ x = 0, z = 0, palette, chunks }) {
  const head = Buffer.alloc(14);
  head.write('BRSK'); head[4] = 2; head[5] = 2;
  head.writeInt32BE(x, 6); head.writeInt32BE(z, 10);
  const strings = palette.map(value => { const bytes = Buffer.from(value, 'utf8'); return Buffer.concat([varint(bytes.length), bytes]); });
  const prefix = Buffer.concat([head, varint(palette.length), ...strings]);
  const index = Buffer.alloc(1024 * 8);
  const payloads = [];
  let offset = prefix.length + index.length;
  for (let i = 0; i < 1024; i++) {
    const chunk = chunks.get(i);
    if (!chunk) continue;
    const sections = [];
    for (let sy = 0; sy < 24; sy++) {
      const entries = chunk.filter(block => Math.floor(block.p / 4096) === sy).sort((a, b) => a.p - b.p);
      sections.push(varint(entries.length));
      let previous = 0;
      for (const entry of entries) { const local = entry.p % 4096; sections.push(varint(local - previous)); previous = local; }
      for (const entry of entries) sections.push(varint(entry.palette));
      sections.push(Buffer.from(entries.map(entry => entry.mask)));
    }
    const compressed = deflateRawSync(Buffer.concat(sections));
    index.writeUInt32BE(offset, i * 8);
    index.writeUInt32BE(compressed.length, i * 8 + 4);
    payloads.push(compressed); offset += compressed.length;
  }
  return Buffer.concat([prefix, index, ...payloads]);
}

function height(x, z) { return ((x + z) & 1) ? 96 : 144; }
function syntheticChunk(cx, cz) {
  const blocks = [];
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    const worldX = cx * 16 + x, worldZ = cz * 16 + z;
    const top = height(worldX, worldZ);
    const west = height(worldX - 1, worldZ), east = height(worldX + 1, worldZ);
    const north = height(worldX, worldZ - 1), south = height(worldX, worldZ + 1);
    const bottom = Math.min(top, Math.min(west, east, north, south) + 1);
    for (let y = bottom; y <= top; y++) {
      let mask = (y > west ? 1 : 0) | (y > east ? 2 : 0) | (y > north ? 16 : 0) | (y > south ? 32 : 0);
      if (y === top) mask |= 8;
      if (mask) blocks.push({ p: y * 256 + z * 16 + x, palette: y === top ? 1 : 0, mask });
    }
  }
  return blocks;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const args = process.argv.slice(2);
  const flag = name => args[args.indexOf(name) + 1];
  if (!args.includes('--synthetic') || !args.includes('--out')) throw new Error('Use --synthetic --out DIR [--regions N]');
  const out = flag('--out'); const count = Number(flag('--regions') ?? 1);
  await mkdir(out, { recursive: true });
  for (let r = 0; r < count; r++) {
    const chunks = new Map();
    for (let cz = 0; cz < 32; cz++) for (let cx = 0; cx < 32; cx++) chunks.set(cz * 32 + cx, syntheticChunk(r * 32 + cx, cz));
    await writeFile(join(out, `r.${r}.0.b3d`), encodeRegion({ x: r, z: 0, palette: ['minecraft:stone', 'minecraft:grass_block[snowy=false]'], chunks }));
  }
}
