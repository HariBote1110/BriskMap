import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { cameraPosition, viewProjection, projectPoint } from '../camera.mjs';
import { selectChunks, coalesceRanges, loadRegionHeader, loadSelectedChunks } from '../loader.mjs';
import { decodeRegion } from '../../mesher/src/format.mjs';

const toolsRoot = fileURLToPath(new URL('../../', import.meta.url));
const dataRoot = fileURLToPath(new URL('../../../output/real/hide-surface/', import.meta.url));
const inflate = async bytes => inflateRawSync(bytes);

test('camera position and centre projection', () => {
  const target = { x: 0, y: 50.92, z: 0 };
  const p = cameraPosition({ ...target, distance: 120, rotation: 0.6, angle: 0.9 });
  for (const [actual, expected] of [[p.x, -53.07], [p.y, 125.52], [p.z, 77.57]]) assert.ok(Math.abs(actual - expected) < 0.02);
  let seed = 123456789;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);
  for (let i = 0; i < 100; i++) {
    const c = { x: random() * 2000 - 1000, y: random() * 384 - 64, z: random() * 2000 - 1000, distance: random() * 900 + 1, rotation: random() * Math.PI * 2, angle: random() * 1.4 + 0.05 };
    const eye = cameraPosition(c);
    assert.ok(Math.abs(Math.hypot(eye.x-c.x, eye.y-c.y, eye.z-c.z)-c.distance) < 1e-9);
    const ndc = projectPoint(viewProjection(c, 1600 / 900), [c.x, c.y, c.z]);
    assert.ok(Math.abs(ndc[0]) < 1e-9 && Math.abs(ndc[1]) < 1e-9);
  }
});

test('selection agrees with nearest-point reference', () => {
  for (const [x,z,radius] of [[0,0,0],[1.3,-7.7,15],[2.25,-12.5,64],[37.1,9.2,256]]) {
    const selected = new Set(selectChunks(x,z,radius).map(({cx,cz}) => `${cx},${cz}`));
    const reach = Math.ceil(radius/16)+2;
    const expected = new Set();
    for (let cz=Math.floor(z/16)-reach;cz<=Math.floor(z/16)+reach;cz++) for (let cx=Math.floor(x/16)-reach;cx<=Math.floor(x/16)+reach;cx++) {
      const dx = Math.max(cx*16-x, 0, x-(cx+1)*16);
      const dz = Math.max(cz*16-z, 0, z-(cz+1)*16);
      if (dx*dx+dz*dz<=radius*radius) expected.add(`${cx},${cz}`);
    }
    assert.deepEqual(selected, expected);
  }
});

test('coalescing agrees with a simple reference', () => {
  const entries = [{index:1,start:200,length:20},{index:2,start:100,length:20},{index:3,start:4250,length:10},{index:4,start:9000,length:5},{index:5,start:9100,length:10}];
  const sorted = [...entries].sort((a,b)=>a.start-b.start);
  const expected = [];
  for (const entry of sorted) {
    const last = expected.at(-1);
    if (last && entry.start-(last.end+1)<=4096) {last.end=Math.max(last.end,entry.start+entry.length-1);last.entries.push(entry);}
    else expected.push({start:entry.start,end:entry.start+entry.length-1,entries:[entry]});
  }
  assert.deepEqual(coalesceRanges(entries), expected);
});

test('server ranges and loader match whole-file decoder', async t => {
  const socket = createServer(); await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
  const port=socket.address().port; socket.close(); await once(socket,'close');
  const server=spawn(process.execPath,[new URL('../serve.mjs',import.meta.url).pathname,'--root',toolsRoot,'--data',dataRoot,'--port',String(port),'--host','127.0.0.1'],{stdio:'pipe'});
  t.after(()=>server.kill());
  const base=`http://127.0.0.1:${port}`;
  let ready=false;
  for (let i=0;i<100;i++) {try {const r=await fetch(`${base}/viewer/index.html`);if(r.ok){ready=true;break;}}catch{} await new Promise(resolve=>setTimeout(resolve,20));}
  assert.ok(ready,'server started');
  const path='/data/r.0.0.b3d';
  const range=await fetch(base+path,{headers:{Range:'bytes=0-13'}});
  assert.equal(range.status,206); assert.match(range.headers.get('content-range'),/^bytes 0-13\//); assert.equal((await range.arrayBuffer()).byteLength,14);
  const invalid=await fetch(base+path,{headers:{Range:'bytes=999999999-'}});assert.equal(invalid.status,416);
  const suffix=await fetch(base+path,{headers:{Range:'bytes=-7'}});assert.equal(suffix.status,206);assert.equal((await suffix.arrayBuffer()).byteLength,7);
  for (const path of ['/data/%2e%2e%2fviewer/index.html','/viewer/%2e%2e%2f%2e%2e%2foutput/real/hide-surface/r.0.0.b3d']) {
    const status=await new Promise((resolve,reject)=>{const req=request(base+path,response=>{response.resume();resolve(response.statusCode);});req.on('error',reject);req.end();});
    assert.equal(status,404);
  }
  const fetchRange=(url,start,end)=>fetch(url,{headers:{Range:`bytes=${start}-${end}`}});
  const header=await loadRegionHeader(base+path,{fetchRange});
  const entries=header.index.filter(entry=>entry.length).slice(0,3);
  assert.equal(entries.length,3);
  const chunks=await loadSelectedChunks(base+path,header,entries,{fetchRange,inflate});
  const complete=await decodeRegion(await readFile(`${dataRoot}/r.0.0.b3d`),inflate);
  for (const chunk of chunks) {
    const reference=complete.chunks.find(item=>item.index===chunk.index);
    assert.ok(reference);
    for (const field of ['positions','paletteIndices','masks']) assert.deepEqual(chunk[field],reference[field]);
  }
});
