
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  return table;
}
const CRC_TABLE = makeCrcTable();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}
const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const w = 800, h = 600;
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const raw = Buffer.alloc(h * (1 + w * 3));
for (let y = 0; y < h; y++) {
  const off = y * (1 + w * 3);
  raw[off] = 0;
  for (let x = 0; x < w; x++) {
    raw[off + 1 + x * 3 + 0] = 200;
    raw[off + 1 + x * 3 + 1] = 100;
    raw[off + 1 + x * 3 + 2] = 50;
  }
}
const idat = require('zlib').deflateSync(raw);
const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
const dir = mkdtempSync(join(tmpdir(), 'png-'));
const file = join(dir, 't.png');
writeFileSync(file, png);

console.log('wrote:', file);
console.log('size:', png.length, 'bytes');
console.log('first 32 bytes hex:', png.subarray(0, 32).toString('hex'));
const hex16_19 = png.subarray(16, 20).toString('hex');
console.log('bytes 16-19:', hex16_19, '(expected 00000320 for w=800)');

const cmd = `import struct
with open('${file}', 'rb') as f:
    f.seek(16)
    print(struct.unpack('>I', f.read(4))[0])`;
console.log('--- python -c command ---');
console.log(cmd);
const result = execFileSync('python3', ['-c', cmd]);
console.log('python output bytes:', result);
console.log('python output str:', result.toString());
console.log('parsed parseInt(s, 10):', parseInt(result.toString().trim(), 10));
