/**
 * BriskMap browser engine: public module.
 *
 * createViewer(canvas, options) -> Promise<viewer>
 *   options: { index, mapId, mode?: '3d'|'2d', view?, baseUrl?, onStatus?, onViewChange?, onError? }
 *   Rejects (and calls onError first) when the viewer cannot be built. Such errors carry
 *   fatal: true and code 'webgl2', 'unknown-map', 'invalid-view' or 'render' (any other set-up
 *   failure).
 *
 * Errors (onError)
 *   Every Error passed to onError carries `fatal` (boolean) and `code` (string).
 *   fatal is true exactly when the error moved status.phase to 'error'; the viewer then stops
 *   drawing and the caller should replace it. fatal false means the view keeps working.
 *   Codes: 'render' (fatal: drawing failed), 'region' (a region or its chunks failed after
 *   retries; that area stays empty), 'index-poll' (a background index poll failed; the last good
 *   index is kept and the next poll retries), 'texture' (the atlas failed; flat colours are used),
 *   'invalid-view' (a bad value from the benchmark camera hook). The original error, with its
 *   loader code ('network', 'http', 'format'), is kept as `cause` where one exists.
 *
 * setView(partial)   Merges into the current view. Throws code 'unknown-map' or 'invalid-view'.
 * setMode(mode)      Keeps the map and position; resolves after the first frame in the new mode.
 * setMap(mapId)      Keeps the current mode and resets the view to the new map's spawn
 *                    (x, y, z from spawn; yaw 0; pitch 45; distance 120; zoom 1). A caller that
 *                    wants another view calls setView afterwards. Rejects with code 'unknown-map'
 *                    (fatal false, not sent to onError) for an id not in the current index and
 *                    leaves the current map and view untouched. Resolves after the first frame.
 *
 * Benchmark hooks (window)
 *   __briskStats  A fresh object is installed for every load: at creation, and whenever the map
 *                 or mode changes (setMode, setMap, setView, or an index change). Its `mode` is
 *                 the mode being loaded; counters start at zero.
 *   __briskReady  Set to false synchronously when such a load starts (and while panning loads
 *                 more), and true once every selected chunk / visible region of that load is in.
 *   __briskError  Holds only fatal errors (the stack as a string); null otherwise.
 */
import { loadIndex as fetchIndex, loadRegion } from './loader.mjs';
import { selectChunks, visibleRegions } from './stream.mjs';
import { normaliseView } from './view.mjs';
import { resolveMaterials } from './materials.mjs';
import { meanLayers, regionColours, shadeNorthRow } from './map2d.mjs';
import { Renderer3D } from './renderer3d.mjs';
import { Renderer2D } from './renderer2d.mjs';
import { WorkerPool } from './worker-pool.mjs';
import { attachInput } from './input.mjs';

export const loadIndex = fetchIndex;

const regionKey = (rx,rz) => `${rx},${rz}`;
const chunkKey = (cx,cz) => `${cx},${cz}`;
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));

function codedError(code,cause,fatal=false){
  return Object.assign(new Error(String(cause?.message??cause),{cause}),{code,fatal});
}

function freshStats(mode){
  return {chunks_selected:0,chunks_loaded:0,regions:0,requests:0,bytes_fetched:0,quads:0,vertex_bytes:0,index_bytes:0,texture_upload_bytes:0,t_textures_done_ms:null,t_blocks_json_done_ms:null,t_atlas_decoded_ms:null,texture_upload_ms:null,t_first_byte_ms:null,t_fetch_done_ms:null,t_mesh_done_ms:null,t_upload_done_ms:null,mode};
}

function checkedView(spawn,mapId,mode,partial){
  if(!['3d','2d'].includes(mode))throw codedError('invalid-view',new Error('Unknown view mode'));
  try{return normaliseView(spawn,mapId,mode,partial);}
  catch(error){throw codedError('invalid-view',error);}
}

function textureUrl(baseUrl,path,name) {
  const base=new URL(baseUrl,globalThis.location?.href??'http://localhost/');
  return new URL(name,new URL(path.endsWith('/')?path:`${path}/`,base));
}

async function loadTextures(baseUrl,path,stats,signal) {
  if (!path) return null;
  const tableTask=fetch(textureUrl(baseUrl,path,'blocks.json'),{signal}).then(async response=>{
    if(!response.ok)throw new Error(`Texture HTTP ${response.status}`);
    const table=await response.json();
    stats.t_blocks_json_done_ms=performance.now();
    return table;
  });
  const bitmapTask=fetch(textureUrl(baseUrl,path,'atlas.png'),{signal}).then(async response=>{
    if(!response.ok)throw new Error(`Texture HTTP ${response.status}`);
    const bitmap=await createImageBitmap(await response.blob(),{premultiplyAlpha:'none',colorSpaceConversion:'none'});
    stats.t_atlas_decoded_ms=performance.now();
    return bitmap;
  });
  const [tableResult,bitmapResult]=await Promise.allSettled([tableTask,bitmapTask]);
  if(tableResult.status==='rejected'||bitmapResult.status==='rejected'){
    if(bitmapResult.status==='fulfilled')bitmapResult.value.close();
    throw tableResult.status==='rejected'?tableResult.reason:bitmapResult.reason;
  }
  const table=tableResult.value,bitmap=bitmapResult.value;
  try{
    if(table.format!==1||table.tile!==16||table.layers!==table.textures?.length||bitmap.width!==16||bitmap.height!==table.layers*16)throw new Error('Invalid texture atlas');
    const canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(16,4096):document.createElement('canvas');
    canvas.width=16;canvas.height=4096;
    const context=canvas.getContext('2d',{willReadFrequently:true});
    const pixels=new Uint8Array(table.layers*1024);
    for(let first=0;first<table.layers;first+=256){
      const count=Math.min(256,table.layers-first);
      context.clearRect(0,0,16,count*16);
      context.drawImage(bitmap,0,first*16,16,count*16,0,0,16,count*16);
      pixels.set(context.getImageData(0,0,16,count*16).data,first*1024);
    }
    const means=meanLayers(pixels,table.layers);
    return {table,bitmap,means};
  }catch(error){bitmap.close();throw error;}
}

class ViewerEngine {
  constructor(canvas,gl,options) {
    this.canvas=canvas;
    this.gl=gl;
    this.options=options;
    this.index=options.index;
    this.baseUrl=options.baseUrl??'./';
    this.map=this.index.maps?.find(item=>item.id===options.mapId);
    if(!this.map)throw codedError('unknown-map',new Error(`Unknown map: ${options.mapId}`));
    this.view=checkedView(this.map.spawn,this.map.id,options.mode??'3d',options.view);
    this.statusData={phase:'loading',mode:this.view.mode,textures:false,regionsLoaded:0,regionsTotal:0,chunksReady:0,chunksTotal:0,fps:0};
    this.renderer3d=new Renderer3D(gl);
    this.renderer2d=new Renderer2D(gl);
    const count=Math.max(1,Math.min(4,(navigator.hardwareConcurrency??2)-1));
    this.pool=new WorkerPool(count);
    this.epoch=0;
    this.abortController=new AbortController();
    this.disposed=false;
    this.loadedChunks=new Map();
    this.skippedChunks=new Set();
    this.pendingChunks=new Set();
    this.selectedChunks=[];
    this.selectedChunkKeys=new Set();
    this.visibleRegionKeys=[];
    this.pending2d=new Set();
    this.failed2d=new Set();
    this.edges2d=new Map();
    this.lastStatusAt=0;
    this.lastViewAt=0;
    this.frameQueued=false;
    this.firstFrameResolvers=[];
    this.fetchActive=0;
    this.fetchWaiters=[];
    this.stats=freshStats(this.view.mode);
    if(typeof window!=='undefined'){
      window.__briskStats=this.stats;
      window.__briskReady=false;
      window.__briskError=null;
      window.__frames=[];
      window.__setCamera=changes=>{
        const partial={};
        if(Object.hasOwn(changes,'rotation'))partial.yaw=Number(changes.rotation)*180/Math.PI;
        for(const key of ['x','y','z','distance'])if(Object.hasOwn(changes,key))partial[key]=Number(changes[key]);
        if(Object.hasOwn(changes,'angle'))partial.pitch=90-Number(changes.angle)*180/Math.PI;
        try{this.setView(partial);}catch(error){this.report(error,{code:'invalid-view'});}
      };
    }
    this.detachInput=attachInput(canvas,()=>this.getView(),view=>this.setView(view));
    this.resizeObserver=new ResizeObserver(()=>this.resize());
    this.resizeObserver.observe(canvas);
    this.armDpr();
    this.pollTimer=setInterval(()=>this.pollIndex(),30000);
    this.textureEpoch=0;
    this.beginTextures();
    this.notifyStatus(true);
    this.refresh();
    this.resize();
  }

  get status(){return {...this.statusData};}
  getView(){return {...this.view};}
  safeCall(callback,value){if(!callback)return;try{callback(value);}catch(error){console.error(error);}}
  notifyStatus(force=false){
    if(!this.options.onStatus)return;
    const now=performance.now(),delay=Math.max(0,100-(now-this.lastStatusAt));
    if(force||delay===0){clearTimeout(this.statusTimer);this.statusTimer=null;this.lastStatusAt=now;this.safeCall(this.options.onStatus,this.status);}
    else if(!this.statusTimer)this.statusTimer=setTimeout(()=>{this.statusTimer=null;this.notifyStatus(true);},delay);
  }
  emitView(){
    if(!this.options.onViewChange)return;
    const now=performance.now(),delay=Math.max(0,100-(now-this.lastViewAt));
    if(delay===0){clearTimeout(this.viewTimer);this.viewTimer=null;this.lastViewAt=now;this.safeCall(this.options.onViewChange,this.getView());}
    else if(!this.viewTimer)this.viewTimer=setTimeout(()=>{this.viewTimer=null;this.emitView();},delay);
  }
  notifyView(){
    this.emitView();
    clearTimeout(this.settleTimer);
    this.settleTimer=setTimeout(()=>{this.settleTimer=null;this.emitView();},200);
  }
  // Reports an error through onError with `code` and `fatal` set. Region and index-poll failures
  // are wrapped so the loader's own code survives as `cause.code`.
  report(error,{code,fatal=false}){
    if(this.disposed)return;
    const tagged=error instanceof Error&&error.code===code?Object.assign(error,{fatal}):codedError(code,error,fatal);
    this.statusData.message=tagged.message;
    if(fatal){
      this.statusData.phase='error';
      if(typeof window!=='undefined')window.__briskError=String(error?.stack??error);
    }
    this.safeCall(this.options.onError,tagged);
    this.notifyStatus();
  }
  beginTextures(){
    this.textureAbortController?.abort();
    this.textureAbortController=new AbortController();
    const epoch=++this.textureEpoch;
    this.textureSettled=false;
    this.loadTexturePromise=this.prepareTextures(epoch).finally(()=>{if(epoch===this.textureEpoch){this.textureSettled=true;this.drawSoon();}});
  }
  async prepareTextures(epoch){
    if(!this.index.textures){this.textureData=null;this.renderer3d.textured=false;this.stats.t_textures_done_ms=performance.now();return null;}
    try{
      const data=await loadTextures(this.baseUrl,this.index.textures,this.stats,this.textureAbortController.signal);
      if(this.disposed||epoch!==this.textureEpoch){data.bitmap.close();return null;}
      let uploaded;
      try{uploaded=this.renderer3d.useTextures(data.table,data.bitmap);}
      finally{data.bitmap.close();}
      this.stats.texture_upload_bytes=uploaded.bytes;
      this.stats.texture_upload_ms=uploaded.uploadMs;
      this.stats.t_textures_done_ms=performance.now();
      this.textureData={table:data.table,means:data.means};
      this.statusData.textures=true;
      this.notifyStatus();
      this.drawSoon();
      return this.textureData;
    }catch(error){
      if(epoch!==this.textureEpoch||this.disposed)return null;
      this.textureData=null;
      this.renderer3d.textured=false;
      this.stats.t_textures_done_ms=performance.now();
      this.statusData.textures=false;
      this.report(error,{code:'texture'});
      return null;
    }
  }
  armDpr(){
    this.dprQuery?.removeEventListener('change',this.dprChanged);
    this.dprChanged=()=>{this.armDpr();this.resize();};
    this.dprQuery=matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    this.dprQuery.addEventListener('change',this.dprChanged);
  }
  resize(){
    if(this.disposed)return;
    const width=Math.max(1,Math.round(this.canvas.clientWidth*devicePixelRatio));
    const height=Math.max(1,Math.round(this.canvas.clientHeight*devicePixelRatio));
    if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;this.gl.viewport(0,0,width,height);this.refresh();}
    this.drawSoon();
  }
  drawSoon(){if(this.disposed||this.frameQueued)return;this.frameQueued=true;requestAnimationFrame(time=>this.draw(time));}
  draw(time){
    this.frameQueued=false;
    if(this.disposed)return;
    const width=this.canvas.width||1,height=this.canvas.height||1;
    try{
      if(this.view.mode==='3d')this.renderer3d.draw(this.view,width,height);
      else this.renderer2d.draw(this.view,width,height,this.visibleRegionKeys);
    }catch(error){this.report(error,{code:'render',fatal:true});return;}
    if(typeof window!=='undefined'&&window.__recordFrames)window.__frames.push(time);
    const interval=this.lastFrameTime?time-this.lastFrameTime:0;
    if(interval>0&&interval<250){
      const previous=this.statusData.fps;
      this.statusData.fps=Math.round(previous?previous*.8+200/interval:1000/interval);
      if(this.statusData.fps!==previous)this.notifyStatus();
    }
    this.lastFrameTime=time;
    clearTimeout(this.idleTimer);
    this.idleTimer=setTimeout(()=>{if(!this.disposed){this.statusData.fps=0;this.notifyStatus();}},250);
    for(const resolve of this.firstFrameResolvers.splice(0))resolve();
    this.checkReady();
  }
  firstFrame(){return new Promise(resolve=>{this.firstFrameResolvers.push(resolve);this.drawSoon();});}
  setView(partial){
    if(this.disposed)return;
    const mapId=partial.mapId??this.view.mapId,mode=partial.mode??this.view.mode;
    const map=this.findMap(mapId);
    const old=this.view;
    this.view=checkedView(map.spawn,mapId,mode,{...old,...partial});
    if(mapId!==old.mapId||mode!==old.mode){this.map=map;this.resetSource();}
    else if(this.view.x!==old.x||this.view.z!==old.z||(mode==='2d'&&this.view.zoom!==old.zoom))this.refresh();
    this.notifyView();
    this.drawSoon();
  }
  async setMode(mode){if(this.disposed)return;this.setView({mode});await this.firstFrame();}
  async setMap(mapId){
    if(this.disposed)return;
    const map=this.findMap(mapId);
    this.setView(normaliseView(map.spawn,mapId,this.view.mode));
    await this.firstFrame();
  }
  findMap(mapId){
    const map=this.index.maps.find(item=>item.id===mapId);
    if(!map)throw codedError('unknown-map',new Error(`Unknown map: ${mapId}`));
    return map;
  }
  resetSource(){
    this.epoch++;
    this.abortController.abort();
    this.abortController=new AbortController();
    this.pool.cancelQueued(()=>true);
    this.pool.clearPalettes();
    this.renderer3d.clear();this.renderer2d.clear();
    this.loadedChunks=new Map();this.skippedChunks=new Set();this.pendingChunks=new Set();
    this.pending2d=new Set();this.failed2d=new Set();this.edges2d=new Map();
    this.statusData.mode=this.view.mode;
    this.statusData.phase='loading';
    this.statusData.message=undefined;
    this.stats=freshStats(this.view.mode);
    if(typeof window!=='undefined'){window.__briskStats=this.stats;window.__briskReady=false;}
    this.refresh();
  }
  async withFetchSlot(action){
    if(this.fetchActive>=6)await new Promise(resolve=>this.fetchWaiters.push(resolve));
    this.fetchActive++;
    try{return await action();}
    finally{this.fetchActive--;this.fetchWaiters.shift()?.();}
  }
  radius(){
    const query=new URLSearchParams(globalThis.location?.search??'').get('radius');
    const selected=query===null?NaN:Number(query);
    return Number.isFinite(selected)&&selected>=0?selected:this.canvas.clientWidth>=1024?256:160;
  }
  refresh(){
    if(this.disposed)return;
    this.statusData.phase='loading';
    if(typeof window!=='undefined')window.__briskReady=false;
    if(this.view.mode==='3d')this.refresh3d();else this.refresh2d();
    this.notifyStatus();
  }
  refresh3d(){
    const radius=this.radius(),selected=selectChunks(this.view.x,this.view.z,radius,this.map.regions);
    this.selectedChunks=selected;
    this.selectedChunkKeys=new Set(selected.map(item=>chunkKey(item.cx,item.cz)));
    this.pool.cancelQueued(task=>task.type==='mesh'&&!this.selectedChunkKeys.has(task.tag));
    this.stats.chunks_selected=selected.length;
    const groups=new Map();
    for(const chunk of selected){const key=regionKey(chunk.rx,chunk.rz);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(chunk);}
    this.groups3d=groups;
    this.stats.regions=groups.size;
    for(const [key,item] of this.loadedChunks){
      const dx=Math.max(item.cx*16-this.view.x,0,this.view.x-(item.cx+1)*16);
      const dz=Math.max(item.cz*16-this.view.z,0,this.view.z-(item.cz+1)*16);
      if(dx*dx+dz*dz>(radius*1.5)**2){this.renderer3d.remove(key);this.loadedChunks.delete(key);}
    }
    this.statusData.chunksTotal=selected.length;
    this.statusData.regionsTotal=groups.size;
    this.update3dProgress();
    const pending=this.pendingChunks,epoch=this.epoch;
    for(const [region,chunks] of groups){
      const needed=chunks.filter(item=>{const key=chunkKey(item.cx,item.cz);return !this.loadedChunks.has(key)&&!this.skippedChunks.has(key)&&!pending.has(key);});
      if(!needed.length)continue;
      for(const item of needed)pending.add(chunkKey(item.cx,item.cz));
      this.load3dGroup(region,needed,epoch,pending).catch(error=>this.report(error,{code:'region'}));
    }
    this.drawSoon();
  }
  update3dProgress(){
    let ready=0,regions=0;
    for(const chunks of this.groups3d?.values()??[]){let complete=true;for(const chunk of chunks){const key=chunkKey(chunk.cx,chunk.cz);if(this.loadedChunks.has(key))ready++;else if(!this.skippedChunks.has(key))complete=false;}if(complete)regions++;}
    this.statusData.chunksReady=ready;
    this.statusData.regionsLoaded=regions;
    this.stats.chunks_loaded=ready;
    this.notifyStatus();
  }
  async load3dGroup(region,chunks,epoch,pending){
    const [rx,rz]=region.split(',').map(Number),url=new URL(`maps/${encodeURIComponent(this.map.id)}/r.${rx}.${rz}.b3d`,new URL(this.baseUrl,location.href));
    const signal=this.abortController.signal;
    let loaded;
    try{
      loaded=await this.withFetchSlot(async()=>{
        if(epoch!==this.epoch||!chunks.some(item=>this.selectedChunkKeys.has(chunkKey(item.cx,item.cz))))return null;
        for(let attempt=0;attempt<3;attempt++){
          try{return await loadRegion(url,2,chunks.map(item=>item.index),{stats:this.stats,fetcher:(target,options)=>fetch(target,{...options,signal})});}
          catch(error){if(signal.aborted||attempt===2)throw error;await pause(200*2**attempt);}
        }
      });
      if(!loaded||epoch!==this.epoch)return;
      if(loaded.header.x!==rx||loaded.header.z!==rz)throw new Error(`Region coordinate mismatch: ${region}`);
      const texture=await this.loadTexturePromise;
      if(epoch!==this.epoch)return;
      const materials=texture?resolveMaterials(loaded.header.palette,texture.table):this.renderer3d.registerFlatPalette(loaded.header.palette);
      const palette={key:`${epoch}:${region}:${loaded.etag}`,materials,paletteLength:loaded.header.palette.length};
      const tasks=[];
      for(const chunk of chunks){
        const key=chunkKey(chunk.cx,chunk.cz),compressed=loaded.payloads.get(chunk.index);
        if(!this.selectedChunkKeys.has(key)){pending.delete(key);continue;}
        if(!compressed){this.skippedChunks.add(key);pending.delete(key);continue;}
        const promise=this.pool.run('mesh',{paletteKey:palette.key,cx:chunk.cx,cz:chunk.cz,compressed},{palette,transfer:[compressed.buffer],tag:key}).then(data=>{
          pending.delete(key);
          if(epoch!==this.epoch||!this.selectedChunkKeys.has(key))return;
          this.renderer3d.uploadMesh(key,chunk.cx,chunk.cz,data);
          this.loadedChunks.set(key,{cx:chunk.cx,cz:chunk.cz});
          this.stats.quads+=data.quads;
          this.stats.vertex_bytes+=data.vertices.byteLength;
          this.stats.index_bytes+=data.indices.byteLength;
          this.stats.t_mesh_done_ms=performance.now();
          this.stats.t_upload_done_ms=performance.now();
          this.update3dProgress();
          this.drawSoon();
        }).catch(error=>{pending.delete(key);if(error.code==='cancelled'){if(epoch===this.epoch&&this.selectedChunkKeys.has(key))this.refresh3d();return;}if(epoch===this.epoch&&this.selectedChunkKeys.has(key)){this.skippedChunks.add(key);this.report(error,{code:'region'});this.update3dProgress();this.drawSoon();}});
        tasks.push(promise);
      }
      this.stats.t_fetch_done_ms=performance.now();
      this.update3dProgress();
      await Promise.all(tasks);
    }catch(error){
      for(const chunk of chunks){const key=chunkKey(chunk.cx,chunk.cz);pending.delete(key);if(epoch===this.epoch)this.skippedChunks.add(key);}
      if(epoch===this.epoch){this.report(error,{code:'region'});this.update3dProgress();this.drawSoon();}
    }
  }
  refresh2d(){
    const regions=visibleRegions(this.map.regions,this.view.x,this.view.z,Math.max(1,this.canvas.clientWidth),Math.max(1,this.canvas.clientHeight),this.view.zoom).slice(0,64);
    this.visibleRegionKeys=regions.map(([rx,rz])=>regionKey(rx,rz));
    this.pool.cancelQueued(task=>task.type==='raster'&&!this.visibleRegionKeys.includes(task.tag));
    this.stats.regions=regions.length;
    this.statusData.regionsTotal=regions.length;
    this.statusData.chunksReady=0;this.statusData.chunksTotal=0;
    this.update2dProgress();
    const epoch=this.epoch,pending=this.pending2d;
    for(const [rx,rz] of regions){const key=regionKey(rx,rz);if(this.renderer2d.regions.has(key)||pending.has(key)||this.failed2d.has(key))continue;pending.add(key);this.load2dRegion(rx,rz,epoch,pending).catch(error=>this.report(error,{code:'region'}));}
    this.trim2d();
    this.drawSoon();
  }
  update2dProgress(){
    this.statusData.regionsLoaded=this.visibleRegionKeys.filter(key=>this.renderer2d.regions.has(key)).length;
    this.notifyStatus();
  }
  trim2d(){
    this.renderer2d.trim(new Set(this.visibleRegionKeys));
    for(const key of this.edges2d.keys())if(!this.renderer2d.regions.has(key))this.edges2d.delete(key);
  }
  patchNorth(key){
    const edge=this.edges2d.get(key);
    if(!edge)return;
    const north=this.edges2d.get(regionKey(edge.rx,edge.rz-1));
    if(!north)return;
    this.renderer2d.updateNorthRow(key,shadeNorthRow(edge.northRow,north.southHeights,edge.colours));
  }
  async load2dRegion(rx,rz,epoch,pending){
    const key=regionKey(rx,rz),url=new URL(`maps/${encodeURIComponent(this.map.id)}/r.${rx}.${rz}.b2d`,new URL(this.baseUrl,location.href));
    const signal=this.abortController.signal;
    try{
      const loaded=await this.withFetchSlot(async()=>{
        if(epoch!==this.epoch)return null;
        for(let attempt=0;attempt<3;attempt++){
          try{return await loadRegion(url,1,Array.from({length:1024},(_,index)=>index),{stats:this.stats,fetcher:(target,options)=>fetch(target,{...options,signal})});}
          catch(error){if(signal.aborted||attempt===2)throw error;await pause(200*2**attempt);}
        }
      });
      if(!loaded||epoch!==this.epoch)return;
      if(loaded.header.x!==rx||loaded.header.z!==rz)throw new Error(`Region coordinate mismatch: ${key}`);
      this.stats.t_fetch_done_ms=performance.now();
      const texture=await this.loadTexturePromise;
      if(epoch!==this.epoch)return;
      if(!this.visibleRegionKeys.includes(key))return;
      const colours=regionColours(loaded.header.palette,texture?.table,texture?.means);
      const chunks=[...loaded.payloads].map(([index,compressed])=>({index,compressed}));
      const transfer=chunks.map(item=>item.compressed.buffer);
      const result=await this.pool.run('raster',{chunks,paletteLength:loaded.header.palette.length,biomeLength:loaded.header.biomes.length,colours},{transfer,tag:key});
      if(epoch!==this.epoch||!this.visibleRegionKeys.includes(key))return;
      this.renderer2d.uploadRegion(key,rx,rz,result.pixels);
      this.edges2d.set(key,{rx,rz,northRow:result.northRow,southHeights:result.southHeights,colours});
      this.patchNorth(key);
      this.patchNorth(regionKey(rx,rz+1));
      this.stats.t_upload_done_ms=performance.now();
      this.trim2d();
      this.update2dProgress();
      this.drawSoon();
    }catch(error){if(error.code==='cancelled'){if(epoch===this.epoch&&this.visibleRegionKeys.includes(key))queueMicrotask(()=>this.refresh2d());}else if(epoch===this.epoch&&this.visibleRegionKeys.includes(key)){this.failed2d.add(key);this.report(error,{code:'region'});this.update2dProgress();this.drawSoon();}}
    finally{pending.delete(key);}
  }
  checkReady(){
    if(this.disposed||this.statusData.phase==='error'||!this.textureSettled)return;
    const processed=this.view.mode==='3d'
      ?this.selectedChunks.every(item=>{const key=chunkKey(item.cx,item.cz);return this.loadedChunks.has(key)||this.skippedChunks.has(key);})
      :this.visibleRegionKeys.every(key=>this.renderer2d.regions.has(key)||this.failed2d.has(key));
    if(!processed)return;
    const complete=this.view.mode==='3d'
      ?this.selectedChunks.every(item=>this.loadedChunks.has(chunkKey(item.cx,item.cz)))
      :this.visibleRegionKeys.every(key=>this.renderer2d.regions.has(key));
    const changed=this.statusData.phase!=='ready'||(typeof window!=='undefined'&&window.__briskReady!==complete);
    this.statusData.phase='ready';
    if(typeof window!=='undefined')window.__briskReady=complete;
    if(changed)this.notifyStatus();
  }
  async pollIndex(){
    if(this.disposed||this.polling)return;
    this.polling=true;
    try{
      const next=await fetchIndex(this.baseUrl,{etag:this.index.etag});
      if(next.notModified||this.disposed)return;
      const map=next.maps.find(item=>item.id===this.view.mapId);
      if(!map)throw new Error(`Map disappeared: ${this.view.mapId}`);
      const changed=map.updated!==this.map.updated||JSON.stringify(map.regions)!==JSON.stringify(this.map.regions);
      const textureChanged=next.textures!==this.index.textures;
      this.index=next;this.map=map;
      if(textureChanged){this.statusData.textures=false;this.renderer3d.textured=false;this.beginTextures();}
      if(changed||textureChanged)this.resetSource();
    }catch(error){this.report(error,{code:'index-poll'});}
    finally{this.polling=false;}
  }
  dispose(){
    if(this.disposed)return;
    this.disposed=true;
    this.epoch++;
    this.textureEpoch++;
    this.abortController.abort();
    this.textureAbortController?.abort();
    clearInterval(this.pollTimer);
    clearTimeout(this.statusTimer);clearTimeout(this.viewTimer);clearTimeout(this.settleTimer);clearTimeout(this.idleTimer);
    this.resizeObserver.disconnect();
    this.dprQuery?.removeEventListener('change',this.dprChanged);
    this.detachInput();
    this.pool.dispose();
    this.renderer3d.dispose();this.renderer2d.dispose();
    for(const resolve of this.firstFrameResolvers.splice(0))resolve();
    if(typeof window!=='undefined'){delete window.__setCamera;window.__briskReady=false;}
  }
}

export async function createViewer(canvas,options){
  const gl=canvas.getContext('webgl2',{alpha:false,antialias:true});
  if(!gl)throw Object.assign(new Error('WebGL2 is unavailable'),{code:'webgl2',fatal:true});
  try{return new ViewerEngine(canvas,gl,options);}
  catch(error){
    const tagged=Object.assign(error?.code?error:codedError('render',error),{fatal:true});
    options.onError?.(tagged);
    throw tagged;
  }
}
