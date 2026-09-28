import { decodeRegion } from '../src/format.mjs';
import { meshChunk as meshJs } from '../src/mesh-js.mjs';
import { loadMesher } from '../src/wasm.mjs';
let chunks = [], wasm, acknowledge;
const inflate = async data => new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'ack') { acknowledge?.(); acknowledge = undefined;
    } else if (data.type === 'decode') {
      const region = await decodeRegion(data.bytes, inflate);
      const transfer = [];
      const items = region.chunks.map(chunk => {
        transfer.push(chunk.positions.buffer, chunk.paletteIndices.buffer, chunk.masks.buffer);
        return { ...chunk, colours: region.colours };
      });
      self.postMessage({ type: 'decoded', id: data.id, chunks: items }, transfer);
    } else if (data.type === 'assign') {
      chunks = data.chunks;
      if (data.impl === 'wasm') wasm ??= await loadMesher();
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'mesh') {
      const mesher = data.impl === 'wasm' ? wasm.meshChunk : meshJs;
      let quads = 0, vertexBytes = 0;
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const result = mesher(chunk, data.mode);
        quads += result.quads; vertexBytes += result.vertices.byteLength;
        self.postMessage({ type: 'buffers', vertices: result.vertices.buffer, indices: result.indices.buffer }, [result.vertices.buffer, result.indices.buffer]);
        if ((i + 1) % 32 === 0) await new Promise(resolve => { acknowledge = resolve; });
      }
      self.postMessage({ type: 'finished', quads, vertexBytes, chunks: chunks.length });
    }
  } catch (error) { self.postMessage({ type: 'error', message: String(error?.stack ?? error) }); }
};

self.postMessage({ type: 'booted' });
