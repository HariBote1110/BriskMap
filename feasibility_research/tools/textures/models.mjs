import { decodePng } from './png.mjs';

const directions = ['west','east','down','up','north','south'];
export const tints = ['none','grass','foliage','water','other'];
const normalise = name => name.includes(':') ? name : `minecraft:${name}`;
const pathFor = (kind, name) => { const [namespace, path] = normalise(name).split(':'); return `assets/${namespace}/${kind}/${path}.json`; };
const parse = data => data === undefined ? undefined : JSON.parse(data.toString());

export function resolveModel(name, read, cache = new Map(), trail = new Set()) {
  name = normalise(name);
  if (cache.has(name)) return cache.get(name);
  if (trail.size >= 20 || trail.has(name)) throw new Error(`Model parent depth or cycle: ${name}`);
  const own = parse(read(pathFor('models', name)));
  if (!own) return undefined;
  trail.add(name);
  const parent = own.parent ? resolveModel(own.parent, read, cache, trail) : undefined;
  trail.delete(name);
  const textures = {...parent?.textures, ...own.textures};
  const result = {textures, elements: own.elements ?? parent?.elements ?? [], texture(ref) {
    const visited = new Set();
    while (typeof ref === 'string' && ref.startsWith('#')) {
      if (visited.has(ref)) return undefined;
      visited.add(ref); ref = textures[ref.slice(1)];
    }
    return typeof ref === 'string' ? normalise(ref) : undefined;
  }};
  cache.set(name, result);
  return result;
}

export function rotateFace(face, x = 0, y = 0) {
  let vector = [[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]][face];
  for (let i = 0; i < ((x % 360 + 360) % 360) / 90; i++) vector = [vector[0], -vector[2], vector[1]];
  for (let i = 0; i < ((y % 360 + 360) % 360) / 90; i++) vector = [vector[2], vector[1], -vector[0]];
  return [[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]].findIndex(v => v.every((n,i) => n === vector[i]));
}

function tintFor(block) {
  if (block.includes('water')) return 3;
  if (block === 'lily_pad' || block === 'vine' || (block.includes('leaves') && !/(cherry|azalea|flowering|pale)/.test(block))) return 2;
  if (block === 'grass_block' || block === 'short_grass' || block === 'tall_grass' || block === 'fern' || block === 'large_fern' || block === 'sugar_cane' || block.includes('grass')) return 1;
  return 4;
}

function faceData(model) {
  const full = model.elements.find(e => JSON.stringify(e.from) === '[0,0,0]' && JSON.stringify(e.to) === '[16,16,16]');
  const chosen = Array(6);
  if (full) for (let i = 0; i < 6; i++) chosen[i] = full.faces?.[directions[i]];
  else {
    for (let i = 0; i < 6; i++) {
      let volume = -1;
      for (const element of model.elements) {
        const face = element.faces?.[directions[i]];
        if (!face) continue;
        const v = element.to.reduce((n, high, axis) => n * Math.max(0, high - element.from[axis]), 1);
        if (v > volume) { volume = v; chosen[i] = face; }
      }
    }
  }
  const fallback = model.texture('#particle') ?? model.texture(Object.values(model.textures)[0]);
  return {fullCube: !!full, faces: Array.from({length:6}, (_, i) => ({texture: model.texture(chosen[i]?.texture) ?? fallback, tinted: chosen[i]?.tintindex !== undefined}))};
}

export function buildMaterials(zip) {
  const read = path => zip.read(path);
  const modelCache = new Map(), textureCache = new Map(), textures = ['<missing>'], layerPixels = [missingTile()], layerIndex = new Map();
  const blocks = {}; let unknown = 0, fallback = 0, entries = 0;
  function useTexture(name) {
    if (!name) { unknown++; return 0; }
    if (layerIndex.has(name)) return layerIndex.get(name);
    const [namespace, path] = name.split(':');
    const png = read(`assets/${namespace}/textures/${path}.png`);
    if (!png) { unknown++; return 0; }
    let pixels = textureCache.get(name);
    if (!pixels) {
      const decoded = decodePng(png); pixels = Buffer.alloc(16 * 16 * 4);
      const square = Math.min(decoded.width, decoded.height);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const sx = Math.floor(x * decoded.width / 16), sy = Math.floor(y * square / 16);
        decoded.pixels.copy(pixels, (y * 16 + x) * 4, (sy * decoded.width + sx) * 4, (sy * decoded.width + sx) * 4 + 4);
      }
      textureCache.set(name, pixels);
    }
    const index = textures.length; textures.push(name); layerPixels.push(pixels); layerIndex.set(name, index); return index;
  }
  function makeEntry(blockName, when, variant) {
    const block = blockName.split(':')[1];
    const model = variant?.model ? resolveModel(variant.model, read, modelCache) : undefined;
    const special = block === 'water' ? 'minecraft:block/water_still' : block === 'lava' ? 'minecraft:block/lava_still' : undefined;
    if (!model && !special) fallback++;
    const data = model && (!special || model.elements.length) ? faceData(model) : {fullCube:false, faces:Array.from({length:6}, () => ({texture:special, tinted:block === 'water'}))};
    const faces = Array(6).fill(0), faceTints = Array(6).fill(0);
    for (let i = 0; i < 6; i++) {
      const target = rotateFace(i, variant?.x ?? 0, variant?.y ?? 0);
      if (target < 0) throw new Error(`Invalid model rotation: ${blockName}`);
      faces[target] = useTexture(data.faces[i].texture);
      faceTints[target] = data.faces[i].tinted ? tintFor(block) : 0;
    }
    const transparent = faces.some(layer => { const pixels = layerPixels[layer]; for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 255) return true; return false; });
    entries++;
    return {when, faces, tints:faceTints, fullCube:data.fullCube, transparent};
  }
  const paths = [...zip.entries.keys()].filter(p => /^assets\/minecraft\/blockstates\/[^/]+\.json$/.test(p)).sort();
  for (const path of paths) {
    const name = `minecraft:${path.split('/').at(-1).slice(0,-5)}`, state = parse(read(path));
    if (state.variants) blocks[name] = Object.entries(state.variants).map(([key, variant]) => makeEntry(name, Object.fromEntries(key ? key.split(',').map(pair => pair.split('=')) : []), Array.isArray(variant) ? variant[0] : variant));
    else if (state.multipart) {
      const part = state.multipart.find(p => !p.when) ?? state.multipart[0];
      blocks[name] = [makeEntry(name, {}, Array.isArray(part.apply) ? part.apply[0] : part.apply)];
    }
  }
  return {format:1, source:'', tile:16, layers:textures.length, textures, tints, blocks, pixels:Buffer.concat(layerPixels), counts:{blocks:paths.length, entries, unknown, fallback}};
}

function missingTile() {
  const pixels = Buffer.alloc(16 * 16 * 4);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const i = (y * 16 + x) * 4, magenta = (x < 8) === (y < 8);
    pixels[i] = magenta ? 255 : 0; pixels[i+2] = magenta ? 255 : 0; pixels[i+3] = 255;
  }
  return pixels;
}
