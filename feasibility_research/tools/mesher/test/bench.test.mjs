import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { encodeRegion } from './encode.mjs';
import { meshChunk } from '../src/mesh-js.mjs';
import { syntheticMaterials } from '../src/materials.mjs';

test('benchmark hash follows chunk order and includes vertex and index bytes', async () => {
  const directory = await mkdtemp(join(import.meta.dirname, 'bench-'));
  try {
    const palette = ['minecraft:stone'];
    const blocks = [{ p: 0, palette: 0, mask: 63 }, { p: 256, palette: 0, mask: 8 }];
    await writeFile(join(directory, 'r.0.0.b3d'), encodeRegion({ palette, chunks: new Map([[0, blocks]]) }));
    const result = JSON.parse(execFileSync(process.execPath, ['bench/node-bench.mjs', '--data', directory, '--regions', '1', '--impl', 'js', '--mode', 'greedy', '--warmup', '0', '--passes', '1', '--hash'], { cwd: new URL('..', import.meta.url) }).toString());
    const mesh = meshChunk({ positions: Uint32Array.from(blocks.map(block => block.p)), paletteIndices: Uint32Array.of(0, 0), masks: Uint8Array.from(blocks.map(block => block.mask)), materials: syntheticMaterials(palette) }, 'greedy');
    const expected = createHash('sha256').update(mesh.vertices).update(new Uint8Array(mesh.indices.buffer)).digest('hex');
    assert.equal(result.sha256, expected);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
