const volume = 16 * 384 * 16;
const dimensions = [16, 384, 16];
const steps = [1, 256, 16];
const cells = new Uint32Array(volume);
// Anticlockwise from outside: negative faces 00,01,11,10; positive faces 00,10,11,01.
const cornerU = [[0, 0, 1, 1], [0, 1, 1, 0]];
const cornerV = [[0, 1, 1, 0], [0, 0, 1, 1]];

export function meshChunk({ positions, paletteIndices, masks, materials }, mode = 'culled') {
  if (mode !== 'culled' && mode !== 'greedy') throw new Error(`Unknown mode: ${mode}`);
  if (positions.length !== paletteIndices.length || positions.length !== masks.length) throw new Error('Mismatched input lengths');
  const { faceLayers, faceTints, opaque, alphaTest } = materials;
  const paletteCount = opaque.length;
  if (faceLayers.length !== paletteCount * 6 || faceTints.length !== paletteCount * 6 || alphaTest.length !== paletteCount) throw new Error('Mismatched material lengths');
  cells.fill(0);
  const keys = new Uint32Array(6 * volume), aoGrid = new Uint8Array(6 * volume), present = new Uint8Array(6 * volume);
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i], palette = paletteIndices[i], mask = masks[i];
    if (p >= volume || palette >= paletteCount || !mask || mask & 0xc0) throw new Error('Invalid mesh input');
    cells[p] = palette + 1;
  }
  function solid(x, y, z) {
    if (x < 0 || x >= 16 || y < 0 || y >= 384 || z < 0 || z >= 16) return 0;
    const entry = cells[x + y * 256 + z * 16];
    return entry && opaque[entry - 1] ? 1 : 0;
  }
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i], palette = paletteIndices[i], mask = masks[i];
    const x = p & 15, y = p >>> 8, z = p >>> 4 & 15;
    for (let normal = 0; normal < 6; normal++) if (mask & 1 << normal) {
      const axis = normal >>> 1, direction = normal & 1, uAxis = (axis + 1) % 3, vAxis = (axis + 2) % 3;
      const offset = direction ? 1 : -1;
      const nx = x + (axis === 0 ? offset : 0), ny = y + (axis === 1 ? offset : 0), nz = z + (axis === 2 ? offset : 0);
      let packedAo = 0;
      for (let corner = 0; corner < 4; corner++) {
        const du = cornerU[direction][corner] ? 1 : -1, dv = cornerV[direction][corner] ? 1 : -1;
        const s1 = solid(nx + (uAxis === 0 ? du : 0), ny + (uAxis === 1 ? du : 0), nz + (uAxis === 2 ? du : 0));
        const s2 = solid(nx + (vAxis === 0 ? dv : 0), ny + (vAxis === 1 ? dv : 0), nz + (vAxis === 2 ? dv : 0));
        const diagonal = solid(nx + (uAxis === 0 ? du : 0) + (vAxis === 0 ? dv : 0), ny + (uAxis === 1 ? du : 0) + (vAxis === 1 ? dv : 0), nz + (uAxis === 2 ? du : 0) + (vAxis === 2 ? dv : 0));
        packedAo |= (s1 && s2 ? 0 : 3 - s1 - s2 - diagonal) << (corner * 2);
      }
      const at = normal * volume + p, face = palette * 6 + normal;
      keys[at] = faceLayers[face] | faceTints[face] << 16 | alphaTest[palette] << 24;
      aoGrid[at] = packedAo; present[at] = 1;
    }
  }
  let vertices = new Uint8Array(4096), indices = new Uint32Array(1024);
  let vertexLength = 0, indexLength = 0, quads = 0;
  function vertex(x, y, z, normal, ao, key) {
    if (vertexLength + 12 > vertices.length) { const next = new Uint8Array(vertices.length * 2); next.set(vertices); vertices = next; }
    const at = vertexLength;
    vertices[at] = x & 255; vertices[at + 1] = x >>> 8;
    vertices[at + 2] = y & 255; vertices[at + 3] = y >>> 8;
    vertices[at + 4] = z & 255; vertices[at + 5] = z >>> 8;
    vertices[at + 6] = normal; vertices[at + 7] = ao;
    vertices[at + 8] = key & 255; vertices[at + 9] = key >>> 8 & 255;
    vertices[at + 10] = key >>> 16 & 255; vertices[at + 11] = key >>> 24 & 255;
    vertexLength += 12;
  }
  function quad(axis, direction, slice, u0, v0, width, height, key, packedAo) {
    if (indexLength + 6 > indices.length) { const next = new Uint32Array(indices.length * 2); next.set(indices); indices = next; }
    const normal = axis * 2 + direction, plane = slice + direction, u1 = u0 + width, v1 = v0 + height, base = vertexLength / 12;
    for (let corner = 0; corner < 4; corner++) {
      const u = cornerU[direction][corner] ? u1 : u0, v = cornerV[direction][corner] ? v1 : v0;
      const ao = packedAo >>> (corner * 2) & 3;
      if (axis === 0) vertex(plane, u, v, normal, ao, key);
      else if (axis === 1) vertex(v, plane, u, normal, ao, key);
      else vertex(u, v, plane, normal, ao, key);
    }
    const flipped = ((packedAo & 3) + (packedAo >>> 4 & 3)) < ((packedAo >>> 2 & 3) + (packedAo >>> 6 & 3));
    indices[indexLength++] = base; indices[indexLength++] = base + 1; indices[indexLength++] = base + (flipped ? 3 : 2);
    indices[indexLength++] = base + (flipped ? 1 : 0); indices[indexLength++] = base + 2; indices[indexLength++] = base + 3;
    quads++;
  }
  for (let axis = 0; axis < 3; axis++) for (let direction = 0; direction < 2; direction++) {
    const normal = axis * 2 + direction, base = normal * volume;
    const uAxis = (axis + 1) % 3, vAxis = (axis + 2) % 3;
    const uLimit = dimensions[uAxis], vLimit = dimensions[vAxis];
    const uStep = steps[uAxis], vStep = steps[vAxis], sliceStep = steps[axis];
    for (let slice = 0; slice < dimensions[axis]; slice++) for (let v = 0; v < vLimit; v++) for (let u = 0; u < uLimit; u++) {
      const at = base + slice * sliceStep + v * vStep + u * uStep;
      if (!present[at]) continue;
      const key = keys[at], packedAo = aoGrid[at];
      let width = 1, height = 1;
      if (mode === 'greedy') {
        while (u + width < uLimit && present[at + width * uStep] && keys[at + width * uStep] === key && aoGrid[at + width * uStep] === packedAo) width++;
        outer: while (v + height < vLimit) {
          for (let w = 0; w < width; w++) { const next = at + height * vStep + w * uStep; if (!present[next] || keys[next] !== key || aoGrid[next] !== packedAo) break outer; }
          height++;
        }
      }
      for (let h = 0; h < height; h++) for (let w = 0; w < width; w++) present[at + h * vStep + w * uStep] = 0;
      quad(axis, direction, slice, u, v, width, height, key, packedAo);
    }
  }
  return { vertices: vertices.slice(0, vertexLength), indices: indices.slice(0, indexLength), quads };
}
