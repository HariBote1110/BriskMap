import { selectChunks, loadRegionHeader, fetchSelectedRanges, defaultFetchRange } from './loader.mjs';
import { viewProjection } from './camera.mjs';
import { resolveMaterials } from '../mesher/src/materials.mjs';
import { colourFor } from '../mesher/src/colour.mjs';

const canvas=document.querySelector('canvas'),status=document.querySelector('#status');
const stats=window.__briskStats={chunks_selected:0,chunks_loaded:0,regions:0,requests:0,bytes_fetched:0,quads:0,vertex_bytes:0,index_bytes:0,texture_upload_bytes:0,t_textures_done_ms:null,t_blocks_json_done_ms:null,t_atlas_decoded_ms:null,texture_upload_ms:null,t_first_byte_ms:null,t_fetch_done_ms:null,t_mesh_done_ms:null,t_upload_done_ms:null};
window.__briskReady=false;window.__briskError=null;
const params=new URLSearchParams(location.search);
const numeric=(name,fallback)=>Number(params.get(name)??fallback);
const camera={x:numeric('x',0),y:numeric('y',64),z:numeric('z',0),distance:numeric('distance',120),rotation:numeric('rotation',0),angle:numeric('angle',0.9)};
const fail=error=>{window.__briskError=String(error?.stack??error);status.textContent=window.__briskError;console.error(error);};
window.__setCamera=changes=>{for(const key of Object.keys(camera))if(Object.hasOwn(changes,key)){const value=Number(changes[key]);if(!Number.isFinite(value)){fail(new Error(`Invalid ${key}`));return;}camera[key]=value;}};
const radius=numeric('radius',256),workerCount=numeric('workers',4),mode=params.get('mode')??'greedy',dataPrefix=params.get('data')??'/data/',texturePrefix=params.get('textures')??'/textures/',shading=params.get('shading')??'textured';
function shader(gl,type,source){const item=gl.createShader(type);gl.shaderSource(item,source);gl.compileShader(item);if(!gl.getShaderParameter(item,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(item));return item;}
function programme(gl){
  const vertex=`#version 300 es
  precision highp float;
  precision highp int;
  layout(location=0) in uvec3 position;
  layout(location=1) in uint normalIndex;
  layout(location=2) in uint ambientOcclusion;
  layout(location=3) in uint textureLayer;
  layout(location=4) in uint tintIndex;
  layout(location=5) in uint materialFlags;
  uniform mat4 viewProjectionMatrix;
  uniform vec3 chunkOffset;
  out vec2 vertexUv;
  out float vertexLight;
  flat out uint vertexLayer;
  flat out uint vertexTint;
  flat out uint vertexFlags;
  flat out uint vertexNormal;
  void main(){
    vec3 world=vec3(position)+chunkOffset;
    if(normalIndex==0u)vertexUv=vec2(world.z,-world.y);
    else if(normalIndex==1u)vertexUv=vec2(-world.z,-world.y);
    else if(normalIndex==2u)vertexUv=vec2(world.x,world.z);
    else if(normalIndex==3u)vertexUv=vec2(world.x,-world.z);
    else if(normalIndex==4u)vertexUv=vec2(-world.x,-world.y);
    else vertexUv=vec2(world.x,-world.y);
    const float faceLight[6]=float[6](0.6,0.6,0.5,1.0,0.8,0.8);
    const float aoLight[4]=float[4](0.5,0.7,0.85,1.0);
    vertexLight=faceLight[int(normalIndex)]*aoLight[int(ambientOcclusion)];
    vertexLayer=textureLayer;vertexTint=tintIndex;vertexFlags=materialFlags;vertexNormal=normalIndex;
    gl_Position=viewProjectionMatrix*vec4(world,1.0);
  }`;
  const fragment=`#version 300 es
  precision highp float;
  precision highp int;
  precision highp sampler2DArray;
  in vec2 vertexUv;
  in float vertexLight;
  flat in uint vertexLayer;
  flat in uint vertexTint;
  flat in uint vertexFlags;
  flat in uint vertexNormal;
  uniform sampler2DArray tileArray;
  uniform sampler2D flatColours;
  uniform bool flatShading;
  out vec4 outputColour;
  void main(){
    vec4 colour=flatShading?texelFetch(flatColours,ivec2(int(vertexLayer),0),0):texture(tileArray,vec3(vertexUv,float(vertexLayer)));
    if((vertexFlags&1u)!=0u&&colour.a<0.5)discard;
    const vec3 tints[5]=vec3[5](vec3(1.0),vec3(145.0,189.0,89.0)/255.0,vec3(119.0,171.0,47.0)/255.0,vec3(63.0,118.0,228.0)/255.0,vec3(1.0));
    const vec3 normals[6]=vec3[6](vec3(-1,0,0),vec3(1,0,0),vec3(0,-1,0),vec3(0,1,0),vec3(0,0,-1),vec3(0,0,1));
    float oldLight=0.55+0.45*max(dot(normals[int(vertexNormal)],normalize(vec3(0.3,1.0,0.5))),0.0);
    float light=flatShading?oldLight:vertexLight;
    outputColour=vec4(colour.rgb*(flatShading?vec3(1.0):tints[int(vertexTint)])*light,colour.a);
  }`;
  const program=gl.createProgram();gl.attachShader(program,shader(gl,gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl,gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));return program;
}
function uploadTextures(gl,table,bitmap){
  if(table.format!==1||table.tile!==16||!Number.isInteger(table.layers)||table.layers<1||table.textures?.length!==table.layers||bitmap.width!==16||bitmap.height!==16*table.layers||table.layers>gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS)||table.layers>gl.getParameter(gl.MAX_TEXTURE_SIZE))throw new Error('Invalid atlas dimensions');
  const texture=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D_ARRAY,texture);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY,5,gl.RGBA8,16,16,table.layers);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);
  if(new URLSearchParams(location.search).get('texupload')==='layers'){
    // Previous path: one 2D-canvas copy and upload per layer (kept for comparison).
    const canvas=new OffscreenCanvas(16,16),context=canvas.getContext('2d',{alpha:true});
    for(let layer=0;layer<table.layers;layer++){
      context.clearRect(0,0,16,16);
      context.drawImage(bitmap,0,layer*16,16,16,0,0,16,16);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY,0,0,0,layer,16,16,1,gl.RGBA,gl.UNSIGNED_BYTE,canvas);
    }
  }else{
    // WebGL2 slices a vertically stacked image source into `depth` layers of `height` rows each.
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY,0,0,0,0,16,16,table.layers,gl.RGBA,gl.UNSIGNED_BYTE,bitmap);
  }
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_MIN_FILTER,gl.NEAREST_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  const colours=new Uint8Array(table.layers*4);
  for(let layer=0;layer<table.layers;layer++){
    const hash=colourFor(table.textures[layer]);
    colours[layer*4]=hash&255;colours[layer*4+1]=hash>>>8&255;colours[layer*4+2]=hash>>>16&255;colours[layer*4+3]=255;
  }
  const lookup=gl.createTexture();gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,lookup);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,table.layers,1,0,gl.RGBA,gl.UNSIGNED_BYTE,colours);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  return 16*16*table.layers*4+colours.byteLength;
}

async function main(){
  if(![...Object.values(camera),radius,workerCount].every(Number.isFinite)||radius<0||!Number.isInteger(workerCount)||workerCount<1||!['greedy','culled'].includes(mode)||camera.distance<=0||!dataPrefix||!texturePrefix||!['textured','flat'].includes(shading))throw new Error('Invalid query parameters');
  const gl=canvas.getContext('webgl2');if(!gl)throw new Error('WebGL2 context unavailable');
  const program=programme(gl),matrixLocation=gl.getUniformLocation(program,'viewProjectionMatrix'),offsetLocation=gl.getUniformLocation(program,'chunkOffset');
  gl.useProgram(program);gl.uniform1i(gl.getUniformLocation(program,'tileArray'),0);gl.uniform1i(gl.getUniformLocation(program,'flatColours'),1);gl.uniform1i(gl.getUniformLocation(program,'flatShading'),shading==='flat'?1:0);
  const textureUrl=texturePrefix.endsWith('/')?texturePrefix:`${texturePrefix}/`;
  const texturePromise=Promise.all([fetch(`${textureUrl}blocks.json`).then(response=>{if(!response.ok)throw new Error(`blocks.json: HTTP ${response.status}`);return response.json().then(table=>{stats.t_blocks_json_done_ms=performance.now();return table;});}),fetch(`${textureUrl}atlas.png`).then(async response=>{if(!response.ok)throw new Error(`atlas.png: HTTP ${response.status}`);const bitmap=await createImageBitmap(await response.blob(),{premultiplyAlpha:'none',colorSpaceConversion:'none'});stats.t_atlas_decoded_ms=performance.now();return bitmap;})]).then(([table,bitmap])=>{try{const uploadStart=performance.now();stats.texture_upload_bytes=uploadTextures(gl,table,bitmap);stats.texture_upload_ms=performance.now()-uploadStart;stats.t_textures_done_ms=performance.now();return table;}finally{bitmap.close();}});
  gl.enable(gl.DEPTH_TEST);gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);gl.clearColor(125/255,171/255,1,1);
  const selected=selectChunks(camera.x,camera.z,radius);stats.chunks_selected=selected.length;
  const groups=new Map();for(const chunk of selected){const key=`${chunk.rx},${chunk.rz}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(chunk);}
  stats.regions=groups.size;
  const meshes=[];let uploaded=0,fetchDone=false,complete=false,texturesDone=false;
  texturePromise.then(()=>{texturesDone=true;},fail);
  function draw(){
    const width=Math.max(1,Math.round(canvas.clientWidth*devicePixelRatio)),height=Math.max(1,Math.round(canvas.clientHeight*devicePixelRatio));
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;gl.viewport(0,0,width,height);}
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(program);
    gl.uniformMatrix4fv(matrixLocation,false,new Float32Array(viewProjection(camera,width/height)));
    for(const item of meshes){gl.bindVertexArray(item.vao);gl.uniform3f(offsetLocation,item.cx*16,-64,item.cz*16);gl.drawElements(gl.TRIANGLES,item.count,gl.UNSIGNED_INT,0);}
    if(!complete&&fetchDone&&texturesDone&&uploaded===stats.chunks_selected){window.__briskReady=true;complete=true;status.textContent=JSON.stringify(stats,null,2);}
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
  const workers=Array.from({length:workerCount},()=>new Worker('./worker.mjs',{type:'module'}));
  let assigned=0,received=0;const pending=new Map();
  for(const worker of workers){
    worker.onerror=event=>fail(new Error(event.message??'Worker failed'));
    worker.onmessage=({data})=>{
      if(data.type==='error'){fail(new Error(data.message));return;}
      if(data.type!=='mesh')return;
      const task=pending.get(data.id);if(!task)return;pending.delete(data.id);
      received++;stats.quads+=data.quads;stats.vertex_bytes+=data.vertices.byteLength;stats.index_bytes+=data.indices.byteLength;
      if(received===stats.chunks_selected)stats.t_mesh_done_ms=performance.now();
      const vao=gl.createVertexArray(),vertices=gl.createBuffer(),indices=gl.createBuffer();
      gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,vertices);gl.bufferData(gl.ARRAY_BUFFER,data.vertices,gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indices);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,data.indices,gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);gl.vertexAttribIPointer(0,3,gl.UNSIGNED_SHORT,12,0);
      gl.enableVertexAttribArray(1);gl.vertexAttribIPointer(1,1,gl.UNSIGNED_BYTE,12,6);
      gl.enableVertexAttribArray(2);gl.vertexAttribIPointer(2,1,gl.UNSIGNED_BYTE,12,7);
      gl.enableVertexAttribArray(3);gl.vertexAttribIPointer(3,1,gl.UNSIGNED_SHORT,12,8);
      gl.enableVertexAttribArray(4);gl.vertexAttribIPointer(4,1,gl.UNSIGNED_BYTE,12,10);
      gl.enableVertexAttribArray(5);gl.vertexAttribIPointer(5,1,gl.UNSIGNED_BYTE,12,11);
      meshes.push({vao,cx:data.cx,cz:data.cz,count:data.indices.byteLength/4});
      stats.chunks_loaded=++uploaded;
      if(uploaded===stats.chunks_selected)stats.t_upload_done_ms=performance.now();
      status.textContent=`${uploaded}/${stats.chunks_selected} chunks`;
    };
  }
  const queue=[];let active=0;
  function limitedRange(url,start,end){return new Promise((resolve,reject)=>{queue.push({url,start,end,resolve,reject});pump();});}
  function pump(){while(active<6&&queue.length){const item=queue.shift();active++;defaultFetchRange(item.url,item.start,item.end).then(item.resolve,item.reject).finally(()=>{active--;pump();});}}
  const onFirstByte=()=>{stats.t_first_byte_ms??=performance.now();};
  const onResponse=byteLength=>{stats.requests++;stats.bytes_fetched+=byteLength;};
  const prefix=dataPrefix.endsWith('/')?dataPrefix:`${dataPrefix}/`;
  await Promise.all([...groups].map(async([key,chunks])=>{
    const [rx,rz]=key.split(',').map(Number),url=`${prefix}r.${rx}.${rz}.b3d`;
    const header=await loadRegionHeader(url,{fetchRange:limitedRange,onResponse,onFirstByte});
    if(header.x!==rx||header.z!==rz)throw new Error(`Region coordinate mismatch: ${key}`);
    const entries=chunks.map(chunk=>({...header.index[chunk.index],cx:chunk.cx,cz:chunk.cz}));
    const absent=entries.filter(entry=>!entry.length).length;
    if(absent)throw new Error(`${key}: ${absent} selected chunks absent`);
    const used=new Set();
    for(let i=0;i<entries.length;i++){const workerIndex=assigned++%workers.length;used.add(workerIndex);entries[i].workerIndex=workerIndex;}
    const materials=resolveMaterials(header.palette,await texturePromise);
    for(const workerIndex of used){
      const faceLayers=materials.faceLayers.slice(),faceTints=materials.faceTints.slice(),opaque=materials.opaque.slice(),alphaTest=materials.alphaTest.slice();
      workers[workerIndex].postMessage({type:'palette',region:key,faceLayers:faceLayers.buffer,faceTints:faceTints.buffer,opaque:opaque.buffer,alphaTest:alphaTest.buffer},[faceLayers.buffer,faceTints.buffer,opaque.buffer,alphaTest.buffer]);
    }
    await fetchSelectedRanges(url,entries,{fetchRange:limitedRange,onResponse,onFirstByte},(entry,compressed)=>{
      const id=`${key}:${entry.index}`;pending.set(id,true);
      workers[entry.workerIndex].postMessage({type:'mesh',id,region:key,cx:entry.cx,cz:entry.cz,compressed:compressed.buffer,mode},[compressed.buffer]);
    });
  }));
  stats.t_fetch_done_ms=performance.now();fetchDone=true;
  if(!selected.length){stats.t_mesh_done_ms=stats.t_fetch_done_ms;stats.t_upload_done_ms=stats.t_fetch_done_ms;}
}
try{await main();}catch(error){fail(error);}
