const volume = 16 * 384 * 16;
const dimensions = [16, 384, 16];

export function meshChunk({ positions, paletteIndices, masks, colours }, mode = 'culled') {
  if (mode !== 'culled' && mode !== 'greedy') throw new Error(`Unknown mode: ${mode}`);
  if (positions.length !== paletteIndices.length || positions.length !== masks.length) throw new Error('Mismatched input lengths');
  const grid = new Uint32Array(6 * volume);
  const present = new Uint8Array(6 * volume);
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i], colour = colours[paletteIndices[i]], mask = masks[i];
    if (p >= volume || colour === undefined || !mask || mask & 0xc0) throw new Error('Invalid mesh input');
    for (let normal = 0; normal < 6; normal++) if (mask & (1 << normal)) { grid[normal * volume + p] = colour; present[normal * volume + p] = 1; }
  }
  let vertices = new Uint8Array(4096), indices = new Uint32Array(1024);
  let vertexLength = 0, indexLength = 0, quads = 0;
  function vertex(x, y, z, normal, colour) {
    if (vertexLength + 12 > vertices.length) { const next = new Uint8Array(vertices.length * 2); next.set(vertices); vertices = next; }
    const at = vertexLength;
    vertices[at] = x & 255; vertices[at + 1] = x >>> 8;
    vertices[at + 2] = y & 255; vertices[at + 3] = y >>> 8;
    vertices[at + 4] = z & 255; vertices[at + 5] = z >>> 8;
    vertices[at + 6] = normal; vertices[at + 7] = 0;
    vertices[at + 8] = colour & 255; vertices[at + 9] = colour >>> 8 & 255;
    vertices[at + 10] = colour >>> 16 & 255; vertices[at + 11] = colour >>> 24;
    vertexLength += 12;
  }
  function quad(axis, direction, slice, u0, v0, width, height, colour) {
    if (indexLength + 6 > indices.length) { const next = new Uint32Array(indices.length * 2); next.set(indices); indices = next; }
    const normal = axis * 2 + direction, u1 = u0 + width, v1 = v0 + height, plane = slice + direction;
    const base = vertexLength / 12;
    if (axis === 0) {
      vertex(plane, u0, v0, normal, colour);
      if (direction) { vertex(plane, u1, v0, normal, colour); vertex(plane, u1, v1, normal, colour); vertex(plane, u0, v1, normal, colour); }
      else { vertex(plane, u0, v1, normal, colour); vertex(plane, u1, v1, normal, colour); vertex(plane, u1, v0, normal, colour); }
    } else if (axis === 1) {
      vertex(v0, plane, u0, normal, colour);
      if (direction) { vertex(v0, plane, u1, normal, colour); vertex(v1, plane, u1, normal, colour); vertex(v1, plane, u0, normal, colour); }
      else { vertex(v1, plane, u0, normal, colour); vertex(v1, plane, u1, normal, colour); vertex(v0, plane, u1, normal, colour); }
    } else {
      vertex(u0, v0, plane, normal, colour);
      if (direction) { vertex(u1, v0, plane, normal, colour); vertex(u1, v1, plane, normal, colour); vertex(u0, v1, plane, normal, colour); }
      else { vertex(u0, v1, plane, normal, colour); vertex(u1, v1, plane, normal, colour); vertex(u1, v0, plane, normal, colour); }
    }
    indices[indexLength++] = base; indices[indexLength++] = base + 1; indices[indexLength++] = base + 2;
    indices[indexLength++] = base; indices[indexLength++] = base + 2; indices[indexLength++] = base + 3;
    quads++;
  }
  for (let axis = 0; axis < 3; axis++) for (let direction = 0; direction < 2; direction++) {
    const normal = axis * 2 + direction, base = normal * volume;
    const uAxis = (axis + 1) % 3, vAxis = (axis + 2) % 3;
    const uLimit = dimensions[uAxis], vLimit = dimensions[vAxis];
    const uStep = [1, 256, 16][uAxis], vStep = [1, 256, 16][vAxis];
    const sliceStep = [1, 256, 16][axis];
    for (let slice = 0; slice < dimensions[axis]; slice++) for (let v = 0; v < vLimit; v++) for (let u = 0; u < uLimit; u++) {
      const at = base + slice * sliceStep + v * vStep + u * uStep, colour = grid[at];
      if (!present[at]) continue;
      let width = 1, height = 1;
      if (mode === 'greedy') {
        while (u + width < uLimit && present[at + width * uStep] && grid[at + width * uStep] === colour) width++;
        outer: while (v + height < vLimit) {
          for (let w = 0; w < width; w++) if (!present[at + height * vStep + w * uStep] || grid[at + height * vStep + w * uStep] !== colour) break outer;
          height++;
        }
      }
      for (let h = 0; h < height; h++) for (let w = 0; w < width; w++) present[at + h * vStep + w * uStep] = 0;
      quad(axis, direction, slice, u, v, width, height, colour);
    }
  }
  return { vertices: vertices.slice(0, vertexLength), indices: indices.slice(0, indexLength), quads };
}
