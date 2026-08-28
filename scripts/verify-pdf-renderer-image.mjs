import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MAX_PDF_PAGES = 50;
const MAX_RENDERED_AXIS = 1920;
const RENDER_TIMEOUT_MS = 10_000;

function buildSinglePagePdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  const chunks = ['%PDF-1.4\n'];
  const offsets = [0];
  let byteLength = Buffer.byteLength(chunks[0], 'ascii');

  objects.forEach((object, index) => {
    offsets.push(byteLength);
    const chunk = `${index + 1} 0 obj\n${object}\nendobj\n`;
    chunks.push(chunk);
    byteLength += Buffer.byteLength(chunk, 'ascii');
  });

  const xrefOffset = byteLength;
  chunks.push(`xref\n0 ${objects.length + 1}\n`);
  chunks.push('0000000000 65535 f \n');
  offsets.slice(1).forEach((offset) => {
    chunks.push(`${String(offset).padStart(10, '0')} 00000 n \n`);
  });
  chunks.push(
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
      `startxref\n${xrefOffset}\n%%EOF\n`,
  );
  return Buffer.from(chunks.join(''), 'ascii');
}

function parsePngDimensions(path) {
  const header = readFileSync(path).subarray(0, 24);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (header.length < 24 || !header.subarray(0, 8).equals(signature)) {
    throw new Error('Poppler did not produce a PNG');
  }
  return {
    width: header.readUInt32BE(16),
    height: header.readUInt32BE(20),
  };
}

function assertTimeout(tempRoot) {
  const fifoPath = join(tempRoot, 'blocked-input.pdf');
  execFileSync('mkfifo', [fifoPath]);
  const result = spawnSync('pdftoppm', [fifoPath, join(tempRoot, 'blocked')], {
    timeout: 100,
    encoding: 'utf8',
  });
  if (result.error?.code !== 'ETIMEDOUT') {
    throw new Error('Poppler timeout contract was not exercised');
  }
}

const tempRoot = mkdtempSync(join(tmpdir(), 'markup-pdf-renderer-'));
let summary;

try {
  const inputPath = join(tempRoot, 'input.pdf');
  const outputPrefix = join(tempRoot, 'page');
  writeFileSync(inputPath, buildSinglePagePdf(), { mode: 0o600 });

  const info = execFileSync('pdfinfo', [inputPath], {
    encoding: 'utf8',
    timeout: RENDER_TIMEOUT_MS,
  });
  const pageMatch = /^Pages:\s*(\d+)\s*$/mi.exec(info);
  const pageCount = pageMatch ? Number(pageMatch[1]) : NaN;
  if (!Number.isSafeInteger(pageCount) || pageCount !== 1 || pageCount > MAX_PDF_PAGES) {
    throw new Error(`Unexpected bounded page count: ${pageCount}`);
  }

  const render = spawnSync(
    'pdftoppm',
    [
      '-png',
      '-r',
      '144',
      '-scale-to',
      String(MAX_RENDERED_AXIS),
      '-f',
      '1',
      '-l',
      String(MAX_PDF_PAGES),
      inputPath,
      outputPrefix,
    ],
    { encoding: 'utf8', timeout: RENDER_TIMEOUT_MS },
  );
  if (render.error || render.status !== 0) {
    throw render.error ?? new Error(render.stderr || 'Poppler render failed');
  }

  const rendered = readdirSync(tempRoot).filter((name) => /^page-\d+\.png$/.test(name));
  if (rendered.length !== 1) {
    throw new Error(`Expected one rendered page, found ${rendered.length}`);
  }
  const dimensions = parsePngDimensions(join(tempRoot, rendered[0]));
  if (
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    dimensions.width > MAX_RENDERED_AXIS ||
    dimensions.height > MAX_RENDERED_AXIS
  ) {
    throw new Error(`Rendered dimensions exceed bounds: ${dimensions.width}x${dimensions.height}`);
  }
  if (dimensions.width === dimensions.height) {
    throw new Error('Renderer distorted the non-square PDF page into a square image');
  }

  assertTimeout(tempRoot);
  summary = { pageCount, ...dimensions, timeoutMs: RENDER_TIMEOUT_MS };
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (existsSync(tempRoot)) {
  throw new Error('PDF renderer verification did not clean up its temporary directory');
}

console.log(`PDF renderer image contract passed: ${JSON.stringify(summary)}`);
