import { decodeChunk } from './loader.mjs';
import { loadMesher } from '../mesher/src/wasm.mjs';

const palettes=new Map();
const inflate=async bytes=>new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
let mesher;
self.onmessage=async({data})=>{
  try{
    if(data.type==='palette'){palettes.set(data.region,new Uint32Array(data.colours));return;}
    if(data.type==='mesh'){
      mesher??=await loadMesher();
      const colours=palettes.get(data.region);
      if(!colours)throw new Error(`Missing palette for ${data.region}`);
      const raw=await inflate(data.compressed);
      const chunk=decodeChunk(raw,colours.length);
      const result=mesher.meshChunk({...chunk,colours},data.mode);
      self.postMessage({type:'mesh',id:data.id,cx:data.cx,cz:data.cz,quads:result.quads,vertices:result.vertices.buffer,indices:result.indices.buffer},[result.vertices.buffer,result.indices.buffer]);
    }
  }catch(error){self.postMessage({type:'error',message:String(error?.stack??error)});}
};
