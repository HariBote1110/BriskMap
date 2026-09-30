import { colourFor } from './colour.mjs';
import { resolveMaterials } from './materials.mjs';

const tints = [[255,255,255],[145,189,89],[119,171,47],[63,118,228],[255,255,255]];
const darkWater = [30,65,130];

export function meanLayers(pixels, layers) {
  if (pixels.length !== layers * 1024) throw new Error('Invalid atlas pixels');
  const result = new Uint8Array(layers * 3);
  for (let layer = 0; layer < layers; layer++) {
    const sums = [0,0,0];
    let count = 0;
    for (let pixel = layer * 256; pixel < (layer + 1) * 256; pixel++) {
      if (pixels[pixel * 4 + 3] < 128) continue;
      for (let channel = 0; channel < 3; channel++) sums[channel] += pixels[pixel * 4 + channel];
      count++;
    }
    for (let channel = 0; channel < 3; channel++) result[layer * 3 + channel] = count ? Math.round(sums[channel] / count) : 0;
  }
  return result;
}

export function regionColours(palette, table = null, means = null) {
  const colours = new Float64Array(palette.length * 3);
  const materials = table && means ? resolveMaterials(palette, table) : null;
  for (let block = 0; block < palette.length; block++) {
    const bracket = palette[block].indexOf('[');
    const name = bracket < 0 ? palette[block] : palette[block].slice(0, bracket);
    const hash = colourFor(name);
    const face = materials?.shape[block] === 1 ? 4 : 3;
    const layer = materials?.faceLayers[block * 6 + face] ?? 0;
    const tint = materials?.faceTints[block * 6 + face] ?? 0;
    for (let channel = 0; channel < 3; channel++) {
      colours[block * 3 + channel] = materials
        ? means[layer * 3 + channel] * tints[tint][channel] / 255
        : (hash >> channel * 8) & 255;
    }
  }
  return colours;
}

function writeColumn(result, at, block, water, y, north, colours) {
  if (y === -32768) return;
  const shade = north === -32768 || y === north ? 1 : y > north ? 1.1 : .9;
  const blend = Math.min(water, 16) / 16 * .38;
  for (let channel = 0; channel < 3; channel++) {
    const base = colours[block * 3 + channel];
    result[at * 4 + channel] = Math.round(Math.min(255, Math.max(0, (base * (1 - blend) + darkWater[channel] * blend) * shade)));
  }
  result[at * 4 + 3] = 255;
}

export function shadeNorthRow(row, northHeights, colours) {
  const pixels = new Uint8Array(512 * 4);
  for (let x = 0; x < 512; x++) {
    writeColumn(pixels, x, row.blocks[x], row.waters[x], row.heights[x], northHeights[x], colours);
  }
  return pixels;
}

export function rasteriseRegion(chunks, header, table = null, means = null, colours = regionColours(header.palette, table, means)) {
  const pixels = new Uint8Array(512 * 512 * 4);
  const heights = new Int16Array(512 * 512).fill(-32768);
  const blocks = new Uint32Array(512 * 512);
  const waters = new Uint8Array(512 * 512);
  for (const {index, columns} of chunks) {
    const originX = (index & 31) * 16;
    const originZ = (index >> 5) * 16;
    for (let column = 0; column < 256; column++) {
      const at = originX + (column & 15) + (originZ + (column >> 4)) * 512;
      heights[at] = columns[column].y;
      blocks[at] = columns[column].block;
      waters[at] = columns[column].water;
    }
  }
  for (let z = 0; z < 512; z++) for (let x = 0; x < 512; x++) {
    const at = x + z * 512;
    writeColumn(pixels, at, blocks[at], waters[at], heights[at], z > 0 ? heights[at - 512] : heights[at], colours);
  }
  return pixels;
}
