import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { decodeRegion } from '../../src/engine/format.mjs';
import { meshChunk as meshJs } from '../../src/engine/mesh-js.mjs';
import { loadMesher } from '../../src/engine/wasm.mjs';
import { resolveMaterials, syntheticMaterials } from '../../src/engine/materials.mjs';

function options(args) {
  const value = name => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
  const result = { blocks: value('--blocks'), data: value('--data'), regions: Number(value('--regions') ?? Infinity), impl: value('--impl') ?? 'js', mode: value('--mode') ?? 'culled', warmup: Number(value('--warmup') ?? 2), passes: Number(value('--passes') ?? 5), hash: args.includes('--hash') };
  if (!result.data || !['js', 'wasm'].includes(result.impl) || !['culled', 'greedy'].includes(result.mode) || result.regions < 1 || !Number.isInteger(result.warmup) || result.warmup < 0 || !Number.isInteger(result.passes) || result.passes < 1) throw new Error('Use --data DIR [--regions N] [--blocks FILE] [--impl js|wasm] [--mode culled|greedy] [--warmup 2] [--passes 5]');
  return result;
}
const median = values => { const ordered = [...values].sort((a, b) => a - b); return ordered[Math.floor(ordered.length / 2)]; };
const percentile = (values, proportion) => { if (!values.length) return 0; const ordered = [...values].sort((a, b) => a - b); return ordered[Math.ceil(proportion * ordered.length) - 1]; };
const popcount = mask => { let count = 0; while (mask) { count += mask & 1; mask >>>= 1; } return count; };

async function main() {
  const config = options(process.argv.slice(2));
  const files = (await readdir(config.data)).filter(name => name.endsWith('.b3d')).sort().slice(0, config.regions);
  if (!files.length) throw new Error('No .b3d region files found');
  const materialTable = config.blocks ? JSON.parse(await readFile(config.blocks, 'utf8')) : null;
  const all = []; let shellBlocks = 0, facesIn = 0;
  const decodeStart = performance.now();
  for (const file of files) {
    const region = await decodeRegion(await readFile(join(config.data, file)), inflateRawSync);
    const materials = materialTable ? resolveMaterials(region.palette, materialTable) : syntheticMaterials(region.palette);
    for (const chunk of region.chunks) {
      const input = { ...chunk, materials }; all.push(input);
      shellBlocks += chunk.positions.length;
      for (const mask of chunk.masks) facesIn += popcount(mask);
    }
  }
  const decodeMs = performance.now() - decodeStart;
  const mesh = config.impl === 'wasm' ? (await loadMesher()).meshChunk : meshJs;
  const measured = [];
  let sha256;
  for (let pass = 0; pass < config.warmup + config.passes; pass++) {
    let quads = 0, vertices = 0, indices = 0, vertexBytes = 0, indexBytes = 0;
    const hasher = config.hash && pass === config.warmup + config.passes - 1 ? createHash('sha256') : null;
    let hashMs = 0;
    const times = [], start = performance.now();
    for (const chunk of all) {
      const before = performance.now();
      const output = mesh(chunk, config.mode);
      times.push((performance.now() - before) * 1000);
      quads += output.quads; vertices += output.vertices.byteLength / 12;
      indices += output.indices.length; vertexBytes += output.vertices.byteLength; indexBytes += output.indices.byteLength;
      if (hasher) {
        const hashStart = performance.now();
        hasher.update(output.vertices);
        hasher.update(new Uint8Array(output.indices.buffer, output.indices.byteOffset, output.indices.byteLength));
        hashMs += performance.now() - hashStart;
      }
    }
    const elapsed = performance.now() - start - hashMs;
    if (hasher) sha256 = hasher.digest('hex');
    if (pass >= config.warmup) measured.push({ elapsed, times, quads, vertices, indices, vertexBytes, indexBytes });
  }
  const sorted = [...measured].sort((a, b) => a.elapsed - b.elapsed), picked = sorted[Math.floor(sorted.length / 2)];
  console.log(JSON.stringify({ impl: config.impl, mode: config.mode, regions: files.length, chunks: all.length, shell_blocks: shellBlocks, faces_in: facesIn, quads_out: picked.quads, vertices: picked.vertices, indices: picked.indices, vertex_bytes: picked.vertexBytes, index_bytes: picked.indexBytes, decode_ms: decodeMs, mesh_ms_median: picked.elapsed, mesh_ms_min: sorted[0].elapsed, mesh_ms_max: sorted.at(-1).elapsed, per_chunk_us_p50: percentile(picked.times, 0.5), per_chunk_us_p95: percentile(picked.times, 0.95), node: process.version, ...(config.hash ? { sha256 } : {}) }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
