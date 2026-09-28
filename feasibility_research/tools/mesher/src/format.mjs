import { colourTable } from './colour.mjs';

export async function decodeRegion(source, inflate) {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 14 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'BRSK' || bytes[4] !== 2 || bytes[5] !== 2) throw new Error('Invalid .b3d v2 header');
  let offset = 14;
  function varint(data = bytes, cursor = null) {
    let value = 0, shift = 0;
    for (let n = 0; n < 5; n++) {
      const at = cursor ? cursor.offset++ : offset++;
      if (at >= data.length) throw new Error('Truncated varint');
      const byte = data[at]; value += (byte & 127) * 2 ** shift;
      if (byte < 128) { if (value > 0xffffffff) throw new Error('Varint overflow'); return value; }
      shift += 7;
    }
    throw new Error('Varint too long');
  }
  const count = varint(), palette = [], decoder = new TextDecoder('utf-8', { fatal: true });
  for (let i = 0; i < count; i++) {
    const length = varint();
    if (offset + length > bytes.length) throw new Error('Truncated palette');
    palette.push(decoder.decode(bytes.subarray(offset, offset + length))); offset += length;
  }
  const indexStart = offset, dataStart = indexStart + 8192;
  if (dataStart > bytes.length) throw new Error('Truncated chunk index');
  const chunks = [];
  for (let i = 0; i < 1024; i++) {
    const start = view.getUint32(indexStart + i * 8, false), length = view.getUint32(indexStart + i * 8 + 4, false);
    if (start === 0 && length === 0) continue;
    if (!length || start < dataStart || start + length > bytes.length) throw new Error(`Invalid chunk index ${i}`);
    const raw = await inflate(bytes.subarray(start, start + length));
    const data = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    const cursor = { offset: 0 }, positions = [], paletteIndices = [], masks = [];
    for (let sy = 0; sy < 24; sy++) {
      const n = varint(data, cursor);
      if (n > 4096) throw new Error(`Section ${sy} has too many blocks`);
      let previous = 0;
      for (let j = 0; j < n; j++) {
        const delta = varint(data, cursor), local = previous + delta;
        if (local >= 4096 || (j && delta === 0)) throw new Error('Invalid block position');
        positions.push(sy * 4096 + local); previous = local;
      }
      for (let j = 0; j < n; j++) {
        const paletteIndex = varint(data, cursor);
        if (paletteIndex >= count) throw new Error('Invalid palette index');
        paletteIndices.push(paletteIndex);
      }
      if (cursor.offset + n > data.length) throw new Error('Truncated face masks');
      for (let j = 0; j < n; j++) {
        const mask = data[cursor.offset++];
        if (!mask || mask & 0xc0) throw new Error('Invalid face mask');
        masks.push(mask);
      }
    }
    if (cursor.offset !== data.length) throw new Error('Trailing chunk bytes');
    chunks.push({ index: i, positions: Uint32Array.from(positions), paletteIndices: Uint32Array.from(paletteIndices), masks: Uint8Array.from(masks) });
  }
  return { x: view.getInt32(6, false), z: view.getInt32(10, false), palette, colours: colourTable(palette), chunks };
}
