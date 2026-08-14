/* Disposable local browser journey for first-class PDF reviews. */
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');

const PROJECT_ID = '97000000-0000-4000-8000-000000000001';
const USER_ID = '97000000-0000-4000-8000-000000000002';
const SESSION_TOKEN = 'local-pdf-qa-session-token-not-for-production';
const CSRF_TOKEN = 'local-pdf-qa-csrf-token-not-for-production';
const SHARE_TOKEN = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function runContainer(action) {
  return execFileSync('docker', ['compose', 'exec', '-T', '-e', 'QA_PDF_IN_CONTAINER=1', 'app', 'node', '/opt/app-scripts/qa-pdf-review-upload.cjs', action], { cwd: __dirname + '/..', encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

async function fixture(action) {
  const { PrismaClient } = createRequire('/app/server.js')('@prisma/client');
  const { unlink } = require('node:fs/promises'); const path = require('node:path'); const prisma = new PrismaClient();
  try {
    if (action === 'seed') {
      await prisma.project.deleteMany({ where: { id: PROJECT_ID } }); await prisma.session.deleteMany({ where: { token: SESSION_TOKEN } });
      await prisma.user.upsert({ where: { id: USER_ID }, update: { email: 'pdf-qa-owner@local.test', role: 'operator' }, create: { id: USER_ID, email: 'pdf-qa-owner@local.test', passwordHash: 'not-used-by-fixture', role: 'operator' } });
      await prisma.session.create({ data: { userId: USER_ID, token: SESSION_TOKEN, expiresAt: new Date(Date.now() + 3600000) } });
      await prisma.project.create({ data: { id: PROJECT_ID, name: 'Disposable PDF review', domain: 'pdf-qa.localhost', apiKey: 'local-pdf-review-api-key', shareToken: SHARE_TOKEN } }); return;
    }
    if (action !== 'cleanup') throw new Error('Expected seed or cleanup');
    const [documents, screenshots] = await Promise.all([prisma.reviewDocument.findMany({ where: { projectId: PROJECT_ID }, select: { storageKey: true } }), prisma.screenshot.findMany({ where: { page: { projectId: PROJECT_ID } }, select: { storageKey: true } })]);
    for (const { storageKey } of [...documents, ...screenshots]) { if (path.basename(storageKey) !== storageKey) throw new Error(`Unsafe storage key: ${storageKey}`); await unlink(path.join('/data/screenshots', storageKey)).catch((error) => { if (error.code !== 'ENOENT') throw error; }); }
    await prisma.project.deleteMany({ where: { id: PROJECT_ID } }); await prisma.session.deleteMany({ where: { token: SESSION_TOKEN } });
    const [projects, remainingDocuments, remainingScreenshots] = await Promise.all([prisma.project.count({ where: { id: PROJECT_ID } }), prisma.reviewDocument.count({ where: { projectId: PROJECT_ID } }), prisma.screenshot.count({ where: { page: { projectId: PROJECT_ID } } })]);
    if (projects || remainingDocuments || remainingScreenshots) throw new Error(`Fixture cleanup failed: projects=${projects}, documents=${remainingDocuments}, screenshots=${remainingScreenshots}`);
  } finally { await prisma.$disconnect(); }
}

function minimalPdf() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 4 0 R >>', '<< /Length 0 >>\nstream\n\nendstream']; let output = '%PDF-1.4\n'; const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(output); output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`; return Buffer.from(output, 'ascii');
}

async function browserJourney() {
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:3030'; if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(baseUrl)) throw new Error('QA_BASE_URL must be loopback HTTP');
  const { chromium } = require('playwright'); const browser = await chromium.launch({ headless: true }); const errors = [];
  try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
      const context = await browser.newContext({ viewport }); await context.addCookies([{ name: 'markup.session', value: SESSION_TOKEN, domain: 'localhost', path: '/', httpOnly: true }, { name: 'markup.csrf', value: CSRF_TOKEN, domain: 'localhost', path: '/' }]); const page = await context.newPage();
      page.on('console', (message) => { if (message.type() === 'error') errors.push(`${viewport.width}: ${message.text()}`); }); page.on('requestfailed', (request) => { const failure = request.failure()?.errorText ?? ''; if (!(failure === 'net::ERR_ABORTED' && request.url().includes('_rsc='))) errors.push(`${viewport.width}: ${request.url()} ${failure}`); });
      await page.goto(`${baseUrl}/projects/${PROJECT_ID}`, { waitUntil: 'networkidle' }); await page.getByLabel('Upload file for review').setInputFiles({ name: 'review.pdf', mimeType: 'application/pdf', buffer: minimalPdf() }); await page.getByRole('button', { name: 'Upload for review', exact: true }).click(); await page.getByText('/documents/', { exact: false }).waitFor({ timeout: 15000 }); await page.locator('img[src*="/api/screenshots/"]').first().waitFor({ timeout: 15000 });
      if (!await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)) throw new Error(`Horizontal overflow at ${viewport.width}px`); await context.close();
    }
    const client = await browser.newContext({ viewport: { width: 375, height: 812 } }); const page = await client.newPage(); await page.goto(`${baseUrl}/share/${SHARE_TOKEN}/open`, { waitUntil: 'networkidle' }); await page.getByText('Read-only view').waitFor({ timeout: 15000 }); await page.locator('img[src*="/api/screenshots/"]').first().waitFor({ timeout: 15000 }); if (!await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)) throw new Error('Horizontal overflow for client at 375px'); await client.close(); if (errors.length) throw new Error(`Browser errors: ${errors.join('\n')}`);
  } finally { await browser.close(); }
}

if (process.env.QA_PDF_IN_CONTAINER === '1') fixture(process.argv[2]).catch((error) => { console.error(error); process.exitCode = 1; });
else (async () => { runContainer('cleanup'); runContainer('seed'); try { await browserJourney(); } finally { runContainer('cleanup'); } process.stdout.write('PDF review owner/share browser QA passed.\n'); })().catch((error) => { console.error(error); process.exitCode = 1; });
