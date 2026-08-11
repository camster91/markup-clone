import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { readImageDimensions } from './image-dimensions';

export const MAX_PDF_PAGES = 50;
const execFileAsync = promisify(execFile);

export function assertPdfHeader(bytes: Buffer): void {
  if (bytes.length < 5 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('invalid PDF data');
  }
}

export function parsePdfPageCount(pdfInfoOutput: string): number {
  const match = /^Pages:\s*(\d+)\s*$/mi.exec(pdfInfoOutput);
  const pages = match ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(pages) || pages < 1) throw new Error('invalid PDF page count');
  if (pages > MAX_PDF_PAGES) throw new Error('too many PDF pages');
  return pages;
}

/** Arguments for pdftoppm; always use spawn/execFile with no shell. */
export function pdfRenderCommand(inputPath: string, outputPrefix: string): string[] {
  return [
    '-png', '-r', '144', '-scale-to-x', '1920', '-scale-to-y', '1920',
    '-f', '1', '-l', String(MAX_PDF_PAGES), inputPath, outputPrefix,
  ];
}

export async function renderPdfPages(source: Buffer): Promise<Array<{ bytes: Buffer; width: number; height: number }>> {
  assertPdfHeader(source);
  const directory = await mkdtemp(path.join(tmpdir(), 'markup-pdf-'));
  const inputPath = path.join(directory, 'input.pdf');
  const outputPrefix = path.join(directory, 'page');
  try {
    await writeFile(inputPath, source, { flag: 'wx' });
    const info = await execFileAsync('pdfinfo', [inputPath], { timeout: 10_000, maxBuffer: 64 * 1024 });
    const pageCount = parsePdfPageCount(info.stdout);
    await execFileAsync('pdftoppm', pdfRenderCommand(inputPath, outputPrefix), { timeout: 30_000, maxBuffer: 64 * 1024 });
    const names = (await readdir(directory))
      .filter((name) => /^page-\d+\.png$/.test(name))
      .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
    if (names.length !== pageCount) throw new Error('PDF render produced an unexpected page count');
    return Promise.all(names.map(async (name) => {
      const bytes = await readFile(path.join(directory, name));
      const { width, height } = readImageDimensions(bytes, 'image/png');
      return { bytes, width, height };
    }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
