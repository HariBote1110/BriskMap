import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { decodeRegion } from '../../src/engine/format.mjs';
import { meshChunk as meshJs } from '../../src/engine/mesh-js.mjs';
import { loadMesher } from '../../src/engine/wasm.mjs';
import { resolveMaterials, flatMaterials, syntheticMaterials } from '../../src/engine/materials.mjs';
import { regionColours, rasteriseRegion } from '../../src/engine/map2d.mjs';

function referenceCross(positions, layer, tint) {
  const vertices = [], indices = [];
  for (const position of positions) {
    const x = position & 15, y = position >>> 8, z = position >>> 4 & 15;
    for (const [normal, start, end] of [[6, [x,z], [x+1,z+1]], [7, [x+1,z], [x,z+1]]]) {
      const front = [[...start,y], [...start,y+1], [...end,y+1], [...end,y]];
      for (const corners of [front, [...front].reverse()]) {
        const base = vertices.length / 12;
        for (const [vx,vz,vy] of corners) vertices.push(vx,0,vy&255,vy>>>8,vz,0,normal,3,layer&255,layer>>>8,tint,1);
        indices.push(base,base+1,base+2,base,base+2,base+3);
      }
    }
  }
  return {vertices: new Uint8Array(vertices), indices: new Uint32Array(indices), quads: positions.length * 4};
}

function currentHeader(old) {
  if (old[4] === 5) return old;
  const data=Buffer.alloc(old.length+2);
  old.copy(data,0,0,16); data[4]=5; data.writeInt16BE(32767,16); old.copy(data,18,16);
  let at=16;
  const varint=()=>{let value=0,shift=0,byte; do {byte=old[at++];value+=(byte&127)*2**shift;shift+=7;} while(byte&128);return value;};
  const count=varint();
  for(let i=0;i<count;i++){const length=varint();at+=length;}
  for(let i=0;i<1024;i++){const offset=old.readUInt32BE(at+i*8);if(offset)data.writeUInt32BE(offset+2,at+2+i*8);}
  return data;
}

test('cross plants use four independent double-sided planes in both modes', async () => {
  const positions = new Uint32Array([1+64*256+2*16, 2+64*256+2*16]);
  const materials = {faceLayers:new Uint16Array([9,9,9,9,9,9]),faceTints:new Uint8Array([1,1,1,1,1,1]),opaque:new Uint8Array([0]),alphaTest:new Uint8Array([1]),shape:new Uint8Array([1])};
  const input = {positions,paletteIndices:new Uint32Array([0,0]),masks:new Uint8Array([63,1]),materials};
  const expected = referenceCross(positions,9,1);
  const wasm = (await loadMesher()).meshChunk;
  for (const mode of ['culled','greedy']) for (const mesh of [meshJs,wasm]) {
    const actual = mesh(input,mode);
    assert.deepEqual(actual,expected);
  }
});

test('material shape and 2D plant colour use the cross texture', () => {
  const table={format:1,generator:2,tile:16,layers:3,textures:['a','b','c'],blocks:{'minecraft:short_grass':[{when:{},faces:[2,2,0,0,2,2],tints:[1,1,0,0,1,1],fullCube:false,transparent:true,shape:'cross'}]}};
  const materials=resolveMaterials(['minecraft:short_grass'],table);
  assert.deepEqual(materials.shape,new Uint8Array([1]));
  assert.deepEqual(flatMaterials(['minecraft:short_grass'],()=>1).shape,new Uint8Array([0]));
  assert.deepEqual(syntheticMaterials(['minecraft:short_grass']).shape,new Uint8Array([0]));
  const means=new Uint8Array([10,10,10,20,20,20,100,150,200]);
  const expected=[100*145/255,150*189/255,200*89/255];
  assert.deepEqual(Array.from(regionColours(['minecraft:short_grass'],table,means)),expected);
  const columns=Array.from({length:256},()=>({y:64,block:0,water:0}));
  const pixels=rasteriseRegion([{index:0,columns}],{palette:['minecraft:short_grass']},table,means);
  assert.deepEqual(Array.from(pixels.slice(0,4)),[...expected.map(Math.round),255]);
});

test('real chunks with rebuilt plant materials are byte identical in JS and WASM', async () => {
  const root=new URL('../fixtures-out/',import.meta.url);
  const table=JSON.parse(await readFile(new URL('textures/blocks.json',root),'utf8'));
  const region=await decodeRegion(currentHeader(await readFile(new URL('overworld/r.0.0.b3d',root))),inflateRawSync);
  const materials=resolveMaterials(region.palette,table);
  assert.ok(materials.shape.includes(1));
  const wasm=(await loadMesher()).meshChunk;
  for (const chunk of region.chunks) {
    const input={...chunk,materials};
    const js=meshJs(input,'greedy'),rs=wasm(input,'greedy');
    assert.deepEqual(rs.vertices,js.vertices);
    assert.deepEqual(rs.indices,js.indices);
  }
});
