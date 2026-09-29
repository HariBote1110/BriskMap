import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm, utimes } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { inflateRawSync, deflateSync, gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
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
  const textureRoot=await mkdtemp(new URL('./textures-fixture-',import.meta.url).pathname);
  t.after(()=>rm(textureRoot,{recursive:true,force:true}));
  function pngChunk(type,data){
    const name=Buffer.from(type), length=Buffer.alloc(4), crc=Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    let value=0xffffffff;
    for(const byte of Buffer.concat([name,data])){value^=byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);}
    crc.writeUInt32BE((value^0xffffffff)>>>0);
    return Buffer.concat([length,name,data,crc]);
  }
  const pixels=Buffer.alloc(32*(1+16*4));
  for(let y=0;y<32;y++)for(let x=0;x<16;x++){
    const at=y*(1+16*4)+1+x*4,magenta=y<16&&((x>>3)^(y>>3))===0;
    pixels[at]=y>=16?100:magenta?255:0;pixels[at+1]=y>=16?150:0;pixels[at+2]=y>=16?200:magenta?255:0;pixels[at+3]=255;
  }
  const pngHeader=Buffer.alloc(13);pngHeader.writeUInt32BE(16,0);pngHeader.writeUInt32BE(32,4);pngHeader[8]=8;pngHeader[9]=6;
  const atlas=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',pngHeader),pngChunk('IDAT',deflateSync(pixels)),pngChunk('IEND',Buffer.alloc(0))]);
  await writeFile(join(textureRoot,'atlas.png'),atlas);
  await writeFile(join(textureRoot,'blocks.json'),JSON.stringify({format:1,source:'synthetic.jar',tile:16,layers:2,textures:['<missing>','minecraft:block/stone'],tints:['none','grass','foliage','water','other'],blocks:{'minecraft:stone':[{when:{},faces:[1,1,1,1,1,1],tints:[0,0,0,0,0,0],fullCube:true,transparent:false}]}}));
  const server=spawn(process.execPath,[new URL('../serve.mjs',import.meta.url).pathname,'--root',toolsRoot,'--data',dataRoot,'--textures',textureRoot,'--port',String(port),'--host','127.0.0.1'],{stdio:'pipe'});
  t.after(()=>server.kill());
  const base=`http://127.0.0.1:${port}`;
  let ready=false;
  for (let i=0;i<100;i++) {try {const r=await fetch(`${base}/viewer/index.html`);if(r.ok){ready=true;break;}}catch{} await new Promise(resolve=>setTimeout(resolve,20));}
  assert.ok(ready,'server started');
  const texture=await fetch(base+'/textures/atlas.png',{headers:{Range:'bytes=1-3'}});
  assert.equal(texture.status,206); assert.equal(texture.headers.get('cache-control'),'no-store'); assert.equal(texture.headers.get('content-type'),'image/png'); assert.deepEqual([...new Uint8Array(await texture.arrayBuffer())],[80,78,71]);
  const table=await fetch(base+'/textures/blocks.json'); assert.equal((await table.json()).format,1);
  const jsonBytes=await readFile(join(textureRoot,'blocks.json'));
  const getRaw=(path,headers={})=>new Promise((resolve,reject)=>{
    const req=request(base+path,{headers},response=>{
      const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks)}));
    });req.on('error',reject);req.end();
  });
  const plain=await getRaw('/textures/blocks.json',{'Accept-Encoding':'identity'});
  assert.equal(plain.status,200);assert.equal(plain.headers['content-encoding'],undefined);assert.deepEqual(plain.body,jsonBytes);
  const zipped=await getRaw('/textures/blocks.json',{'Accept-Encoding':'br, gzip'});
  assert.equal(zipped.status,200);assert.equal(zipped.headers['content-encoding'],'gzip');assert.equal(zipped.headers.vary,'Accept-Encoding');
  assert.equal(Number(zipped.headers['content-length']),zipped.body.length);assert.deepEqual(gunzipSync(zipped.body),jsonBytes);
  const jsonRange=await getRaw('/textures/blocks.json',{'Accept-Encoding':'gzip',Range:'bytes=0-19'});
  assert.equal(jsonRange.status,206);assert.equal(jsonRange.headers['content-encoding'],undefined);assert.deepEqual(jsonRange.body,jsonBytes.subarray(0,20));
  const pngRaw=await getRaw('/textures/atlas.png',{'Accept-Encoding':'gzip'});
  assert.equal(pngRaw.headers['content-encoding'],undefined);assert.deepEqual(pngRaw.body,atlas);
  const changedJson=Buffer.from(jsonBytes.toString().replace('synthetic.jar','updated.jar'));
  await writeFile(join(textureRoot,'blocks.json'),changedJson);
  await utimes(join(textureRoot,'blocks.json'),new Date(),new Date(Date.now()+10000));
  const refreshed=await getRaw('/textures/blocks.json',{'Accept-Encoding':'gzip'});
  assert.deepEqual(gunzipSync(refreshed.body),changedJson);


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
