import { inflateRawSync } from 'node:zlib';
import { crc32 } from './png.mjs';

export class ZipReader {
  constructor(data) {
    this.data = data;
    this.entries = new Map();
    let end = -1;
    for (let at = data.length - 22; at >= Math.max(0, data.length - 65557); at--) if (data.readUInt32LE(at) === 0x06054b50) { end = at; break; }
    if (end < 0) throw new Error('ZIP central directory missing');
    const count = data.readUInt16LE(end + 10); let at = data.readUInt32LE(end + 16);
    for (let i = 0; i < count; i++) {
      if (data.readUInt32LE(at) !== 0x02014b50) throw new Error('Invalid ZIP central directory');
      const method = data.readUInt16LE(at + 10), crc = data.readUInt32LE(at + 16), packed = data.readUInt32LE(at + 20), size = data.readUInt32LE(at + 24);
      const nameLength = data.readUInt16LE(at + 28), extra = data.readUInt16LE(at + 30), comment = data.readUInt16LE(at + 32), offset = data.readUInt32LE(at + 42);
      const name = data.toString('utf8', at + 46, at + 46 + nameLength);
      this.entries.set(name, {method, crc, packed, size, offset});
      at += 46 + nameLength + extra + comment;
    }
  }
  read(name) {
    const entry = this.entries.get(name);
    if (!entry) return undefined;
    const at = entry.offset, data = this.data;
    if (data.readUInt32LE(at) !== 0x04034b50) throw new Error(`Invalid ZIP entry: ${name}`);
    const start = at + 30 + data.readUInt16LE(at + 26) + data.readUInt16LE(at + 28);
    const packed = data.subarray(start, start + entry.packed);
    const result = entry.method === 0 ? packed : entry.method === 8 ? inflateRawSync(packed) : (() => { throw new Error(`Unsupported ZIP method: ${entry.method}`); })();
    if (result.length !== entry.size || crc32(result) !== entry.crc) throw new Error(`Invalid ZIP content: ${name}`);
    return result;
  }
}
