const { chromium } = require('playwright');
const path = require('node:path');

const ORIGIN = 'http://localhost:3030';
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const OUTPUT = 'C:/Users/camst/.codex/visualizations/2026/08/07/019fde68-2efb-7830-9664-b3f96595c2a2';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function session(browser, token, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.addCookies([
    { name: 'markup.session', value: token, url: ORIGIN, sameSite: 'Lax' },
    { name: 'markup.csrf', value: 'qa-csrf-token', url: ORIGIN, sameSite: 'Lax' },
  ]);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
  return context;
}

async function capture(page, name) {
  await page.screenshot({ path: path.join(OUTPUT, name), fullPage: false });
}

async function assertNoOverflow(page, label) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  assert(overflow <= 1, `${label} page overflows by ${overflow}px`);
  return overflow;
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const failedRequests = [];
  const recordFailedRequest = (label, request) => {
    const reason = request.failure()?.errorText ?? 'unknown';
    if (reason === 'net::ERR_ABORTED') return;
    failedRequests.push(`${label}: ${request.url()} ${reason}`);
  };

  try {
    const owner = await session(browser, 'qa-owner-session-token', { width: 1280, height: 1000 });
    const ownerPage = await owner.newPage();
    ownerPage.on('console', (message) => {
      if (message.type() === 'error') errors.push(`owner console: ${message.text()}`);
    });
    ownerPage.on('requestfailed', (request) => recordFailedRequest('owner request', request));
    await ownerPage.goto(`${ORIGIN}/projects/${PROJECT_ID}`, { waitUntil: 'domcontentloaded' });
    await ownerPage.getByRole('heading', { name: 'Delivery QA' }).first().waitFor();
    await ownerPage.getByText('Outbound integrations').waitFor();

    await ownerPage.getByRole('button', { name: 'Show activity' }).click();
    await ownerPage.getByRole('button', { name: 'Retry' }).waitFor();
    await ownerPage.getByText('Stored integration kind is invalid').last().waitFor();
    await capture(ownerPage, 'integration-delivery-owner-activity-1280.png');

    await ownerPage.getByTestId('integration-kind').selectOption('webhook');
    await ownerPage.getByLabel('Integration URL').fill('https://example.com/qa-webhook');
    await ownerPage.getByLabel('Optional webhook headers as JSON').fill('{"X-QA":"local-only"}');
    await ownerPage.getByRole('button', { name: 'Add integration' }).click();
    await ownerPage.getByText('Copy this signing secret now').waitFor();
    const signingSecret = await ownerPage.locator('[role="status"] code').textContent();
    assert(Boolean(signingSecret) && signingSecret.trim().length === 43, 'one-time signing secret is malformed');
    assert((await ownerPage.getByText('It will not be shown again.').count()) === 1, 'one-time warning is missing');
    await capture(ownerPage, 'integration-delivery-owner-secret-1280.png');

    await ownerPage.getByRole('button', { name: 'Retry' }).click();
    await ownerPage.getByText('Pending').waitFor();
    assert((await ownerPage.getByRole('button', { name: 'Retry' }).count()) === 0, 'retry button remained after requeue');

    await ownerPage.setViewportSize({ width: 375, height: 812 });
    await ownerPage.waitForTimeout(150);
    const owner375 = await assertNoOverflow(ownerPage, 'owner 375px');
    await capture(ownerPage, 'integration-delivery-owner-375.png');
    await ownerPage.setViewportSize({ width: 320, height: 740 });
    await ownerPage.waitForTimeout(150);
    const owner320 = await assertNoOverflow(ownerPage, 'owner 320px');
    await capture(ownerPage, 'integration-delivery-owner-320.png');
    await owner.close();

    const reviewer = await session(browser, 'qa-reviewer-session-token', { width: 1280, height: 900 });
    const reviewerPage = await reviewer.newPage();
    reviewerPage.on('console', (message) => {
      if (message.type() === 'error') errors.push(`reviewer console: ${message.text()}`);
    });
    reviewerPage.on('requestfailed', (request) => recordFailedRequest('reviewer request', request));
    await reviewerPage.goto(`${ORIGIN}/projects/${PROJECT_ID}`, { waitUntil: 'domcontentloaded' });
    await reviewerPage.getByRole('heading', { name: 'Delivery QA' }).first().waitFor();
    await reviewerPage.getByText('Reviewer access').waitFor();
    const reviewerText = await reviewerPage.locator('body').innerText();
    assert(!reviewerText.includes('Outbound integrations'), 'reviewer can see integration administration');
    assert(!reviewerText.includes('Delivery activity'), 'reviewer can see delivery activity');
    await capture(reviewerPage, 'integration-delivery-reviewer-1280.png');
    await reviewerPage.setViewportSize({ width: 375, height: 812 });
    await reviewerPage.waitForTimeout(150);
    const reviewer375 = await assertNoOverflow(reviewerPage, 'reviewer 375px');
    await capture(reviewerPage, 'integration-delivery-reviewer-375.png');
    await reviewerPage.setViewportSize({ width: 320, height: 740 });
    await reviewerPage.waitForTimeout(150);
    const reviewer320 = await assertNoOverflow(reviewerPage, 'reviewer 320px');
    await capture(reviewerPage, 'integration-delivery-reviewer-320.png');
    await reviewer.close();

    assert(errors.length === 0, errors.join('\n'));
    assert(failedRequests.length === 0, failedRequests.join('\n'));
    process.stdout.write(JSON.stringify({
      owner: { deadLetterVisible: true, requeued: true, oneTimeSecret: true, overflow375: owner375, overflow320: owner320 },
      reviewer: { integrationsRedacted: true, overflow375: reviewer375, overflow320: reviewer320 },
      consoleErrors: errors.length,
      failedRequests: failedRequests.length,
    }, null, 2));
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
