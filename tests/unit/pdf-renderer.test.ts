import { describe, expect, it } from 'vitest';
import { assertPdfHeader, parsePdfPageCount, pdfRenderCommand } from '@/lib/pdf-renderer';

describe('PDF renderer contract', () => {
  it('accepts only a real PDF header', () => {
    expect(() => assertPdfHeader(Buffer.from('%PDF-1.7\n'))).not.toThrow();
    expect(() => assertPdfHeader(Buffer.from('<svg/>'))).toThrow('invalid PDF data');
  });

  it('bounds the parsed PDF page count', () => {
    expect(parsePdfPageCount('Title: fixture\nPages: 3\n')).toBe(3);
    expect(() => parsePdfPageCount('Pages: 0\n')).toThrow('invalid PDF page count');
    expect(() => parsePdfPageCount('Pages: 51\n')).toThrow('too many PDF pages');
  });

  it('uses an argument-only Poppler command with fixed page and pixel limits', () => {
    expect(pdfRenderCommand('/tmp/input.pdf', '/tmp/page')).toEqual([
      '-png', '-r', '144', '-scale-to-x', '1920', '-scale-to-y', '1920',
      '-f', '1', '-l', '50', '/tmp/input.pdf', '/tmp/page',
    ]);
  });
});
