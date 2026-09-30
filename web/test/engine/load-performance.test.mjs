import test from 'node:test';
import assert from 'node:assert/strict';
import { prewarm, workerCountFor } from '../../src/engine/index.mjs';
import { WorkerPool } from '../../src/engine/worker-pool.mjs';
import { DrawScheduler } from '../../src/engine/draw-scheduler.mjs';
import { Renderer3D } from '../../src/engine/renderer3d.mjs';

test('the initial pool uses up to four logical processors, including all four on a four core host', () => {
  assert.equal(workerCountFor(4), 4);
  assert.equal(workerCountFor(1), 1);
  assert.equal(workerCountFor(16), 4);
  assert.equal(workerCountFor(undefined), 2);
});

test('prewarming is idempotent with a fake Worker', () => {
  const previous = globalThis.Worker;
  const workers = [];
  globalThis.Worker = class { constructor() { workers.push(this); } postMessage() {} terminate() {} };
  try {
    const first = prewarm(4), second = prewarm(4);
    assert.equal(first, second);
    assert.equal(workers.length, 4);
    first.dispose();
  } finally { globalThis.Worker = previous; }
});

test('a region palette is transferred only once to each worker using that region', async () => {
  const previous = globalThis.Worker, workers = [];
  globalThis.Worker = class {
    constructor() { this.messages = []; workers.push(this); }
    postMessage(message, transfer = []) { this.messages.push({message, transfer}); }
    terminate() {}
  };
  try {
    const pool = new WorkerPool(1);
    const materials = {faceLayers:new Uint16Array([1]), faceTints:new Uint8Array([2]), opaque:new Uint8Array([3]), alphaTest:new Uint8Array([4]), shape:new Uint8Array([5])};
    const palette = {key:'region', materials, paletteLength:1};
    for (let index = 0; index < 2; index++) {
      const compressed = new Uint8Array([index]);
      const result = pool.run('mesh', {paletteKey:palette.key, compressed}, {palette, transfer:[compressed.buffer]});
      const mesh = workers[0].messages.at(-1);
      assert.equal(mesh.message.type, 'mesh');
      assert.deepEqual(mesh.transfer, [compressed.buffer]);
      workers[0].onmessage({data:{id:mesh.message.id, type:'mesh'}});
      await result;
    }
    const palettes = workers[0].messages.filter(item => item.message.type === 'palette');
    assert.equal(palettes.length, 1);
    assert.equal(palettes[0].transfer.length, 5);
    assert.ok(palettes[0].transfer.every(buffer => buffer instanceof ArrayBuffer));
    pool.dispose();
  } finally { globalThis.Worker = previous; }
});

test('chunk arrivals coalesce to ten draws a second and input draws at once', () => {
  let now = 0, sequence = 0;
  const frames = [], timers = new Map();
  const clock = {
    now: () => now,
    frame: callback => { frames.push(callback); },
    timeout: (callback, delay) => { const id = ++sequence; timers.set(id,{callback,at:now+delay}); return id; },
    clear: id => timers.delete(id),
  };
  const drawn = [];
  const scheduler = new DrawScheduler(time => drawn.push(time), clock);
  const frame = () => frames.shift()?.(now);
  const advance = time => { now=time; for (const [id, timer] of [...timers]) if(timer.at <= now){timers.delete(id);timer.callback();} };
  scheduler.request(); frame();
  scheduler.request({loading:true}); scheduler.request({loading:true});
  assert.equal(frames.length, 0);
  advance(99); assert.equal(frames.length, 0);
  advance(100); assert.equal(frames.length, 1); frame();
  scheduler.request({loading:true});
  scheduler.request();
  assert.equal(frames.length, 1); frame();
  assert.deepEqual(drawn,[0,100,100]);
  scheduler.dispose();
});

test('zero-index meshes use no per-frame draw call', () => {
  let calls = 0;
  const gl = new Proxy({}, {get(_target,key){
    if(key==='drawElements')return () => { calls++; };
    if(key==='getShaderParameter'||key==='getProgramParameter')return () => true;
    if(typeof key==='string'&&/^[A-Z][A-Z0-9_]*$/.test(key))return 1;
    return () => ({});
  }});
  const renderer = new Renderer3D(gl);
  renderer.uploadMesh('empty',0,0,{vertices:new Uint8Array(),indices:new Uint32Array()});
  renderer.uploadMesh('present',1,0,{vertices:new Uint8Array(12),indices:new Uint32Array([0,0,0])});
  renderer.draw({x:0,y:64,z:0,yaw:0,pitch:45,distance:120},800,600);
  assert.equal(calls,1);
  renderer.dispose();
});

test('3D fixed GL state is restored on mode entry without repeating it on every orbit frame', () => {
  let enables = 0, programmes = 0;
  const gl = new Proxy({}, {get(_target,key){
    if(key==='enable')return () => { enables++; };
    if(key==='useProgram')return () => { programmes++; };
    if(key==='getShaderParameter'||key==='getProgramParameter')return () => true;
    if(typeof key==='string'&&/^[A-Z][A-Z0-9_]*$/.test(key))return 1;
    return () => ({});
  }});
  const renderer = new Renderer3D(gl), view={x:0,y:64,z:0,yaw:0,pitch:45,distance:120};
  renderer.draw(view,800,600);
  const first = [enables, programmes];
  renderer.draw({...view,yaw:10},800,600);
  assert.deepEqual([enables, programmes],first);
  renderer.invalidateState();
  renderer.draw(view,800,600);
  assert.ok(enables>first[0]);
  renderer.dispose();
});
