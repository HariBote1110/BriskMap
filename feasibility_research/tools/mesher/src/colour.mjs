const encoder = new TextEncoder();
export function colourFor(value) {
  let hash = 0x811c9dc5;
  for (const byte of encoder.encode(value)) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return (hash & 0x00ffffff) | 0xff000000;
}
export function colourTable(palette) { return Uint32Array.from(palette, colourFor); }
