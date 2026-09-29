import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMaterials } from '../src/materials.mjs';

test('material resolution honours first matching state and defaults', () => {
  const table={format:1,tile:16,layers:4,textures:['<missing>','a','b','c'],tints:['none','grass','foliage','water','other'],blocks:{
    'minecraft:log':[
      {when:{axis:'x'},faces:[1,1,1,1,1,1],tints:[1,1,1,1,1,1],fullCube:true,transparent:false},
      {when:{},faces:[2,2,2,2,2,2],tints:[2,2,2,2,2,2],fullCube:true,transparent:false}
    ],
    'minecraft:glass':[{when:{},faces:[3,3,3,3,3,3],tints:[0,0,0,0,0,0],fullCube:true,transparent:true}]
  }};
  const result=resolveMaterials(['minecraft:log[axis=x]','minecraft:log[axis=z]','minecraft:glass','minecraft:unknown'],table);
  assert.deepEqual([...result.faceLayers],[...Array(6).fill(1),...Array(6).fill(2),...Array(6).fill(3),...Array(6).fill(0)]);
  assert.deepEqual([...result.faceTints],[...Array(6).fill(1),...Array(6).fill(2),...Array(12).fill(0)]);
  assert.deepEqual([...result.opaque],[1,1,0,0]);
  assert.deepEqual([...result.alphaTest],[0,0,1,1]);
  table.blocks['minecraft:ordered']=[table.blocks['minecraft:log'][1],table.blocks['minecraft:log'][0]];
  const ordered=resolveMaterials(['minecraft:ordered[axis=x]'],table);
  assert.deepEqual([...ordered.faceLayers],Array(6).fill(2));
});
