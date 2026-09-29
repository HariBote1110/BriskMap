import { decodeChunk } from './loader.mjs';
import { loadMesher } from '../mesher/src/wasm.mjs';

const palettes=new Map();
const inflate=async bytes=>new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
let mesherPromise;
self.onmessage=async({data})=>{
  try{
    if(data.type==='palette'){palettes.set(data.region,{ faceLayers: new Uint16Array(data.faceLayers), faceTints: new Uint8Array(data.faceTints), opaque: new Uint8Array(data.opaque), alphaTest: new Uint8Array(data.alphaTest) });return;}
    if(data.type==='mesh'){
      const mesher=await (mesherPromise??=loadMesher());
      const materials=palettes.get(data.region);
      if(!materials)throw new Error(`Missing palette for ${data.region}`);
      const raw=await inflate(data.compressed);
      const chunk=decodeChunk(raw,materials.opaque.length);
      const result=mesher.meshChunk({...chunk,materials},data.mode);
      self.postMessage({type:'mesh',id:data.id,cx:data.cx,cz:data.cz,quads:result.quads,vertices:result.vertices.buffer,indices:result.indices.buffer},[result.vertices.buffer,result.indices.buffer]);
    }
  }catch(error){self.postMessage({type:'error',message:String(error?.stack??error)});}
};
