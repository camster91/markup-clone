import { describe, expect, it } from 'vitest';
import { readImageDimensions } from '@/lib/image-dimensions';

function png(width: number, height: number) {
  const value = Buffer.alloc(24);
  value.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  value.writeUInt32BE(13, 8);
  value.write('IHDR', 12, 'ascii');
  value.writeUInt32BE(width, 16);
  value.writeUInt32BE(height, 20);
  return value;
}

function jpeg(width: number, height: number) {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08,
    height >> 8, height & 0xff, width >> 8, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
  ]);
}

function webp(width: number, height: number) {
  const value = Buffer.alloc(30);
  value.write('RIFF', 0, 'ascii');
  value.writeUInt32LE(22, 4);
  value.write('WEBPVP8X', 8, 'ascii');
  value.writeUInt32LE(10, 16);
  value.writeUIntLE(width - 1, 24, 3);
  value.writeUIntLE(height - 1, 27, 3);
  return value;
}

describe('readImageDimensions', () => {
  it('reads PNG dimensions from the IHDR header', () => {
    expect(readImageDimensions(png(1440, 900), 'image/png')).toEqual({ width: 1440, height: 900 });
  });

  it('reads JPEG, GIF, and WebP dimensions without decoding the image', () => {
    expect(readImageDimensions(jpeg(800, 600), 'image/jpeg')).toEqual({ width: 800, height: 600 });
    expect(readImageDimensions(Buffer.from('GIF89a\x20\x00\x10\x00', 'binary'), 'image/gif')).toEqual({ width: 32, height: 16 });
    expect(readImageDimensions(webp(1200, 675), 'image/webp')).toEqual({ width: 1200, height: 675 });
  });

  it('rejects truncated and unsupported image data', () => {
    expect(() => readImageDimensions(Buffer.from('GIF89a', 'ascii'), 'image/gif')).toThrow(/invalid image/i);
    expect(() => readImageDimensions(Buffer.from('<svg/>'), 'image/svg+xml')).toThrow(/unsupported/i);
  });
});
