import { decode2d, decode3d } from './format.mjs';
import { rasteriseRegion } from './map2d.mjs';
import { loadMesher } from './wasm.mjs';

const palettes = new Map();
let mesherPromise;
async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

self.onmessage = async ({data}) => {
  if (data.type === 'clearPalettes') { palettes.clear(); return; }
  if (data.type === 'dropPalette') { palettes.delete(data.key); return; }
  if (data.type === 'palette') {
    palettes.set(data.key, {materials:data.materials,paletteLength:data.paletteLength});
    return;
  }
  try {
    if (data.type === 'mesh') {
      const palette=palettes.get(data.paletteKey);
      if (!palette) throw new Error(`Missing palette ${data.paletteKey}`);
      const mesher=await (mesherPromise??=loadMesher());
      const raw=await inflate(data.compressed);
      const chunk=decode3d(raw,{palette:{length:palette.paletteLength}});
      const output=mesher.meshChunk({...chunk,materials:palette.materials},'greedy');
      self.postMessage({id:data.id,type:'mesh',cx:data.cx,cz:data.cz,vertices:output.vertices,indices:output.indices,quads:output.quads},[output.vertices.buffer,output.indices.buffer]);
    } else if (data.type === 'raster') {
      const header={palette:{length:data.paletteLength},biomes:{length:data.biomeLength}};
      const chunks=[];
      for (const item of data.chunks) chunks.push({index:item.index,columns:decode2d(await inflate(item.compressed),header)});
      const northRow={heights:new Int16Array(512).fill(-32768),blocks:new Uint32Array(512),waters:new Uint8Array(512)};
      const southHeights=new Int16Array(512).fill(-32768);
      for(const {index,columns} of chunks){
        const chunkZ=index>>5,originX=(index&31)*16;
        if(chunkZ===0)for(let x=0;x<16;x++){
          const at=originX+x,column=columns[x];
          northRow.heights[at]=column.y;
          northRow.blocks[at]=column.block;
          northRow.waters[at]=column.water;
        }
        if(chunkZ===31)for(let x=0;x<16;x++)southHeights[originX+x]=columns[240+x].y;
      }
      const pixels=rasteriseRegion(chunks,header,null,null,data.colours);
      self.postMessage({id:data.id,type:'raster',pixels,northRow,southHeights},[pixels.buffer]);
    }
  } catch (error) {
    self.postMessage({id:data.id,type:'error',message:String(error?.stack??error)});
  }
};
