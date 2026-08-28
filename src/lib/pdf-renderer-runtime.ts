import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { readImageDimensions } from './image-dimensions';
import { parsePdfPageCount, pdfRenderCommand } from './pdf-renderer';

const execFileAsync = promisify(execFile);
const PDF_INFO_TIMEOUT_MS = 10_000;
const PDF_RENDER_TIMEOUT_MS = 30_000;
const MAX_RENDERED_BYTES = 250 * 1024 * 1024;

export type RenderedPdfPage = {
  pageNumber: number;
  path: string;
  width: number;
  height: number;
  byteCount: number;
};

export class PdfRenderError extends Error {
  constructor(
    message: string,
    readonly kind: 'invalid' | 'too-many-pages' | 'timeout' | 'output-limit' | 'renderer',
  ) {
    super(message);
    this.name = 'PdfRenderError';
  }
}

function timedOut(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object'
    && ('killed' in error || 'signal' in error)
    && (error as { killed?: boolean; signal?: string }).killed !== false,
  );
}

/**
 * Render one local PDF using argument-only Poppler processes. Poppler receives
 * only local paths, no shell, no URLs, and a deliberately minimal environment;
 * the caller owns and removes the private working directory.
 */
export async function renderPdf(inputPath: string, outputDir: string): Promise<RenderedPdfPage[]> {
  const processEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    TMPDIR: outputDir,
    NODE_ENV: 'production',
  };
  let infoOutput: string;
  try {
    const result = await execFileAsync('pdfinfo', [inputPath], {
      encoding: 'utf8',
      timeout: PDF_INFO_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
      env: processEnv,
      windowsHide: true,
    });
    infoOutput = result.stdout;
  } catch (error) {
    if (timedOut(error)) throw new PdfRenderError('PDF inspection timed out', 'timeout');
    throw new PdfRenderError('PDF could not be inspected', 'invalid');
  }

  let pageCount: number;
  try {
    pageCount = parsePdfPageCount(infoOutput);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    throw new PdfRenderError(
      message === 'too many PDF pages' ? 'PDF has more than 50 pages' : 'PDF page count is invalid',
      message === 'too many PDF pages' ? 'too-many-pages' : 'invalid',
    );
  }

  const outputPrefix = path.join(outputDir, 'page');
  try {
    await execFileAsync('pdftoppm', pdfRenderCommand(inputPath, outputPrefix), {
      encoding: 'utf8',
      timeout: PDF_RENDER_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      env: processEnv,
      windowsHide: true,
    });
  } catch (error) {
    if (timedOut(error)) throw new PdfRenderError('PDF rendering timed out', 'timeout');
    throw new PdfRenderError('PDF rendering failed', 'renderer');
  }

  const names = (await readdir(outputDir))
    .map((name) => ({ name, match: /^page-(\d+)\.png$/.exec(name) }))
    .filter((entry): entry is { name: string; match: RegExpExecArray } => Boolean(entry.match))
    .sort((a, b) => Number(a.match[1]) - Number(b.match[1]));
  if (names.length !== pageCount) throw new PdfRenderError('PDF page output was incomplete', 'renderer');

  let renderedBytes = 0;
  const pages: RenderedPdfPage[] = [];
  for (let index = 0; index < names.length; index += 1) {
    const expectedPageNumber = index + 1;
    const pageNumber = Number(names[index].match[1]);
    if (pageNumber !== expectedPageNumber) throw new PdfRenderError('PDF page output was out of order', 'renderer');
    const pagePath = path.join(outputDir, names[index].name);
    const pageStat = await stat(pagePath);
    renderedBytes += pageStat.size;
    if (renderedBytes > MAX_RENDERED_BYTES) throw new PdfRenderError('Rendered PDF exceeds output limit', 'output-limit');
    const dimensions = readImageDimensions(await readFile(pagePath), 'image/png');
    if (dimensions.width > 1920 || dimensions.height > 1920) {
      throw new PdfRenderError('Rendered PDF page exceeds pixel limit', 'output-limit');
    }
    pages.push({ pageNumber, path: pagePath, ...dimensions, byteCount: pageStat.size });
  }
  return pages;
}
