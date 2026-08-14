/*
 * Disposable local browser journey for first-class image reviews.
 *
 * Host: `node scripts/qa-image-review-upload.cjs`
 * Container helper: invoked by this script through docker compose exec.
 * It refuses non-local targets and deletes all fixture records/files on exit.
 */
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');

const PROJECT_ID = '98000000-0000-4000-8000-000000000001';
const USER_ID = '98000000-0000-4000-8000-000000000002';
const EMAIL = 'image-qa-owner@local.test';
const SESSION_TOKEN = 'local-image-qa-session-token-not-for-production';
const CSRF_TOKEN = 'local-image-qa-csrf-token-not-for-production';
// The opener route accepts production-format, 43-character base64url tokens.
const SHARE_TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function runContainer(action) {
  return execFileSync('docker', ['compose', 'exec', '-T', '-e', 'QA_IMAGE_IN_CONTAINER=1', 'app', 'node', '/opt/app-scripts/qa-image-review-upload.cjs', action], {
    cwd: __dirname + '/..', encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
  });
}

async function containerFixture(action) {
  const requireFromApp = createRequire('/app/server.js');
  const { PrismaClient } = requireFromApp('@prisma/client');
  const { unlink } = require('node:fs/promises');
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
        data: { id: PROJECT_ID, name: 'Disposable image review', domain: 'image-qa.localhost', apiKey: 'local-image-review-api-key', shareToken: SHARE_TOKEN },
      });
      process.stdout.write(JSON.stringify({ projectId: PROJECT_ID, shareToken: SHARE_TOKEN }));
      return;
    }
    if (action !== 'cleanup') throw new Error('Expected seed or cleanup');
    const screenshots = await prisma.screenshot.findMany({ where: { page: { projectId: PROJECT_ID } }, select: { storageKey: true } });
    for (const { storageKey } of screenshots) {
      if (path.basename(storageKey) !== storageKey) throw new Error(`Unsafe storage key: ${storageKey}`);
      await unlink(path.join('/data/screenshots', storageKey)).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    }
    await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
    await prisma.session.deleteMany({ where: { token: SESSION_TOKEN } });
    const [projects, remaining] = await Promise.all([
      prisma.project.count({ where: { id: PROJECT_ID } }),
      prisma.screenshot.count({ where: { page: { projectId: PROJECT_ID } } }),
    ]);
    if (projects || remaining) throw new Error(`Fixture cleanup failed: projects=${projects}, screenshots=${remaining}`);
    process.stdout.write(JSON.stringify({ projects, screenshots: remaining, removedFiles: screenshots.length }));
  } finally {
    await prisma.$disconnect();
  }
}

function png() {
  const bytes = Buffer.alloc(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  bytes.writeUInt32BE(640, 16); bytes.writeUInt32BE(480, 20);
  return bytes;
}

async function browserJourney() {
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:3030';
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(baseUrl)) throw new Error('QA_BASE_URL must be loopback HTTP');
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
      const context = await browser.newContext({ viewport });
      await context.addCookies([
        { name: 'markup.session', value: SESSION_TOKEN, domain: 'localhost', path: '/', httpOnly: true },
        { name: 'markup.csrf', value: CSRF_TOKEN, domain: 'localhost', path: '/' },
      ]);
      const page = await context.newPage();
      page.on('console', (message) => { if (message.type() === 'error') errors.push(`${viewport.width}: ${message.text()}`); });
      page.on('requestfailed', (request) => {
        const failure = request.failure()?.errorText ?? '';
        if (!(failure === 'net::ERR_ABORTED' && request.url().includes('_rsc='))) errors.push(`${viewport.width}: ${request.url()} ${failure}`);
      });
      await page.goto(`${baseUrl}/projects/${PROJECT_ID}`, { waitUntil: 'networkidle' });
      await page.getByLabel('Upload file for review').setInputFiles({ name: 'review.png', mimeType: 'image/png', buffer: png() });
      await page.getByRole('button', { name: 'Upload for review', exact: true }).click();
      await page.getByText('/uploads/', { exact: false }).waitFor({ timeout: 15_000 });
      const screenshot = page.locator('img[src*="/api/screenshots/"]').first();
      await screenshot.waitFor({ timeout: 15_000 });
      if (!await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)) throw new Error(`Horizontal overflow at ${viewport.width}px`);
      await context.close();
    }
    const client = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const clientPage = await client.newPage();
    clientPage.on('console', (message) => { if (message.type() === 'error') errors.push(`client: ${message.text()}`); });
    clientPage.on('requestfailed', (request) => {
      const failure = request.failure()?.errorText ?? '';
      if (!(failure === 'net::ERR_ABORTED' && request.url().includes('_rsc='))) errors.push(`client: ${request.url()} ${failure}`);
    });
    await clientPage.goto(`${baseUrl}/share/${SHARE_TOKEN}/open`, { waitUntil: 'networkidle' });
    await clientPage.getByText('Read-only view').waitFor({ timeout: 15_000 });
    await clientPage.locator('img[src*="/api/screenshots/"]').first().waitFor({ timeout: 15_000 });
    if (!await clientPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)) throw new Error('Horizontal overflow for client at 375px');
    await client.close();
    if (errors.length) throw new Error(`Browser errors: ${errors.join('\n')}`);
  } finally { await browser.close(); }
}

if (process.env.QA_IMAGE_IN_CONTAINER === '1') {
  containerFixture(process.argv[2]).catch((error) => { console.error(error); process.exitCode = 1; });
} else {
  (async () => {
    runContainer('cleanup');
    runContainer('seed');
    try { await browserJourney(); }
    finally { runContainer('cleanup'); }
    process.stdout.write('Image review owner/share browser QA passed.\n');
  })().catch((error) => { console.error(error); process.exitCode = 1; });
}
