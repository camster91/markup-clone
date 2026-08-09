export type ImageDimensions = { width: number; height: number };

const MAX_DIMENSION = 65_535;

function invalidImage(): never {
  throw new Error('Invalid image data');
}

function dimensions(width: number, height: number): ImageDimensions {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
    invalidImage();
  }
  return { width, height };
}

function readPng(bytes: Buffer): ImageDimensions {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    invalidImage();
  }
  return dimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
}

function readGif(bytes: Buffer): ImageDimensions {
  if (bytes.length < 10 || !['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) invalidImage();
  return dimensions(bytes.readUInt16LE(6), bytes.readUInt16LE(8));
}

function readJpeg(bytes: Buffer): ImageDimensions {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) invalidImage();
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) invalidImage();
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) invalidImage();
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) invalidImage();
    const isStartOfFrame = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame) {
      if (length < 7) invalidImage();
      return dimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3));
    }
    offset += length;
  }
  invalidImage();
}

function readWebp(bytes: Buffer): ImageDimensions {
  if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') invalidImage();
  const chunk = bytes.toString('ascii', 12, 16);
  if (chunk !== 'VP8X' || bytes.readUInt32LE(16) < 10) invalidImage();
  return dimensions(bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1);
}

/** Read dimensions from bounded image headers without decoding pixels. */
export function readImageDimensions(bytes: Buffer, mimeType: string): ImageDimensions {
  if (mimeType === 'image/png') return readPng(bytes);
  if (mimeType === 'image/jpeg') return readJpeg(bytes);
  if (mimeType === 'image/gif') return readGif(bytes);
  if (mimeType === 'image/webp') return readWebp(bytes);
  throw new Error(`Unsupported image type: ${mimeType}`);
}
