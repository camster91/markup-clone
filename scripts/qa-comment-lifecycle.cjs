const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const ORIGIN = 'http://localhost:3030';
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const PIN_ID = 'aaaaaaaa-3333-4333-8333-333333333333';
const COMMENT_ID = 'aaaaaaaa-5555-4555-8555-555555555555';
const OUTPUT = path.resolve('artifacts/qa/comment-lifecycle');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function contextFor(browser, token, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.addCookies([
    { name: 'markup.session', value: token, url: ORIGIN, sameSite: 'Strict' },
    { name: 'markup.csrf', value: 'qa-csrf-token', url: ORIGIN, sameSite: 'Strict' },
  ]);
  const page = await context.newPage();
  await page.route(`${ORIGIN}/api/screenshots/aaaaaaaa-2222-4222-8222-222222222222/image**`, (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  }));
  return { context, page };
}

async function openThread(page) {
  await page.goto(`${ORIGIN}/projects/${PROJECT_ID}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Repository Policy QA' }).first().waitFor();
  await page.getByRole('button', { name: /Open feedback pin 1:/ }).click();
  await page.getByRole('dialog', { name: 'Feedback thread' }).waitFor();
}

async function run() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const requests = [];
  const errors = [];
  try {
    const mobile = await contextFor(browser, 'qa-owner-session-token', { width: 375, height: 812 });
    mobile.page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    mobile.page.on('response', (response) => { if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`); });
    await openThread(mobile.page);
    assert(await mobile.page.getByRole('button', { name: 'Edit comment' }).isVisible(), 'owner edit control is missing on mobile');
    assert(await mobile.page.getByRole('button', { name: 'Delete comment' }).isVisible(), 'owner delete control is missing on mobile');
    const mobileOverflow = await mobile.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(mobileOverflow <= 1, `mobile review thread overflows by ${mobileOverflow}px`);
    await mobile.page.getByRole('dialog', { name: 'Feedback thread' }).screenshot({ path: path.join(OUTPUT, 'owner-thread-375.png') });
    await mobile.context.close();

    const reviewer = await contextFor(browser, 'qa-reviewer-session-token', { width: 1280, height: 900 });
    await openThread(reviewer.page);
    assert(await reviewer.page.getByRole('button', { name: 'Edit comment' }).count() === 0, 'reviewer received an edit control');
    assert(await reviewer.page.getByRole('button', { name: 'Delete comment' }).count() === 0, 'reviewer received a delete control');
    await reviewer.context.close();

    const desktop = await contextFor(browser, 'qa-owner-session-token', { width: 1280, height: 900 });
    desktop.page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    desktop.page.on('response', (response) => { if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`); });
    desktop.page.on('request', (request) => {
      if (request.url() === `${ORIGIN}/api/pins/${PIN_ID}/comments/${COMMENT_ID}`) requests.push(request.method());
    });
    await openThread(desktop.page);
    await desktop.page.getByRole('button', { name: 'Edit comment' }).click();
    const editor = desktop.page.getByLabel('Edit comment by QA Client');
    await editor.fill('Align the pricing CTA with the card baseline.');
    await desktop.page.getByRole('button', { name: 'Save edit' }).click();
    await desktop.page.getByText('Align the pricing CTA with the card baseline.', { exact: true }).waitFor();
    await desktop.page.getByRole('dialog', { name: 'Feedback thread' }).screenshot({ path: path.join(OUTPUT, 'owner-edited-1280.png') });

    await desktop.page.getByRole('button', { name: 'Delete comment' }).click();
    await desktop.page.getByText('This cannot be undone.', { exact: false }).waitFor();
    await desktop.page.getByRole('button', { name: 'Confirm delete' }).click();
    await desktop.page.getByText('Align the pricing CTA with the card baseline.', { exact: true }).waitFor({ state: 'detached' });
    const desktopOverflow = await desktop.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(desktopOverflow <= 1, `desktop review thread overflows by ${desktopOverflow}px`);
    await desktop.page.getByRole('dialog', { name: 'Feedback thread' }).screenshot({ path: path.join(OUTPUT, 'owner-deleted-1280.png') });
    await desktop.context.close();

    assert(JSON.stringify(requests) === JSON.stringify(['PATCH', 'DELETE']), `expected PATCH then DELETE; got ${JSON.stringify(requests)}`);
    assert(errors.length === 0, errors.join('\n'));
    process.stdout.write(`${JSON.stringify({
      ownerMobileControls: true,
      reviewerControlsHidden: true,
      requests,
      desktopOverflow,
      mobileOverflow,
      consoleOrRequestErrors: errors.length,
      screenshots: OUTPUT,
    }, null, 2)}\n`);
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
