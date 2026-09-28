import { deflateSync, inflateSync } from 'node:zlib';

const signature = Buffer.from('89504e470d0a1a0a', 'hex');
const table = new Uint32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
export function crc32(data) { let c = 0xffffffff; for (const byte of data) c = table[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(name, data) { const tag = Buffer.from(name), result = Buffer.alloc(12 + data.length); result.writeUInt32BE(data.length); tag.copy(result, 4); data.copy(result, 8); result.writeUInt32BE(crc32(result.subarray(4, 8 + data.length)), 8 + data.length); return result; }
export function encodePng(width, height, pixels) {
  if (pixels.length !== width * height * 4) throw new Error('Invalid RGBA length');
  const head = Buffer.alloc(13); head.writeUInt32BE(width); head.writeUInt32BE(height, 4); head[8] = 8; head[9] = 6;
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) pixels.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([signature, chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
export function decodePng(data) {
  if (!data.subarray(0, 8).equals(signature)) throw new Error('Invalid PNG signature');
  let width, height, type, depth, palette, transparency; const parts = [];
  for (let at = 8; at < data.length;) {
    const size = data.readUInt32BE(at), name = data.toString('ascii', at + 4, at + 8), body = data.subarray(at + 8, at + 8 + size);
    if (at + size + 12 > data.length || crc32(data.subarray(at + 4, at + 8 + size)) !== data.readUInt32BE(at + 8 + size)) throw new Error('Invalid PNG chunk');
    if (name === 'IHDR') { width = body.readUInt32BE(); height = body.readUInt32BE(4); depth = body[8]; type = body[9]; if ((depth !== 8 && !([0,3].includes(type) && [1,2,4].includes(depth))) || body[12] !== 0) throw new Error('Unsupported PNG depth or interlace'); }
    if (name === 'PLTE') palette = body;
    if (name === 'tRNS') transparency = body;
    if (name === 'IDAT') parts.push(body);
    at += size + 12;
    if (name === 'IEND') break;
  }
  const channels = {0:1,2:3,3:1,4:2,6:4}[type];
  if (!channels || !width || !height) throw new Error('Unsupported PNG colour type');
  const stride = Math.ceil(width * channels * depth / 8), bpp = Math.max(1, Math.ceil(channels * depth / 8)), raw = inflateSync(Buffer.concat(parts)), pixels = Buffer.alloc(width * height * 4);
  let pos = 0, prior = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++], row = Buffer.alloc(stride);
    if (filter > 4 || pos + stride > raw.length) throw new Error('Invalid PNG filter or data');
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? row[i - bpp] : 0, up = prior[i], corner = i >= bpp ? prior[i - bpp] : 0;
      const p = left + up - corner, a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - corner);
      const predictor = [0, left, up, Math.floor((left + up) / 2), a <= b && a <= c ? left : b <= c ? up : corner][filter];
      row[i] = (raw[pos++] + predictor) & 255;
    }
    for (let x = 0; x < width; x++) {
      const s = x * channels, d = (y * width + x) * 4;
      if (type === 0) { const value = depth === 8 ? row[s] : ((row[Math.floor(x * depth / 8)] >>> (8 - depth - (x * depth) % 8)) & ((1 << depth) - 1)) * 255 / ((1 << depth) - 1); pixels[d] = pixels[d+1] = pixels[d+2] = value; pixels[d+3] = 255; }
      else if (type === 2) { pixels[d] = row[s]; pixels[d+1] = row[s+1]; pixels[d+2] = row[s+2]; pixels[d+3] = 255; }
      else if (type === 3) { const index = depth === 8 ? row[s] : (row[Math.floor(x * depth / 8)] >>> (8 - depth - (x * depth) % 8)) & ((1 << depth) - 1); const colour = index * 3; if (!palette || colour + 2 >= palette.length) throw new Error('Invalid PNG palette'); pixels[d] = palette[colour]; pixels[d+1] = palette[colour+1]; pixels[d+2] = palette[colour+2]; pixels[d+3] = transparency?.[index] ?? 255; }
      else if (type === 4) { pixels[d] = pixels[d+1] = pixels[d+2] = row[s]; pixels[d+3] = row[s+1]; }
      else { row.copy(pixels, d, s, s+4); }
    }
    prior = row;
  }
  return {width, height, pixels};
}
