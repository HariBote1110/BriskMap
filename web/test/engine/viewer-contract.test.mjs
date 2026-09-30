import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewer, loadIndex, prewarm } from '../../src/engine/index.mjs';

const maps = [
  {id:'first',spawn:{x:12,y:70,z:34},regions:[]},
  {id:'second',spawn:{x:300,y:81,z:-200},regions:[]},
];

async function withViewer(run,{mode='3d',regions=[],fetcher=async()=>new Response('',{status:404}),onStatus,WorkerClass,prewarmBeforeViewer=false}={}) {
  const keys=['window','location','navigator','ResizeObserver','matchMedia','devicePixelRatio','requestAnimationFrame','Worker','fetch'];
  const previous=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const gl=new Proxy({}, {get(_target,key){if(key==='getShaderParameter'||key==='getProgramParameter')return()=>true;if(typeof key==='string'&&/^[A-Z][A-Z0-9_]*$/.test(key))return 1;return()=>({});}});
  const canvas={clientWidth:800,clientHeight:600,width:0,height:0,style:{},getContext:()=>gl,hasAttribute:()=>true,addEventListener(){},removeEventListener(){}};
  const replacements={
    window:{},
    location:{href:'http://localhost/',search:''},
    navigator:{hardwareConcurrency:2},
    ResizeObserver:class {observe(){} disconnect(){}},
    matchMedia:()=>({addEventListener(){},removeEventListener(){}}),
    devicePixelRatio:1,
    requestAnimationFrame:callback=>setImmediate(()=>callback(performance.now())),
    Worker:WorkerClass??class {postMessage(){} terminate(){}},
    fetch:fetcher,
  };
  for(const [key,value] of Object.entries(replacements))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  const errors=[];
  let viewer;
  try{
    const warm=prewarmBeforeViewer?prewarm():null;
    viewer=await createViewer(canvas,{index:{format:1,etag:'"old"',textures:null,maps:[{...maps[0],regions},maps[1]]},mapId:'first',mode,onStatus,onError:error=>errors.push(error)});
    if(warm)assert.equal(viewer.pool,warm);
    await run(viewer,errors);
  }finally{
    viewer?.dispose();
    for(const [key,descriptor] of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  }
}

async function until(predicate){
  for(let i=0;i<300;i++){
    if(predicate())return;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.fail('Timed out waiting for viewer state');
}

test('onError always supplies fatal and code for drawing and region failures',async()=>{
  await withViewer(async(viewer,errors)=>{
    viewer.renderer2d.draw=()=>{throw new Error('Draw failed');};
    viewer.draw(performance.now());
    assert.equal(viewer.status.phase,'error');
    assert.equal(errors.at(-1).fatal,true);
    assert.equal(typeof errors.at(-1).code,'string');
    assert.ok(errors.at(-1).code);
  },{mode:'2d'});
  await withViewer(async(_viewer,errors)=>{
    await until(()=>errors.length>0);
    assert.equal(errors[0].code,'region');
    assert.equal(errors[0].fatal,false);
  },{mode:'2d',regions:[[0,0]]});
});

test('empty indexed chunks finish 3D loading',async()=>{
  const data=Buffer.alloc(18+1+8192);
  data.write('BRSK');data[4]=4;data[5]=2;data.writeInt16BE(32767,16);
  await withViewer(async viewer=>{
    await until(()=>window.__briskReady);
    assert.equal(viewer.status.phase,'ready');
    assert.equal(viewer.status.chunksReady,viewer.status.chunksTotal);
    assert.ok(viewer.status.chunksTotal>0);
  },{regions:[[0,0]],fetcher:async()=>new Response(data)});
});

test('a missing indexed region finishes 3D loading',async()=>{
  await withViewer(async viewer=>{
    await until(()=>window.__briskReady);
    assert.equal(viewer.status.phase,'ready');
    assert.ok(viewer.status.chunksTotal>0);
    assert.equal(viewer.status.chunksReady,viewer.status.chunksTotal);
    assert.equal(viewer.status.regionsLoaded,viewer.status.regionsTotal);
  });
});

test('status and bench counters agree for present, empty and absent 3D data',async()=>{
  const data=Buffer.alloc(18+1+8192+1);
  data.write('BRSK');data[4]=4;data[5]=2;data.writeInt16BE(100,16);
  data.writeUInt32BE(18+1+8192,19);data.writeUInt32BE(1,23);
  data[data.length-1]=0;
  const events=[];
  let meshes=0;
  class MeshWorker {
    constructor(){setImmediate(()=>this.onmessage?.({data:{type:'ready'}}));}
    postMessage(message){
      if(message.type==='mesh'){
        meshes++;
        setImmediate(()=>this.onmessage({data:{id:message.id,quads:0,vertices:new Uint8Array(),indices:new Uint8Array()}}));
      }
    }
    terminate(){}
  }
  await withViewer(async viewer=>{
    await until(()=>window.__briskReady);
    await new Promise(resolve=>setTimeout(resolve,120));
    assert.ok(events.length>0);
    for(const {status,selected,loaded} of events.filter(event=>event.status.phase==='ready')){
      assert.equal(status.chunksTotal,selected);
      assert.equal(status.chunksReady,loaded);
      assert.equal(status.chunksReady,status.chunksTotal);
      assert.equal(status.regionsLoaded,status.regionsTotal);
    }
    assert.equal(viewer.status.regionsLoaded,viewer.status.regionsTotal);
    assert.ok(viewer.status.regionsTotal>1);
    assert.ok(window.__briskStats.requests>0);
    assert.equal(meshes,1);
    const stats=window.__briskStats;
    for(const field of ['t_index_done_ms','t_viewer_created_ms','t_workers_spawned_ms','t_first_worker_ready_ms','t_all_workers_ready_ms','t_first_chunk_meshed_ms','worker_mesh_ms_total','worker_inflate_ms_total','worker_idle_gaps','main_upload_ms_total','draws_during_load','draw_ms_during_load','workers'])assert.ok(Object.hasOwn(stats,field),field);
    assert.ok(stats.t_workers_spawned_ms<=stats.t_viewer_created_ms);
    assert.ok(stats.t_first_worker_ready_ms<=stats.t_all_workers_ready_ms);
    assert.ok(stats.t_all_workers_ready_ms<=stats.t_first_chunk_meshed_ms);
    assert.ok(stats.t_viewer_created_ms<=stats.t_first_chunk_meshed_ms);
    assert.ok(stats.t_first_chunk_meshed_ms<=stats.t_upload_done_ms);
    assert.ok(stats.main_upload_ms_total>=0);
    assert.ok(stats.draws_during_load>0);
    assert.ok(stats.workers>=1);
  },{regions:[[0,0]],WorkerClass:MeshWorker,fetcher:async()=>new Response(data),onStatus:status=>events.push({status,selected:window.__briskStats.chunks_selected,loaded:window.__briskStats.chunks_loaded})});
});

test('index completion precedes viewer construction in load statistics',async()=>{
  await loadIndex('./',{fetcher:async()=>new Response(JSON.stringify({format:1,maps:[]}))});
  await withViewer(async()=>{
    const stats=window.__briskStats;
    assert.ok(stats.t_index_done_ms<=stats.t_viewer_created_ms);
  });
});

test('createViewer reuses workers started before the index has loaded',async()=>{
  await withViewer(async viewer=>{
    assert.equal(viewer.pool.workers.length,2);
    assert.ok(window.__briskStats.t_workers_spawned_ms<=window.__briskStats.t_viewer_created_ms);
  },{prewarmBeforeViewer:true});
});

test('2D region progress advances when its header is fetched',async()=>{
  const data=Buffer.alloc(18+2+8192);
  data.write('BRSK');data[4]=4;data[5]=1;
  await withViewer(async viewer=>{
    await until(()=>viewer.status.regionsLoaded===viewer.status.regionsTotal);
    assert.ok(viewer.status.regionsTotal>0);
    assert.equal(viewer.status.phase,'loading');
  },{mode:'2d',regions:[[0,0]],fetcher:async()=>new Response(data)});
});

test('a failed 3D region is not reported as complete',async()=>{
  await withViewer(async(viewer,errors)=>{
    await until(()=>errors.length>0);
    await until(()=>viewer.status.phase==='ready');
    assert.equal(window.__briskReady,false);
    assert.ok(viewer.status.chunksReady<viewer.status.chunksTotal);
  },{regions:[[0,0]]});
});

test('setMap resets spawn and rejects an unknown map without changing the view',async()=>{
  await withViewer(async(viewer,errors)=>{
    viewer.setView({x:99,y:5,z:88,yaw:91,pitch:10,distance:8,zoom:4});
    await viewer.setMap('second');
    assert.deepEqual(viewer.getView(),{mode:'3d',mapId:'second',x:300,y:81,z:-200,yaw:0,pitch:45,distance:120,zoom:1});
    const before=viewer.getView();
    await assert.rejects(viewer.setMap('absent'),error=>error.code==='unknown-map'&&error.fatal===false);
    assert.deepEqual(viewer.getView(),before);
    assert.equal(errors.length,0);
  });
});

test('setMode and setMap replace benchmark stats and reset readiness for each load',async()=>{
  await withViewer(async viewer=>{
    await until(()=>window.__briskReady);
    const initial=window.__briskStats;
    initial.requests=7;
    const switchingMode=viewer.setMode('2d');
    const second=window.__briskStats;
    assert.notEqual(second,initial);
    assert.equal(second.t_viewer_created_ms,initial.t_viewer_created_ms);
    assert.equal(second.mode,'2d');
    assert.equal(second.requests,0);
    assert.equal(window.__briskReady,false);
    await switchingMode;
    await until(()=>window.__briskReady);
    second.bytes_fetched=50;
    const switchingMap=viewer.setMap('second');
    assert.notEqual(window.__briskStats,second);
    assert.equal(window.__briskStats.mode,'2d');
    assert.equal(window.__briskStats.bytes_fetched,0);
    assert.equal(window.__briskReady,false);
    await switchingMap;
    await until(()=>window.__briskReady);
    assert.equal(initial.mode,'3d');
  });
});

test('only fatal errors are written to the benchmark error hook',async()=>{
  await withViewer(async(viewer,errors)=>{
    await until(()=>errors.length>0);
    assert.equal(window.__briskError,null);
    viewer.renderer2d.draw=()=>{throw new Error('Draw failed');};
    viewer.draw(performance.now());
    assert.match(window.__briskError,/Draw failed/);
  },{mode:'2d',regions:[[0,0]]});
});

test('index polling failure reports a nonfatal error and retries with the last index',async()=>{
  let calls=0;
  await withViewer(async(viewer,errors)=>{
    await until(()=>window.__briskReady);
    await viewer.pollIndex();
    assert.equal(errors.at(-1).code,'index-poll');
    assert.equal(errors.at(-1).fatal,false);
    assert.equal(window.__briskError,null);
    assert.equal(viewer.status.phase,'ready');
    assert.equal(viewer.index.etag,'"old"');
    await viewer.pollIndex();
    assert.equal(calls,2);
    assert.equal(viewer.index.etag,'"new"');
  },{fetcher:async()=>{
    calls++;
    if(calls===1)throw new TypeError('offline');
    return new Response(JSON.stringify({format:1,textures:null,maps}),{headers:{ETag:'"new"'}});
  }});
});
