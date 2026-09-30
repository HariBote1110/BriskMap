const defaultUrl = new URL('./mesher.wasm', import.meta.url);
export async function loadMesher(url = defaultUrl) {
  let bytes;
  if (url.protocol === 'file:') {
    const { readFile } = await import('node:fs/promises');
    try { bytes = await readFile(url); }
    catch (error) { if (error.code === 'ENOENT') throw new Error('Missing mesher.wasm; run sh build.sh first'); throw error; }
  } else bytes = await (await fetch(url)).arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes);
  const wasm = instance.exports;
  function meshChunk({ positions, paletteIndices, masks, materials }, mode = 'culled') {
    if (mode !== 'culled' && mode !== 'greedy') throw new Error(`Unknown mode: ${mode}`);
    if (positions.length !== paletteIndices.length || positions.length !== masks.length) throw new Error('Mismatched input lengths');
    const { faceLayers, faceTints, opaque, alphaTest, shape } = materials;
    if (faceLayers.length !== opaque.length * 6 || faceTints.length !== opaque.length * 6 || alphaTest.length !== opaque.length || shape.length !== opaque.length) throw new Error('Mismatched material lengths');
    const inputs = [positions, paletteIndices, masks, faceLayers, faceTints, opaque, alphaTest, shape];
    const pointers = [];
    try {
      for (const data of inputs) {
        const pointer = wasm.alloc(data.byteLength);
        if (!pointer) throw new Error('WASM allocation failed');
        pointers.push(pointer);
        new Uint8Array(wasm.memory.buffer, pointer, data.byteLength).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      }
      const result = wasm.mesh_chunk(pointers[0], pointers[1], pointers[2], positions.length, pointers[3], pointers[4], pointers[5], pointers[6], pointers[7], opaque.length, mode === 'greedy' ? 1 : 0);
      if (!result) throw new Error('WASM meshing failed');
      const view = new DataView(wasm.memory.buffer, result, 24);
      const vertexPointer = view.getUint32(0, true), vertexLength = view.getUint32(4, true);
      const indexPointer = view.getUint32(8, true), indexLength = view.getUint32(12, true);
      const quads = view.getUint32(16, true), error = view.getUint32(20, true);
      if (error) { wasm.dealloc(result, 24); throw new Error(`WASM meshing error ${error}`); }
      const vertices = new Uint8Array(wasm.memory.buffer, vertexPointer, vertexLength).slice();
      const indexBytes = new Uint8Array(wasm.memory.buffer, indexPointer, indexLength * 4).slice();
      const indices = new Uint32Array(indexLength);
      indices.set(new Uint32Array(indexBytes.buffer));
      wasm.dealloc(vertexPointer, vertexLength); wasm.dealloc(indexPointer, indexLength * 4); wasm.dealloc(result, 24);
      return { vertices, indices, quads };
    } finally { for (let i = 0; i < pointers.length; i++) wasm.dealloc(pointers[i], inputs[i].byteLength); }
  }
  return { meshChunk };
}
