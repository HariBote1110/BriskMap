export function formatError(message) { return Object.assign(new Error(message), { code: 'format' }); }
function cursorFor(bytes, offset) {
  return { bytes, offset, varint() {
    let value=0, shift=0;
    for (let n=0;n<5;n++) { if(this.offset>=bytes.length) throw formatError('Truncated varint'); const byte=bytes[this.offset++]; value+=(byte&127)*2**shift; if(byte<128){if(value>0xffffffff)throw formatError('Varint overflow');return value;} shift+=7; }
    throw formatError('Varint too long');
  }};
}
export function parseHeader(source, expectedKind) {
  const bytes=source instanceof Uint8Array?source:new Uint8Array(source);
  if(bytes.length<16) return {needed:16};
  if(String.fromCharCode(...bytes.subarray(0,4))!=='BRSK'||bytes[4]!==3||![1,2].includes(bytes[5])||(expectedKind&&bytes[5]!==expectedKind)) throw formatError('Unknown or invalid BriskMap format');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),cursor=cursorFor(bytes,16),decoder=new TextDecoder('utf-8',{fatal:true});
  const strings=()=>{const count=cursor.varint();if(count>65535)throw formatError('Palette too large');const result=[];for(let i=0;i<count;i++){const length=cursor.varint();if(length>65536)throw formatError('Palette entry too large');if(cursor.offset+length>bytes.length)throw formatError('Truncated palette');result.push(decoder.decode(bytes.subarray(cursor.offset,cursor.offset+length)));cursor.offset+=length;}return result;};
  try {
    const palette=strings(),biomes=bytes[5]===1?strings():[],dataStart=cursor.offset+8192;
    if(dataStart>bytes.length)return {needed:dataStart};
    const index=[];
    for(let i=0;i<1024;i++){const start=view.getUint32(cursor.offset+i*8,false),length=view.getUint32(cursor.offset+i*8+4,false);if((start===0)!==(length===0)||(length&&start<dataStart))throw formatError(`Invalid chunk index ${i}`);index.push({index:i,start,length});}
    return {version:3,kind:bytes[5],x:view.getInt32(6,false),z:view.getInt32(10,false),flags:bytes[14],palette,biomes,index,dataStart};
  } catch(error) { if(error.code==='format'&&/Truncated (varint|palette)/.test(error.message)) return {needed:bytes.length+65536}; throw error; }
}
export function decode2d(source,header) {
  const bytes=source instanceof Uint8Array?source:new Uint8Array(source),cursor=cursorFor(bytes,0),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),columns=[];
  for(let i=0;i<256;i++){if(cursor.offset+2>bytes.length)throw formatError('Truncated 2D column');const y=view.getInt16(cursor.offset,false);cursor.offset+=2;const block=cursor.varint(),biome=cursor.varint();if(cursor.offset>=bytes.length||block>=header.palette.length||biome>=header.biomes.length)throw formatError('Invalid 2D column');const water=bytes[cursor.offset++];columns.push({y,block,biome,water});}
  if(cursor.offset!==bytes.length)throw formatError('Trailing 2D bytes');return columns;
}
export function decode3d(source,header) {
  const bytes=source instanceof Uint8Array?source:new Uint8Array(source),cursor=cursorFor(bytes,0),positions=[],paletteIndices=[],masks=[];
  for(let sy=0;sy<24;sy++){const n=cursor.varint();if(n>4096)throw formatError('Too many blocks');let previous=0;for(let i=0;i<n;i++){const delta=cursor.varint(),local=previous+delta;if(local>=4096||(i&&delta===0))throw formatError('Invalid block position');positions.push(sy*4096+local);previous=local;}for(let i=0;i<n;i++){const index=cursor.varint();if(index>=header.palette.length)throw formatError('Invalid palette index');paletteIndices.push(index);}if(cursor.offset+n>bytes.length)throw formatError('Truncated face masks');for(let i=0;i<n;i++){const mask=bytes[cursor.offset++];if(!mask||(mask&0xc0))throw formatError('Invalid face mask');masks.push(mask);}}
  if(cursor.offset!==bytes.length)throw formatError('Trailing 3D bytes');return {positions:Uint32Array.from(positions),paletteIndices:Uint32Array.from(paletteIndices),masks:Uint8Array.from(masks)};
}
export async function decodeRegion(source,inflate) {
  const bytes=source instanceof Uint8Array?source:new Uint8Array(source),header=parseHeader(bytes,2),chunks=[];
  for(const entry of header.index)if(entry.length){const raw=await inflate(bytes.subarray(entry.start,entry.start+entry.length));const decoded=decode3d(raw,header);chunks.push({index:entry.index,positions:Uint32Array.from(decoded.positions),paletteIndices:Uint32Array.from(decoded.paletteIndices),masks:Uint8Array.from(decoded.masks)});}
  return {...header,chunks};
}
