import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { parseHeader, decode2d } from '../../src/engine/format.mjs';
import { meanLayers, rasteriseRegion, regionColours, shadeNorthRow } from '../../src/engine/map2d.mjs';
import { flatMaterials } from '../../src/engine/materials.mjs';
import { colourFor } from '../../src/engine/colour.mjs';
import { keyView, wheelScale, normaliseView } from '../../src/engine/view.mjs';
import { WorkerPool } from '../../src/engine/worker-pool.mjs';
import { createViewer } from '../../src/engine/index.mjs';

const root = new URL('../fixtures-out/overworld/', import.meta.url);
const textureRoot = new URL('../../../feasibility_research/output/textures/26.3/', import.meta.url);
const tint = [[255,255,255],[145,189,89],[119,171,47],[63,118,228],[255,255,255]];

test('flat materials assign one FNV colour per block name', () => {
  const palette = ['minecraft:stone', 'minecraft:grass_block[snowy=false]', 'minecraft:stone', 'minecraft:grass_block[snowy=true]'];
  const registered = new Map();
  const materials = flatMaterials(palette, state => {
    if (!registered.has(state)) registered.set(state, registered.size);
    return registered.get(state);
  });
  assert.deepEqual(Array.from(materials.faceLayers), [0,0,0,0,0,0,1,1,1,1,1,1,0,0,0,0,0,0,1,1,1,1,1,1]);
  assert.equal(registered.size, 2);
  const colours=regionColours(palette);
  const hash=colourFor('minecraft:grass_block');
  assert.deepEqual(Array.from(colours.slice(3,6)),[hash&255,hash>>>8&255,hash>>>16&255]);
  assert.deepEqual(Array.from(colours.slice(3,6)),Array.from(colours.slice(9,12)));
});

test('keyboard and wheel gesture maths keep the view within its limits', () => {
  const three = normaliseView([0,64,0], 'world', '3d');
  assert.ok(keyView(three, 'ArrowUp').z < three.z);
  assert.ok(keyView(three, 'KeyE').yaw > three.yaw);
  assert.equal(wheelScale(three, 1e6).distance, 1024);
  const two = normaliseView([0,64,0], 'world', '2d', {zoom: 1/16});
  assert.ok(keyView(two, 'ArrowLeft').x < two.x);
  assert.equal(wheelScale(two, 1e6).zoom, 1/16);
});

test('queued stale worker results are cancelled before dispatch', async () => {
  const previous=globalThis.Worker,workers=[];
  globalThis.Worker=class {
    constructor(){this.messages=[];workers.push(this);}
    postMessage(message){this.messages.push(message);}
    terminate(){}
  };
  try {
    const pool=new WorkerPool(1);
    const active=pool.run('raster',{tag:'first'},{tag:'first'});
    const stale=pool.run('raster',{tag:'old'},{tag:'old'});
    pool.cancelQueued(task=>task.tag==='old');
    await assert.rejects(stale,error=>error.code==='cancelled');
    assert.equal(workers[0].messages.length,1);
    workers[0].onmessage({data:{id:1,type:'raster',pixels:new Uint8Array(0)}});
    await active;
    assert.equal(workers[0].messages.length,1);
    pool.dispose();
  } finally {globalThis.Worker=previous;}
});

test('viewer rejects unavailable WebGL2 with the public error code', async () => {
  await assert.rejects(createViewer({getContext:()=>null},{}),error=>error.code==='webgl2');
});

test('real 2D raster pixels agree with an independent material and height reference', async () => {
  const table = JSON.parse(await readFile(new URL('blocks.json', textureRoot), 'utf8'));
  const png = await readFile(new URL('atlas.png', textureRoot));
  let at = 8, packed = [];
  while (at < png.length) { const n=png.readUInt32BE(at), type=png.toString('ascii',at+4,at+8); if(type==='IDAT')packed.push(png.subarray(at+8,at+8+n)); at+=n+12; }
  const { inflateSync } = await import('node:zlib');
  const filtered = inflateSync(Buffer.concat(packed)), pixels = new Uint8Array(table.layers*16*16*4);
  const stride=64;
  for(let y=0;y<table.layers*16;y++)for(let x=0;x<stride;x++){
    const offset=y*stride+x,raw=filtered[y*(stride+1)+1+x],left=x>=4?pixels[offset-4]:0,up=y?pixels[offset-stride]:0,upperLeft=y&&x>=4?pixels[offset-stride-4]:0,filter=filtered[y*(stride+1)];
    let predictor=0;if(filter===1)predictor=left;else if(filter===2)predictor=up;else if(filter===3)predictor=Math.floor((left+up)/2);else if(filter===4){const p=left+up-upperLeft,a=Math.abs(p-left),b=Math.abs(p-up),c=Math.abs(p-upperLeft);predictor=a<=b&&a<=c?left:b<=c?up:upperLeft;}
    pixels[offset]=(raw+predictor)&255;
  }
  const means=meanLayers(pixels,table.layers),data=await readFile(new URL('r.0.0.b2d',root)),header=parseHeader(data,1);
  const chunks=header.index.filter(e=>e.length).map(entry=>({index:entry.index,columns:decode2d(inflateRawSync(data.subarray(entry.start,entry.start+entry.length)),header)}));
  const colours=regionColours(header.palette,table,means),raster=rasteriseRegion(chunks,header,table,means);
  assert.equal(colours.length,header.palette.length*3);
  const heights=new Int16Array(512*512).fill(-32768),blocks=new Uint32Array(512*512),water=new Uint8Array(512*512);
  for(const chunk of chunks)for(let i=0;i<256;i++){const x=(chunk.index&31)*16+(i&15),z=(chunk.index>>5)*16+(i>>4),p=x+z*512,c=chunk.columns[i];heights[p]=c.y;blocks[p]=c.block;water[p]=c.water;}
  const referenceLayers=new Array(table.layers);
  for(let layer=0;layer<table.layers;layer++){
    const sums=[0,0,0];let count=0;
    for(let pixel=layer*256;pixel<(layer+1)*256;pixel++)if(pixels[pixel*4+3]>=128){for(let channel=0;channel<3;channel++)sums[channel]+=pixels[pixel*4+channel];count++;}
    referenceLayers[layer]=sums.map(sum=>count?Math.round(sum/count):0);
  }
  const referenceColours=header.palette.map(state=>{
    const bracket=state.indexOf('['),name=bracket<0?state:state.slice(0,bracket);
    const properties=Object.fromEntries((bracket<0?[]:state.slice(bracket+1,-1).split(',')).map(pair=>pair.split('=')));
    const material=table.blocks[name]?.find(candidate=>Object.entries(candidate.when).every(([key,value])=>properties[key]===value));
    const layer=material?.faces[3]??0,colourTint=tint[material?.tints[3]??0];
    return referenceLayers[layer].map((channel,index)=>channel*colourTint[index]/255);
  });
  const expected=new Uint8Array(512*512*4);
  let checked=0,wet=0;
  for(let z=0;z<512;z++)for(let x=0;x<512;x++){
    const p=x+z*512,y=heights[p];
    if(y===-32768)continue;
    const previous=z?heights[p-512]:y;
    const shade=previous===-32768||previous===y?1:y>previous?1.1:.9;
    const blend=Math.min(water[p],16)/16*.38;
    for(let channel=0;channel<3;channel++){
      const base=referenceColours[blocks[p]][channel];
      expected[p*4+channel]=Math.round(Math.max(0,Math.min(255,(base*(1-blend)+[30,65,130][channel]*blend)*shade)));
    }
    expected[p*4+3]=255;
    checked++;if(water[p])wet++;
  }
  assert.ok(checked>1000);assert.ok(wet>0);
  assert.deepEqual(raster,expected);
});

test('north edge shading uses the southern edge of the adjacent real region', async () => {
  const [current,north]=await Promise.all(['r.0.0.b2d','r.0.-1.b2d'].map(name=>readFile(new URL(name,root))));
  const currentHeader=parseHeader(current,1),northHeader=parseHeader(north,1);
  const currentY=new Int16Array(512).fill(-32768),northY=new Int16Array(512).fill(-32768),blocks=new Uint32Array(512),water=new Uint8Array(512);
  for(let cx=0;cx<32;cx++){
    const a=currentHeader.index[cx],b=northHeader.index[31*32+cx];
    if(a.length){const columns=decode2d(inflateRawSync(current.subarray(a.start,a.start+a.length)),currentHeader);for(let x=0;x<16;x++){const position=cx*16+x;currentY[position]=columns[x].y;blocks[position]=columns[x].block;water[position]=columns[x].water;}}
    if(b.length){const columns=decode2d(inflateRawSync(north.subarray(b.start,b.start+b.length)),northHeader);for(let x=0;x<16;x++)northY[cx*16+x]=columns[15*16+x].y;}
  }
  const colours=regionColours(currentHeader.palette),actual=shadeNorthRow({heights:currentY,blocks,waters:water},northY,colours);
  assert.equal(actual.length,512*4);
  let comparisons=0;
  for(let x=0;x<512;x++){
    const y=currentY[x],previous=northY[x];
    if(y===-32768){assert.equal(actual[x*4+3],0);continue;}
    const shade=previous===-32768||previous===y?1:y>previous?1.1:.9,blend=Math.min(water[x],16)/16*.38;
    for(let channel=0;channel<3;channel++){
      const base=colours[blocks[x]*3+channel];
      const expected=Math.round(Math.min(255,Math.max(0,(base*(1-blend)+[30,65,130][channel]*blend)*shade)));
      assert.equal(actual[x*4+channel],expected);
    }
    assert.equal(actual[x*4+3],255);
    comparisons++;
  }
  assert.ok(comparisons>100);
});
