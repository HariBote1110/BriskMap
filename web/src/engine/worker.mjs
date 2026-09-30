import { decode2d, decode3d } from './format.mjs';
import { rasteriseRegion } from './map2d.mjs';
import { loadMesher } from './wasm.mjs';
import { meshChunk as meshJs } from './mesh-js.mjs';

const palettes = new Map();
const mesherPromise=loadMesher().catch(()=>null);
mesherPromise.then(()=>self.postMessage({type:'ready'}));
async function streamInflate(bytes) {
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
      const mesher=await mesherPromise;
      const inflateStart=performance.now();
      const raw=mesher ? mesher.inflateRaw(data.compressed) : await streamInflate(data.compressed);
      const inflateMs=performance.now()-inflateStart;
      const chunk=decode3d(raw,{palette:{length:palette.paletteLength}});
      const meshStart=performance.now();
      const output=mesher ? mesher.meshChunk({...chunk,materials:palette.materials},'greedy') : meshJs({...chunk,materials:palette.materials},'greedy');
      const meshMs=performance.now()-meshStart;
      self.postMessage({id:data.id,type:'mesh',cx:data.cx,cz:data.cz,vertices:output.vertices,indices:output.indices,quads:output.quads,inflateMs,meshMs},[output.vertices.buffer,output.indices.buffer]);
    } else if (data.type === 'raster') {
      const mesher=await mesherPromise;
      const header={palette:{length:data.paletteLength},biomes:{length:data.biomeLength}};
      const chunks=[];
      for (const item of data.chunks) {
        const raw=mesher ? mesher.inflateRaw(item.compressed) : await streamInflate(item.compressed);
        chunks.push({index:item.index,columns:decode2d(raw,header)});
      }
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
