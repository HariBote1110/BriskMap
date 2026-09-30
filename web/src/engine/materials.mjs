import { colourFor } from './colour.mjs';

export function resolveMaterials(palette, table) {
  if (table.format !== 1 || table.tile !== 16 || table.textures.length !== table.layers) throw new Error('Invalid material table');
  const faceLayers = new Uint16Array(palette.length * 6);
  const faceTints = new Uint8Array(palette.length * 6);
  const opaque = new Uint8Array(palette.length);
  const alphaTest = new Uint8Array(palette.length);
  const shape = new Uint8Array(palette.length);
  for (let i = 0; i < palette.length; i++) {
    const state = palette[i], bracket = state.indexOf('[');
    const name = bracket < 0 ? state : state.slice(0, bracket);
    const properties = Object.create(null);
    if (bracket >= 0) for (const pair of state.slice(bracket + 1, -1).split(',')) {
      const equals = pair.indexOf('='); if (equals >= 0) properties[pair.slice(0, equals)] = pair.slice(equals + 1);
    }
    const entry = table.blocks[name]?.find(candidate => Object.entries(candidate.when).every(([key, value]) => properties[key] === value));
    if (!entry) { alphaTest[i] = 1; continue; }
    for (let face = 0; face < 6; face++) {
      const layer = entry.faces[face], tint = entry.tints[face];
      if (!Number.isInteger(layer) || layer < 0 || layer >= table.layers || !Number.isInteger(tint) || tint < 0 || tint > 4) throw new Error('Invalid material entry');
      faceLayers[i * 6 + face] = layer;
      faceTints[i * 6 + face] = tint;
    }
    opaque[i] = entry.fullCube && !entry.transparent ? 1 : 0;
    alphaTest[i] = entry.transparent ? 1 : 0;
    shape[i] = entry.shape === 'cross' ? 1 : 0;
  }
  return { faceLayers, faceTints, opaque, alphaTest, shape };
}

export function syntheticMaterials(palette) {
  const faceLayers = new Uint16Array(palette.length * 6);
  for (let i = 0; i < palette.length; i++) faceLayers.fill((colourFor(palette[i]) & 63) + 1, i * 6, i * 6 + 6);
  return { faceLayers, faceTints: new Uint8Array(palette.length * 6), opaque: new Uint8Array(palette.length).fill(1), alphaTest: new Uint8Array(palette.length), shape: new Uint8Array(palette.length) };
}

export function flatMaterials(palette, register) {
  const faceLayers = new Uint16Array(palette.length * 6);
  for (let index = 0; index < palette.length; index++) {
    const bracket=palette[index].indexOf('[');
    const name=bracket<0?palette[index]:palette[index].slice(0,bracket);
    faceLayers.fill(register(name), index * 6, index * 6 + 6);
  }
  return {
    faceLayers,
    faceTints: new Uint8Array(palette.length * 6),
    opaque: new Uint8Array(palette.length).fill(1),
    alphaTest: new Uint8Array(palette.length),
    shape: new Uint8Array(palette.length)
  };
}
