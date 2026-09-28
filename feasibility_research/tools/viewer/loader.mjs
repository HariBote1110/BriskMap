import { colourTable } from '../mesher/src/colour.mjs';

export function selectChunks(x, z, radius) {
  if (![x,z,radius].every(Number.isFinite) || radius < 0) throw new Error('Invalid selection parameters');
  const chunks = [];
  const minX = Math.floor((x-radius)/16)-1, maxX = Math.floor((x+radius)/16);
  const minZ = Math.floor((z-radius)/16)-1, maxZ = Math.floor((z+radius)/16);
  for (let cz=minZ; cz<=maxZ; cz++) for (let cx=minX; cx<=maxX; cx++) {
    const dx = Math.max(cx*16-x, 0, x-(cx+1)*16);
    const dz = Math.max(cz*16-z, 0, z-(cz+1)*16);
    if (dx*dx+dz*dz<=radius*radius) chunks.push({cx,cz,rx:Math.floor(cx/32),rz:Math.floor(cz/32),index:(cz&31)*32+(cx&31)});
  }
  return chunks;
}

export function coalesceRanges(entries, maxGap=4096) {
  const result=[];
  for (const entry of [...entries].filter(entry=>entry.length>0).sort((a,b)=>a.start-b.start)) {
    const last=result.at(-1), end=entry.start+entry.length-1;
    if (last && entry.start-last.end-1<=maxGap) {last.end=Math.max(last.end,end);last.entries.push(entry);}
    else result.push({start:entry.start,end,entries:[entry]});
  }
  return result;
}

export async function defaultFetchRange(url,start,end) {
  return fetch(url,{headers:{Range:`bytes=${start}-${end}`}});
}

async function bytesFor(url,start,end,options) {
  const response=await (options.fetchRange ?? defaultFetchRange)(url,start,end);
  if (response.status!==206 && response.status!==200) throw new Error(`${url}: HTTP ${response.status}`);
  options.onFirstByte?.();
  const bytes=new Uint8Array(await response.arrayBuffer());
  options.onResponse?.(bytes.byteLength);
  if (response.status===206) {
    const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range')??'');
    if (!match || Number(match[1])!==start || Number(match[2])-start+1!==bytes.length) throw new Error('Invalid Content-Range');
    return bytes;
  }
  if (bytes.length<=start) throw new Error('Range response is too short');
  return bytes.subarray(start,Math.min(end+1,bytes.length));
}

function parseHeader(bytes) {
  if (bytes.length<14) throw new Error('Truncated .b3d header');
  if (String.fromCharCode(...bytes.subarray(0,4))!=='BRSK' || bytes[4]!==2 || bytes[5]!==2) throw new Error('Invalid .b3d v2 header');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let offset=14;
  const varint=()=>{let value=0,shift=0;for(let n=0;n<5;n++){if(offset>=bytes.length)return null;const byte=bytes[offset++];value+=(byte&127)*2**shift;if(byte<128){if(value>0xffffffff)throw new Error('Varint overflow');return value;}shift+=7;}throw new Error('Varint too long');};
  const count=varint();if(count===null)return {needed:bytes.length+65536};
  const palette=[],decoder=new TextDecoder('utf-8',{fatal:true});
  for(let i=0;i<count;i++){const length=varint();if(length===null)return {needed:bytes.length+65536};if(offset+length>bytes.length)return {needed:offset+length+8192};palette.push(decoder.decode(bytes.subarray(offset,offset+length)));offset+=length;}
  const dataStart=offset+8192;
  if(dataStart>bytes.length)return {needed:dataStart};
  const index=[];
  for(let i=0;i<1024;i++){const start=view.getUint32(offset+i*8,false),length=view.getUint32(offset+i*8+4,false);if((start===0)!==(length===0)||length && start<dataStart)throw new Error(`Invalid chunk index ${i}`);index.push({index:i,start,length});}
  return {x:view.getInt32(6,false),z:view.getInt32(10,false),palette,colours:colourTable(palette),index,dataStart};
}

export async function loadRegionHeader(url,options={}) {
  let bytes=await bytesFor(url,0,65535,options);
  for(let attempt=0;attempt<3;attempt++){
    const parsed=parseHeader(bytes);if(!parsed.needed)return parsed;
    const extra=await bytesFor(url,bytes.length,parsed.needed-1,options);
    const combined=new Uint8Array(bytes.length+extra.length);combined.set(bytes);combined.set(extra,bytes.length);bytes=combined;
  }
  throw new Error('Region header exceeds supported size');
}

function readVarint(bytes,cursor) {
  let value=0,shift=0;
  for(let n=0;n<5;n++){if(cursor.offset>=bytes.length)throw new Error('Truncated varint');const byte=bytes[cursor.offset++];value+=(byte&127)*2**shift;if(byte<128){if(value>0xffffffff)throw new Error('Varint overflow');return value;}shift+=7;}
  throw new Error('Varint too long');
}

export function decodeChunk(bytes,paletteLength) {
  const cursor={offset:0},positions=[],paletteIndices=[],masks=[];
  for(let sy=0;sy<24;sy++){
    const n=readVarint(bytes,cursor);if(n>4096)throw new Error('Too many blocks in section');
    let previous=0;
    for(let i=0;i<n;i++){const delta=readVarint(bytes,cursor),local=previous+delta;if(local>=4096||i&&delta===0)throw new Error('Invalid block position');positions.push(sy*4096+local);previous=local;}
    for(let i=0;i<n;i++){const index=readVarint(bytes,cursor);if(index>=paletteLength)throw new Error('Invalid palette index');paletteIndices.push(index);}
    if(cursor.offset+n>bytes.length)throw new Error('Truncated face masks');
    for(let i=0;i<n;i++){const mask=bytes[cursor.offset++];if(!mask||mask&0xc0)throw new Error('Invalid face mask');masks.push(mask);}
  }
  if(cursor.offset!==bytes.length)throw new Error('Trailing chunk bytes');
  return {positions:Uint32Array.from(positions),paletteIndices:Uint32Array.from(paletteIndices),masks:Uint8Array.from(masks)};
}

export async function loadSelectedChunks(url,header,entries,options={}) {
  const result=[];
  for(const range of coalesceRanges(entries)){
    const bytes=await bytesFor(url,range.start,range.end,options);
    for(const entry of range.entries){
      const compressed=bytes.subarray(entry.start-range.start,entry.start-range.start+entry.length);
      const raw=await options.inflate(compressed);
      const chunk=decodeChunk(raw instanceof Uint8Array?raw:new Uint8Array(raw),header.palette.length);
      result.push({index:entry.index,...chunk});
    }
  }
  return result;
}

export async function fetchSelectedRanges(url,entries,options,onChunk) {
  for(const range of coalesceRanges(entries)){
    const bytes=await bytesFor(url,range.start,range.end,options);
    for(const entry of range.entries){
      const compressed=bytes.slice(entry.start-range.start,entry.start-range.start+entry.length);
      onChunk(entry,compressed);
    }
  }
}
