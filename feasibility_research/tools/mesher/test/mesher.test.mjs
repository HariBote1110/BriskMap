import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { encodeRegion } from './encode.mjs';
import { decodeRegion } from '../src/format.mjs';
import { meshChunk as meshJs } from '../src/mesh-js.mjs';
import { loadMesher } from '../src/wasm.mjs';

const popcount = mask => { let n = 0; while (mask) { n += mask & 1; mask >>>= 1; } return n; };
const fixture = () => {
  const blocks = [{ p: 0, palette: 0, mask: 63 }, { p: 4095, palette: 1, mask: 8 }, { p: 4096, palette: 0, mask: 1 }];
  const full = Array.from({ length: 4096 }, (_, p) => ({ p: 2 * 4096 + p, palette: p & 1, mask: 8 }));
  return { palette: ['minecraft:stone', 'minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]'], chunks: new Map([[0, blocks], [35, full]]) };
};

test('v2 round trip: palette, absent chunks, empty and full sections', async () => {
  const source = fixture();
  const decoded = await decodeRegion(encodeRegion({ x: -2, z: 3, ...source }), data => inflateRawSync(data));
  assert.equal(decoded.x, -2); assert.equal(decoded.z, 3);
  assert.deepEqual(decoded.palette, source.palette);
  assert.equal(decoded.chunks.length, 2);
  assert.equal(decoded.chunks[0].index, 0); assert.equal(decoded.chunks[1].index, 35);
  for (const chunk of decoded.chunks) {
    const expected = source.chunks.get(chunk.index);
    assert.deepEqual(Array.from(chunk.positions), expected.map(v => v.p));
    assert.deepEqual(Array.from(chunk.paletteIndices), expected.map(v => v.palette));
    assert.deepEqual(Array.from(chunk.masks), expected.map(v => v.mask));
  }
});

function input(blocks, opaque = Uint8Array.of(1, 0)) {
  return { positions: Uint32Array.from(blocks.map(block => block.p)), paletteIndices: Uint32Array.from(blocks.map(block => block.palette)), masks: Uint8Array.from(blocks.map(block => block.mask)), materials: { faceLayers: Uint16Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), faceTints: Uint8Array.from([0, 1, 0, 1, 0, 1, 2, 0, 2, 0, 2, 0]), opaque, alphaTest: Uint8Array.of(0, 1) } };
}
function faceCells(sample) {
  const cells = new Map();
  for (let i = 0; i < sample.positions.length; i++) cells.set(sample.positions[i], sample.paletteIndices[i]);
  return cells;
}
function bruteAo(sample, cells, p, normal, corner) {
  const axis = normal >> 1, uAxis = (axis + 1) % 3, vAxis = (axis + 2) % 3;
  const positive = normal & 1;
  const canonical = positive ? [[0,0],[1,0],[1,1],[0,1]] : [[0,0],[0,1],[1,1],[1,0]];
  const [u,v] = canonical[corner];
  const xyz = [p & 15, p >> 8, (p >> 4) & 15];
  xyz[axis] += positive ? 1 : -1;
  const solid = (du,dv) => { const cell = [...xyz]; cell[uAxis] += du; cell[vAxis] += dv; if (cell[0]<0||cell[0]>=16||cell[1]<0||cell[1]>=384||cell[2]<0||cell[2]>=16) return 0; const index = cell[0] + cell[1]*256 + cell[2]*16; const palette = cells.get(index); return palette === undefined ? 0 : sample.materials.opaque[palette] ? 1 : 0; };
  const s1=solid(u?1:-1,0),s2=solid(0,v?1:-1),c=solid(u?1:-1,v?1:-1);
  return s1&&s2?0:3-s1-s2-c;
}
function quads(mesh) {
  const view = new DataView(mesh.vertices.buffer, mesh.vertices.byteOffset, mesh.vertices.byteLength);
  return Array.from({length:mesh.quads},(_,q)=>{
    const points=[], ao=[]; let normal,layer,tint,flags;
    for(let c=0;c<4;c++) { const at=(q*4+c)*12; points.push([view.getUint16(at,true),view.getUint16(at+2,true),view.getUint16(at+4,true)]); normal=view.getUint8(at+6); ao.push(view.getUint8(at+7)); layer=view.getUint16(at+8,true);tint=view.getUint8(at+10);flags=view.getUint8(at+11); }
    const base=q*4, expected=ao[0]+ao[2]<ao[1]+ao[3]?[base,base+1,base+3,base+1,base+2,base+3]:[base,base+1,base+2,base,base+2,base+3];
    assert.deepEqual(Array.from(mesh.indices.slice(q*6,q*6+6)),expected);
    return {points,normal,ao,layer,tint,flags};
  });
}
function coverage(mesh) {
  const covered=new Map();
  for(const quad of quads(mesh)) {
    const {points,normal,ao,layer,tint,flags}=quad;
    const axis=normal>>1,uAxis=(axis+1)%3,vAxis=(axis+2)%3;
    const us=points.map(point=>point[uAxis]),vs=points.map(point=>point[vAxis]);
    const u0=Math.min(...us),v0=Math.min(...vs),u1=Math.max(...us),v1=Math.max(...vs);
    for(let v=v0;v<v1;v++)for(let u=u0;u<u1;u++){
      const key=`${normal}/${points[0][axis]}/${u}/${v}`;
      assert.ok(!covered.has(key),`overlap ${key}`);
      covered.set(key,`${layer}/${tint}/${flags}/${ao.join('')}`);
    }
  }
  return [...covered].sort((a,b)=>a[0].localeCompare(b[0]));
}
let seed=0x12345678;
function random(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;}
const samples=Array.from({length:3},()=>{const blocks=new Map();for(let i=0;i<500;i++){const p=(random()%8)*256+(random()%16)*16+random()%16;blocks.set(p,{p,palette:random()%2,mask:1+random()%63});}return input([...blocks.values()]);});

test('random culled AO matches independent cell reference',()=>{
  for(const sample of samples){const cells=faceCells(sample);for(const quad of quads(meshJs(sample,'culled'))){const {points,normal,ao}=quad;const axis=normal>>1,positive=normal&1;const p=points[0][0]+points[0][1]*256+points[0][2]*16-(positive?[1,256,16][axis]:0);for(let c=0;c<4;c++)assert.equal(ao[c],bruteAo(sample,cells,p,normal,c),`p=${p} normal=${normal} corner=${c}`);}}
});
test('greedy coverage retains every material and AO with no overlap',()=>{for(const sample of samples)assert.deepEqual(coverage(meshJs(sample,'greedy')),coverage(meshJs(sample,'culled')));});
test('AO selects the brighter diagonal',()=>{let flips=0;for(const sample of samples)for(const mode of ['culled','greedy']){const mesh=meshJs(sample,mode);for(const quad of quads(mesh))if(quad.ao[0]+quad.ao[2]<quad.ao[1]+quad.ao[3])flips++;}assert.ok(flips>0);});
test('JS and WASM outputs are byte identical',async()=>{const wasm=await loadMesher();for(const sample of samples)for(const mode of ['culled','greedy']){const js=meshJs(sample,mode),rs=wasm.meshChunk(sample,mode);assert.deepEqual(rs.vertices,js.vertices);assert.deepEqual(new Uint8Array(rs.indices.buffer),new Uint8Array(js.indices.buffer));}});
test('reused scratch state clears previous blocks and faces',async()=>{
  const wasm=(await loadMesher()).meshChunk;
  const near=input([{p:0,palette:0,mask:63},{p:1,palette:0,mask:63}]);
  const far=input([{p:98303,palette:1,mask:63}]);
  for(const mesh of [meshJs,wasm])for(const mode of ['culled','greedy']){
    const first=mesh(near,mode);
    mesh(far,mode);
    const again=mesh(near,mode);
    assert.deepEqual(again.vertices,first.vertices);
    assert.deepEqual(again.indices,first.indices);
  }
});
