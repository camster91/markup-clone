#!/usr/bin/env python3
"""Generate a minimal valid 800x600 PNG with a colored rectangle for testing."""

import struct
import zlib
import os

def make_png(width, height, filepath):
    def chunk(chunk_type, data):
        c = chunk_type + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    # PNG signature
    signature = b'\x89PNG\r\n\x1a\n'

    # IHDR: width, height, bit depth=8, color type=2 (RGB), compression=0, filter=0, interlace=0
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    ihdr = chunk(b'IHDR', ihdr_data)

    # Build raw scanlines (filter byte 0 + RGB per pixel)
    raw = b''
    for y in range(height):
        raw += b'\x00'  # filter type None
        row = b''
        for x in range(width):
            # Blue rectangle region: x in [100,700], y in [100,500]
            if 100 <= x < 700 and 100 <= y < 500:
                row += b'\x00\x88\xff'  # blue
            else:
                row += b'\xff\xff\xff'  # white
        raw += row

    compressed = zlib.compress(raw, 6)
    idat = chunk(b'IDAT', compressed)

    # IEND
    iend = chunk(b'IEND', b'')

    with open(filepath, 'wb') as f:
        f.write(signature + ihdr + idat + iend)

if __name__ == '__main__':
    out = os.path.join(os.path.dirname(__file__), '..', 'fixtures', 'test-pin.png')
    make_png(800, 600, out)
    size = os.path.getsize(out)
    print(f"Wrote {out} ({size} bytes)")