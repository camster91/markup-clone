/*
 * Disposable local owner/share journey for first-class PDF reviews.
 * Refuses non-loopback targets and verifies product deletion removes the
 * source PDF, rendered PNGs, database rows, and private work directories.
 */
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');

const PROJECT_ID = '99000000-0000-4000-8000-000000000001';
const USER_ID = '99000000-0000-4000-8000-000000000002';
const EMAIL = 'pdf-qa-owner@local.test';
const SESSION_TOKEN = 'local-pdf-qa-session-token-not-for-production';
const CSRF_TOKEN = 'local-pdf-qa-csrf-token-not-for-production';
const SHARE_TOKEN = 'local_pdf_review_share_token_12345678901234';

function runContainer(action, expectedKeys = []) {
  return execFileSync('docker', [
    'compose', 'exec', '-T',
    '-e', 'QA_PDF_IN_CONTAINER=1',
    '-e', `QA_PDF_EXPECTED_KEYS=${JSON.stringify(expectedKeys)}`,
    'app', 'node', '/opt/app-scripts/qa-pdf-review-upload.cjs', action,
  ], { cwd: __dirname + '/..', encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

async function containerFixture(action) {
  const requireFromApp = createRequire('/app/server.js');
  const { PrismaClient } = requireFromApp('@prisma/client');
  const { access, readdir, unlink } = require('node:fs/promises');
  const path = require('node:path');
  const prisma = new PrismaClient();
  try {
    if (action === 'seed') {
      await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
      await prisma.session.deleteMany({ where: { token: SESSION_TOKEN } });
      await prisma.user.upsert({
        where: { id: USER_ID },
        update: { email: EMAIL, role: 'operator' },
        create: { id: USER_ID, email: EMAIL, passwordHash: 'not-used-by-fixture', role: 'operator' },
      });
      await prisma.session.create({
        data: { userId: USER_ID, token: SESSION_TOKEN, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
      });
      await prisma.project.create({
        data: {
          id: PROJECT_ID,
          name: 'Disposable PDF review',
          domain: 'pdf-qa.localhost',
          apiKey: 'local-pdf-review-api-key',
          shareToken: SHARE_TOKEN,
        },
      });
      process.stdout.write(JSON.stringify({ projectId: PROJECT_ID, shareToken: SHARE_TOKEN }));
      return;
    }
    if (action === 'inspect') {
      const [assets, screenshots, pageCount, pinCount, entries] = await Promise.all([
        prisma.reviewAsset.findMany({ where: { projectId: PROJECT_ID }, select: { storageKey: true, pageCount: true } }),
        prisma.screenshot.findMany({ where: { page: { projectId: PROJECT_ID } }, select: { storageKey: true } }),
        prisma.page.count({ where: { projectId: PROJECT_ID } }),
        prisma.pin.count({ where: { screenshot: { page: { projectId: PROJECT_ID } } } }),
        readdir('/data/screenshots'),
      ]);
      const workDirectories = entries.filter((entry) => entry.startsWith('.pdf-'));
      process.stdout.write(JSON.stringify({ assets, screenshots, pageCount, pinCount, workDirectories }));
      return;
    }
    if (action === 'verify') {
      const expectedKeys = JSON.parse(process.env.QA_PDF_EXPECTED_KEYS || '[]');
      const [projects, assets, pages, screenshots, pins, entries] = await Promise.all([
        prisma.project.count({ where: { id: PROJECT_ID } }),
        prisma.reviewAsset.count({ where: { projectId: PROJECT_ID } }),
        prisma.page.count({ where: { projectId: PROJECT_ID } }),
        prisma.screenshot.count({ where: { page: { projectId: PROJECT_ID } } }),
        prisma.pin.count({ where: { screenshot: { page: { projectId: PROJECT_ID } } } }),
        readdir('/data/screenshots'),
      ]);
      for (const key of expectedKeys) {
        if (path.basename(key) !== key) throw new Error(`Unsafe expected key: ${key}`);
        await access(path.join('/data/screenshots', key))
          .then(() => { throw new Error(`File survived project deletion: ${key}`); })
          .catch((error) => { if (error.code !== 'ENOENT') throw error; });
      }
      if (entries.some((entry) => entry.startsWith('.pdf-'))) throw new Error('PDF work directory survived cleanup');
      if (projects || assets || pages || screenshots || pins) {
        throw new Error(`Database cleanup failed: ${JSON.stringify({ projects, assets, pages, screenshots, pins })}`);
      }
      await prisma.session.deleteMany({ where: { token: SESSION_TOKEN } });
      await prisma.user.deleteMany({ where: { id: USER_ID } });
      process.stdout.write(JSON.stringify({ projects, assets, pages, screenshots, pins, removedFiles: expectedKeys.length }));
      return;
    }
    if (action === 'cleanup') {
      const [assets, screenshots] = await Promise.all([
        prisma.reviewAsset.findMany({ where: { projectId: PROJECT_ID }, select: { storageKey: true } }),
        prisma.screenshot.findMany({ where: { page: { projectId: PROJECT_ID } }, select: { storageKey: true } }),
      ]);
      for (const { storageKey } of [...assets, ...screenshots]) {
        if (path.basename(storageKey) !== storageKey) throw new Error(`Unsafe storage key: ${storageKey}`);
        await unlink(path.join('/data/screenshots', storageKey)).catch((error) => { if (error.code !== 'ENOENT') throw error; });
      }
      await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
      await prisma.session.deleteMany({ where: { token: SESSION_TOKEN } });
      await prisma.user.deleteMany({ where: { id: USER_ID } });
      process.stdout.write(JSON.stringify({ cleaned: true }));
      return;
    }
    throw new Error('Expected seed, inspect, verify, or cleanup');
  } finally {
    await prisma.$disconnect();
  }
}

function buildPdf(pageCount = 2) {
  const pageObjectNumbers = [];
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', ''];
  for (let page = 0; page < pageCount; page += 1) {
    const pageObject = objects.length + 1;
    const contentObject = pageObject + 1;
    pageObjectNumbers.push(pageObject);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObject} 0 R >>`);
    objects.push('<< /Length 0 >>\nstream\n\nendstream');
  }
  objects[1] = `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(' ')}] /Count ${pageCount} >>`;
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
  chunks.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  offsets.slice(1).forEach((offset) => chunks.push(`${String(offset).padStart(10, '0')} 00000 n \n`));
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return Buffer.from(chunks.join(''), 'ascii');
}

async function browserJourney() {
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:3030';
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(baseUrl)) throw new Error('QA_BASE_URL must be loopback HTTP');
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const attachDiagnostics = (page, label) => {
    page.on('console', (message) => { if (message.type() === 'error') errors.push(`${label}: ${message.text()}`); });
    page.on('requestfailed', (request) => {
      const failure = request.failure()?.errorText || '';
      if (!(failure === 'net::ERR_ABORTED' && request.url().includes('_rsc='))) errors.push(`${label}: ${request.url()} ${failure}`);
    });
  };
  try {
    for (const [index, viewport] of [{ width: 1280, height: 900 }, { width: 375, height: 812 }].entries()) {
      const context = await browser.newContext({ viewport });
      await context.addCookies([
        { name: 'markup.session', value: SESSION_TOKEN, domain: 'localhost', path: '/', httpOnly: true },
        { name: 'markup.csrf', value: CSRF_TOKEN, domain: 'localhost', path: '/' },
      ]);
      const page = await context.newPage();
      attachDiagnostics(page, `owner-${viewport.width}`);
      await page.goto(`${baseUrl}/projects/${PROJECT_ID}`, { waitUntil: 'networkidle' });
      if (index === 0) {
        await page.getByLabel('Upload image or PDF for review').setInputFiles({
          name: 'private-client-name.pdf',
          mimeType: 'application/pdf',
          buffer: buildPdf(),
        });
        const uploadResponsePromise = page.waitForResponse((response) => response.url().endsWith(`/api/projects/${PROJECT_ID}/documents`));
        await page.getByRole('button', { name: 'Upload for review', exact: true }).click();
        const uploadResponse = await uploadResponsePromise;
        if (!uploadResponse.ok()) {
          throw new Error(`PDF upload failed (${uploadResponse.status()}): ${await uploadResponse.text()}`);
        }
        await page.getByText('PDF page 1 of 2', { exact: true }).waitFor({ timeout: 30_000 });
        await page.getByText('PDF page 2 of 2', { exact: true }).waitFor({ timeout: 30_000 });
        const firstPage = page.locator('img[alt*="/documents/"]').first();
        await firstPage.waitFor({ timeout: 15_000 });
        await firstPage.click({ position: { x: 180, y: 180 } });
        await page.getByLabel('Feedback for this pin').fill('Please revise this PDF heading');
        await page.getByLabel('Name for this pin').fill('QA reviewer');
        await page.getByRole('button', { name: 'Add pin', exact: true }).click();
        await page.getByRole('button', { name: /Open feedback pin 1: Please revise this PDF heading/ }).waitFor({ timeout: 15_000 });
      } else {
        await page.getByText('PDF page 1 of 2', { exact: true }).waitFor({ timeout: 15_000 });
        await page.getByRole('button', { name: /Open feedback pin 1: Please revise this PDF heading/ }).waitFor({ timeout: 15_000 });
      }
      if (!await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)) {
        throw new Error(`Horizontal overflow for owner at ${viewport.width}px`);
      }
      await context.close();
    }

    const shareContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const sharePage = await shareContext.newPage();
    attachDiagnostics(sharePage, 'managed-share-375');
    await sharePage.goto(`${baseUrl}/share/${SHARE_TOKEN}/open`, { waitUntil: 'networkidle' });
    await sharePage.getByText('Read-only view', { exact: false }).waitFor({ timeout: 15_000 });
    await sharePage.getByText('PDF page 1 of 2', { exact: true }).waitFor({ timeout: 15_000 });
    await sharePage.getByRole('button', { name: /Open feedback pin 1: Please revise this PDF heading/ }).waitFor({ timeout: 15_000 });
    if (!await sharePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)) {
      throw new Error('Horizontal overflow for managed share at 375px');
    }
    await shareContext.close();
    if (errors.length) throw new Error(`Browser errors: ${errors.join('\n')}`);

    const inspection = JSON.parse(runContainer('inspect'));
    if (inspection.assets.length !== 1 || inspection.assets[0].pageCount !== 2 || inspection.pageCount !== 2 || inspection.pinCount !== 1) {
      throw new Error(`Unexpected persisted PDF review: ${JSON.stringify(inspection)}`);
    }
    if (inspection.workDirectories.length) throw new Error(`Private work directories remain: ${inspection.workDirectories.join(', ')}`);
    const expectedKeys = [...inspection.assets, ...inspection.screenshots].map(({ storageKey }) => storageKey);

    const deleteContext = await browser.newContext();
    await deleteContext.addCookies([
      { name: 'markup.session', value: SESSION_TOKEN, domain: 'localhost', path: '/', httpOnly: true },
      { name: 'markup.csrf', value: CSRF_TOKEN, domain: 'localhost', path: '/' },
    ]);
    const deletePage = await deleteContext.newPage();
    await deletePage.goto(`${baseUrl}/projects/${PROJECT_ID}`, { waitUntil: 'domcontentloaded' });
    const deletion = await deletePage.evaluate(async ({ projectId, csrfToken }) => {
      const response = await fetch(`/api/projects/${projectId}`, { method: 'DELETE', headers: { 'X-CSRF-Token': csrfToken } });
      return { status: response.status, body: await response.json() };
    }, { projectId: PROJECT_ID, csrfToken: CSRF_TOKEN });
    await deleteContext.close();
    if (deletion.status !== 200 || deletion.body.filesRemoved !== expectedKeys.length) {
      throw new Error(`Product deletion failed: ${JSON.stringify(deletion)}`);
    }
    runContainer('verify', expectedKeys);
  } finally {
    await browser.close();
  }
}

if (process.env.QA_PDF_IN_CONTAINER === '1') {
  containerFixture(process.argv[2]).catch((error) => { console.error(error); process.exitCode = 1; });
} else {
  (async () => {
    runContainer('cleanup');
    runContainer('seed');
    try { await browserJourney(); }
    finally { runContainer('cleanup'); }
    process.stdout.write('PDF review owner/share/pin/cleanup browser QA passed.\n');
  })().catch((error) => { console.error(error); process.exitCode = 1; });
}
