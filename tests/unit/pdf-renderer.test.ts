import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
      '-png', '-r', '144', '-scale-to', '1920',
      '-f', '1', '-l', '50', '/tmp/input.pdf', '/tmp/page',
    ]);
  });

  it('makes the production image prove the renderer contract without network access', () => {
    const dockerfile = readFileSync(resolve(process.cwd(), 'Dockerfile'), 'utf8');
    const verifier = readFileSync(
      resolve(process.cwd(), 'scripts/verify-pdf-renderer-image.mjs'),
      'utf8',
    );

    expect(dockerfile).toContain(
      'COPY scripts/verify-pdf-renderer-image.mjs /usr/local/bin/verify-pdf-renderer-image.mjs',
    );
    expect(dockerfile).toContain(
      'RUN --network=none node /usr/local/bin/verify-pdf-renderer-image.mjs',
    );
    expect(verifier).toContain("spawnSync('pdftoppm'");
    expect(verifier).toContain('timeout: RENDER_TIMEOUT_MS');
    expect(verifier).toContain('MAX_RENDERED_AXIS = 1920');
    expect(verifier).toContain("mkdtempSync(join(tmpdir(), 'markup-pdf-renderer-'))");
    expect(verifier).toContain('rmSync(tempRoot, { recursive: true, force: true })');
  });
});
