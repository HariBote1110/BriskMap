import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { ZipReader } from './zip.mjs';
import { encodePng } from './png.mjs';
import { buildMaterials } from './models.mjs';

const args = process.argv.slice(2);
const jar = args[args.indexOf('--jar') + 1], out = args[args.indexOf('--out') + 1];
if (!jar || !out || !args.includes('--jar') || !args.includes('--out')) {
  console.error('Usage: node build.mjs --jar <path> --out <dir>'); process.exitCode = 2;
} else {
  const start = performance.now();
  const material = buildMaterials(new ZipReader(readFileSync(jar)));
  const {pixels, counts, ...document} = material;
  document.source = basename(jar);
  const atlas = encodePng(16, material.layers * 16, pixels);
  mkdirSync(out, {recursive:true});
  writeFileSync(join(out, 'atlas.png'), atlas);
  writeFileSync(join(out, 'blocks.json'), JSON.stringify(document, null, 2) + '\n');
  console.log(JSON.stringify({...counts, layers:material.layers, atlasBytes:atlas.length, ms:Math.round(performance.now() - start)}));
}
