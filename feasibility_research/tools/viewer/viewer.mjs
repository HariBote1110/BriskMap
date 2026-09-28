import { selectChunks, loadRegionHeader, fetchSelectedRanges, defaultFetchRange } from './loader.mjs';
import { viewProjection } from './camera.mjs';

const canvas=document.querySelector('canvas'),status=document.querySelector('#status');
const stats=window.__briskStats={chunks_selected:0,chunks_loaded:0,regions:0,requests:0,bytes_fetched:0,quads:0,vertex_bytes:0,index_bytes:0,t_first_byte_ms:null,t_fetch_done_ms:null,t_mesh_done_ms:null,t_upload_done_ms:null};
window.__briskReady=false;window.__briskError=null;
const params=new URLSearchParams(location.search);
const numeric=(name,fallback)=>Number(params.get(name)??fallback);
const camera={x:numeric('x',0),y:numeric('y',64),z:numeric('z',0),distance:numeric('distance',120),rotation:numeric('rotation',0),angle:numeric('angle',0.9)};
const fail=error=>{window.__briskError=String(error?.stack??error);status.textContent=window.__briskError;console.error(error);};
window.__setCamera=changes=>{for(const key of Object.keys(camera))if(Object.hasOwn(changes,key)){const value=Number(changes[key]);if(!Number.isFinite(value)){fail(new Error(`Invalid ${key}`));return;}camera[key]=value;}};
const radius=numeric('radius',256),workerCount=numeric('workers',4),mode=params.get('mode')??'greedy',dataPrefix=params.get('data')??'/data/';
function shader(gl,type,source){const item=gl.createShader(type);gl.shaderSource(item,source);gl.compileShader(item);if(!gl.getShaderParameter(item,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(item));return item;}
function programme(gl){
  const vertex=`#version 300 es
  precision highp float;
  layout(location=0) in uvec3 position;
  layout(location=1) in uint normalIndex;
  layout(location=2) in vec4 colour;
  uniform mat4 viewProjectionMatrix;
  uniform vec3 chunkOffset;
  out vec4 vertexColour;
  void main(){
    const vec3 normals[6]=vec3[6](vec3(-1,0,0),vec3(1,0,0),vec3(0,-1,0),vec3(0,1,0),vec3(0,0,-1),vec3(0,0,1));
    float light=0.55+0.45*max(dot(normals[int(normalIndex)],normalize(vec3(0.3,1.0,0.5))),0.0);
    vertexColour=vec4(colour.rgb*light,colour.a);
    gl_Position=viewProjectionMatrix*vec4(vec3(position)+chunkOffset,1.0);
  }`;
  const fragment=`#version 300 es
  precision highp float;
  in vec4 vertexColour;
  out vec4 outputColour;
  void main(){outputColour=vertexColour;}`;
  const program=gl.createProgram();gl.attachShader(program,shader(gl,gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl,gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));return program;
}

async function main(){
  if(![...Object.values(camera),radius,workerCount].every(Number.isFinite)||radius<0||!Number.isInteger(workerCount)||workerCount<1||!['greedy','culled'].includes(mode)||camera.distance<=0||!dataPrefix)throw new Error('Invalid query parameters');
  const gl=canvas.getContext('webgl2');if(!gl)throw new Error('WebGL2 context unavailable');
  const program=programme(gl),matrixLocation=gl.getUniformLocation(program,'viewProjectionMatrix'),offsetLocation=gl.getUniformLocation(program,'chunkOffset');
  gl.enable(gl.DEPTH_TEST);gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);gl.clearColor(125/255,171/255,1,1);
  const selected=selectChunks(camera.x,camera.z,radius);stats.chunks_selected=selected.length;
  const groups=new Map();for(const chunk of selected){const key=`${chunk.rx},${chunk.rz}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(chunk);}
  stats.regions=groups.size;
  const meshes=[];let uploaded=0,fetchDone=false,complete=false;
  function draw(){
    const width=Math.max(1,Math.round(canvas.clientWidth*devicePixelRatio)),height=Math.max(1,Math.round(canvas.clientHeight*devicePixelRatio));
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;gl.viewport(0,0,width,height);}
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(program);
    gl.uniformMatrix4fv(matrixLocation,false,new Float32Array(viewProjection(camera,width/height)));
    for(const item of meshes){gl.bindVertexArray(item.vao);gl.uniform3f(offsetLocation,item.cx*16,-64,item.cz*16);gl.drawElements(gl.TRIANGLES,item.count,gl.UNSIGNED_INT,0);}
    if(!complete&&fetchDone&&uploaded===stats.chunks_selected){window.__briskReady=true;complete=true;status.textContent=JSON.stringify(stats,null,2);}
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
      gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,4,gl.UNSIGNED_BYTE,true,12,8);
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
    for(const workerIndex of used)workers[workerIndex].postMessage({type:'palette',region:key,colours:header.colours.slice().buffer});
    await fetchSelectedRanges(url,entries,{fetchRange:limitedRange,onResponse,onFirstByte},(entry,compressed)=>{
      const id=`${key}:${entry.index}`;pending.set(id,true);
      workers[entry.workerIndex].postMessage({type:'mesh',id,region:key,cx:entry.cx,cz:entry.cz,compressed:compressed.buffer,mode},[compressed.buffer]);
    });
  }));
  stats.t_fetch_done_ms=performance.now();fetchDone=true;
  if(!selected.length){stats.t_mesh_done_ms=stats.t_fetch_done_ms;stats.t_upload_done_ms=stats.t_fetch_done_ms;}
}
try{await main();}catch(error){fail(error);}
