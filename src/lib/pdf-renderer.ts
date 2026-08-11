export const MAX_PDF_PAGES = 50;

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
