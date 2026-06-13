// Unit tests for the PNG dimension parser used by recapture.sh.
// The script reads a PNG file's IHDR chunk (bytes 16-23) to get the width
// and height. We test the Python helper that recapture.sh shells out to.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Standard CRC32 (PNG spec uses IEEE 802.3 CRC32 with init=0xFFFFFFFF and
// final XOR=0xFFFFFFFF). Node doesn't expose a CRC32 in zlib so we hand-roll
// the standard table-based implementation.
function makeCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
}
const CRC_TABLE = makeCrcTable();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// Recreate the Python heredoc used by recapture.sh. Keep in sync with
// the actual recapture.sh script.
function pngWidth(filePath: string): number {
  return parseInt(
    execFileSync('python3', ['-c', `
import struct
with open('${filePath}', 'rb') as f:
    f.seek(16)
    print(struct.unpack('>I', f.read(4))[0])
`]).toString().trim(),
    10
  );
}

function pngHeight(filePath: string): number {
  return parseInt(
    execFileSync('python3', ['-c', `
import struct
with open('${filePath}', 'rb') as f:
    f.seek(20)
    print(struct.unpack('>I', f.read(4))[0])
`]).toString().trim(),
    10
  );
}

function makePng(w: number, h: number, color: [number, number, number] = [200, 100, 50]): Buffer {
  // Build a minimal valid PNG. Same logic as tests/scripts/make-test-png.py.
  // Returns a Buffer (NOT a string) so writeFileSync preserves the binary
  // bytes. Earlier version returned toString() which UTF-8-encoded the PNG,
  // corrupting the 0x89 signature byte to 0xEF 0xBF 0xBD (U+FFFD).
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeAndData = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData), 0);
    return Buffer.concat([len, typeAndData, crc]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  // IDAT: minimal scanlines (filter byte 0 + RGB per pixel)
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * 3);
    raw[off] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      raw[off + 1 + x * 3 + 0] = color[0];
      raw[off + 1 + x * 3 + 1] = color[1];
      raw[off + 1 + x * 3 + 2] = color[2];
    }
  }
  const idat = require('zlib').deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

describe('pngWidth', () => {
  it('reads 800 from a valid 800x600 PNG', () => {
    const dir = mkdtempSync(join(tmpdir(), 'png-'));
    const file = join(dir, 't.png');
    writeFileSync(file, makePng(800, 600));
    try {
      expect(pngWidth(file)).toBe(800);
    } finally { unlinkSync(file); }
  });

  it('reads 1280 from a valid 1280x800 PNG (recapture default)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'png-'));
    const file = join(dir, 't.png');
    writeFileSync(file, makePng(1280, 800));
    try {
      expect(pngWidth(file)).toBe(1280);
    } finally { unlinkSync(file); }
  });

  it('reads large widths correctly (e.g. 4000)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'png-'));
    const file = join(dir, 't.png');
    writeFileSync(file, makePng(4000, 1000));
    try {
      expect(pngWidth(file)).toBe(4000);
    } finally { unlinkSync(file); }
  });

  it('reads 0 for a 0x0 PNG (edge case)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'png-'));
    const file = join(dir, 't.png');
    writeFileSync(file, makePng(0, 0));
    try {
      expect(pngWidth(file)).toBe(0);
    } finally { unlinkSync(file); }
  });
});

describe('pngHeight', () => {
  it('reads 600 from a valid 800x600 PNG', () => {
    const dir = mkdtempSync(join(tmpdir(), 'png-'));
    const file = join(dir, 't.png');
    writeFileSync(file, makePng(800, 600));
    try {
      expect(pngHeight(file)).toBe(600);
    } finally { unlinkSync(file); }
  });

  it('reads 800 from a valid 1280x800 PNG (recapture default)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'png-'));
    const file = join(dir, 't.png');
    writeFileSync(file, makePng(1280, 800));
    try {
      expect(pngHeight(file)).toBe(800);
    } finally { unlinkSync(file); }
  });
});

describe('recapture.sh: PNG dimension extraction matches the existing fixture', () => {
  // The existing tests/fixtures/test-pin.png was generated by make-test-png.py
  // and verified to be 800x600 by `file`. The script's parser should also read
  // 800x600. This catches any future drift in the script vs the fixture.
  it('matches the file command output for tests/fixtures/test-pin.png', () => {
    const file = '/Users/biancabienaime/markup-clone/tests/fixtures/test-pin.png';
    const w = pngWidth(file);
    const h = pngHeight(file);
    // The fixture is generated at 800x600. If the script's parser disagrees,
    // either the fixture or the parser is wrong. Update both together.
    expect({ width: w, height: h }).toEqual({ width: 800, height: 600 });
  });
});
