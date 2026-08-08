const { chromium } = require('playwright');
const path = require('node:path');

const ORIGIN = 'http://localhost:3030';
const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
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

async function run() {
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const failedRequests = [];
  const recordFailedRequest = (label, request) => {
    const reason = request.failure()?.errorText ?? 'unknown';
    // Closing a page cancels its long-lived SSE stream and speculative RSC
    // prefetches. Chromium reports those intentional cancellations as aborts.
    if (reason === 'net::ERR_ABORTED') return;
    failedRequests.push(`${label} request: ${request.url()} ${reason}`);
  };

  try {
    const owner = await session(browser, 'qa-owner-session-token', { width: 1280, height: 900 });
    const ownerPage = await owner.newPage();
    ownerPage.on('console', (message) => {
      if (message.type() === 'error') errors.push(`owner console: ${message.text()}`);
    });
    ownerPage.on('requestfailed', (request) => recordFailedRequest('owner', request));
    await ownerPage.goto(`${ORIGIN}/projects/${PROJECT_ID}`, { waitUntil: 'domcontentloaded' });
    await ownerPage.getByRole('heading', { name: 'Agency Client Website' }).first().waitFor();
    const ownerFilters = ownerPage.getByRole('group', { name: 'Filter issues' });
    await ownerFilters.waitFor();
    assert(await ownerPage.getByText('Showing 3 of 3 issues').isVisible(), 'owner issue count missing');
    await capture(ownerPage, 'issue-management-owner-1280.png');

    const firstPin = ownerPage.locator('button[aria-label^="Open feedback pin 1"]').first();
    await firstPin.focus();
    await firstPin.press('Enter');
    const editor = ownerPage.getByRole('group', { name: 'Internal issue details' });
    await editor.waitFor();
    assert((await ownerPage.locator(':focus').getAttribute('aria-label')) === 'Close comment thread', 'pin did not open from keyboard');
    const priority = editor.locator('select[name="priority"]');
    await priority.selectOption('URGENT');
    await editor.locator('select[name="assigneeId"]').selectOption('55555555-5555-4555-8555-555555555555');
    await editor.locator('input[name="tagNames"]').fill('Frontend, QA');
    await ownerPage.getByRole('button', { name: 'Save issue details' }).click();
    await ownerPage.getByRole('status').filter({ hasText: 'Issue details saved' }).waitFor();

    await priority.focus();
    await ownerPage.keyboard.press('Tab');
    assert(await editor.locator('select[name="assigneeId"]').evaluate((element) => element === document.activeElement), 'metadata fields are not keyboard sequential');

    await ownerPage.getByText('Developer context', { exact: true }).click();
    await ownerPage.getByRole('button', { name: 'Copy developer handoff' }).click();
    const clipboard = await ownerPage.evaluate(() => navigator.clipboard.readText());
    assert(clipboard.includes('## Internal workflow'), 'handoff missing internal section');
    assert(clipboard.includes('- Priority: **URGENT**'), 'handoff missing updated priority');
    assert(clipboard.includes('- Tags: Frontend, QA'), 'handoff missing updated tags');
    await capture(ownerPage, 'issue-management-owner-thread-1280.png');

    await ownerPage.getByRole('button', { name: 'Close comment thread' }).click();
    await ownerFilters.locator('select[name="status"]').selectOption('OPEN');
    await ownerFilters.locator('select[name="priority"]').selectOption('URGENT');
    await ownerPage.getByText('Showing 1 of 3 issues').waitFor();
    assert(await ownerPage.locator('button[aria-label^="Open feedback pin"]').count() === 1, 'AND filters did not leave exactly one pin');
    await capture(ownerPage, 'issue-management-owner-filtered-1280.png');

    await ownerPage.setViewportSize({ width: 375, height: 812 });
    await ownerPage.waitForTimeout(150);
    const ownerOverflow = await ownerPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(ownerOverflow <= 1, `owner mobile page overflows by ${ownerOverflow}px`);
    await capture(ownerPage, 'issue-management-owner-375.png');
    await ownerPage.setViewportSize({ width: 320, height: 740 });
    await ownerPage.waitForTimeout(100);
    const ownerOverflow320 = await ownerPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(ownerOverflow320 <= 1, `owner 320px page overflows by ${ownerOverflow320}px`);
    await capture(ownerPage, 'issue-management-owner-320.png');
    await owner.close();

    const reviewer = await session(browser, 'qa-reviewer-session-token', { width: 1280, height: 900 });
    const reviewerPage = await reviewer.newPage();
    reviewerPage.on('console', (message) => {
      if (message.type() === 'error') errors.push(`reviewer console: ${message.text()}`);
    });
    reviewerPage.on('requestfailed', (request) => recordFailedRequest('reviewer', request));
    await reviewerPage.goto(`${ORIGIN}/projects/${PROJECT_ID}`, { waitUntil: 'domcontentloaded' });
    await reviewerPage.getByText('Reviewer access').waitFor();
    const reviewerText = await reviewerPage.locator('body').innerText();
    assert(!reviewerText.includes('Filter issues'), 'reviewer received internal filters');
    assert(!reviewerText.includes('dev@example.com'), 'reviewer received assignee identity');
    assert(!reviewerText.includes('Frontend'), 'reviewer received internal tags');
    await capture(reviewerPage, 'issue-management-reviewer-1280.png');

    const reviewerPin = reviewerPage.locator('button[aria-label^="Open feedback pin 1"]').first();
    await reviewerPin.focus();
    await reviewerPin.press('Enter');
    await reviewerPage.getByRole('dialog', { name: 'Feedback thread' }).waitFor();
    const reviewerThread = await reviewerPage.getByRole('dialog', { name: 'Feedback thread' }).innerText();
    assert(!reviewerThread.includes('Internal issue details'), 'reviewer can see internal editor');
    assert(!reviewerThread.includes('Developer context'), 'reviewer can see developer context');
    assert(reviewerThread.includes('Mark resolved'), 'reviewer lost conversation status workflow');
    await reviewerPage.setViewportSize({ width: 375, height: 812 });
    await reviewerPage.waitForTimeout(150);
    const reviewerOverflow = await reviewerPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(reviewerOverflow <= 1, `reviewer mobile page overflows by ${reviewerOverflow}px`);
    await capture(reviewerPage, 'issue-management-reviewer-375.png');
    await reviewerPage.setViewportSize({ width: 320, height: 740 });
    await reviewerPage.waitForTimeout(100);
    const reviewerOverflow320 = await reviewerPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(reviewerOverflow320 <= 1, `reviewer 320px page overflows by ${reviewerOverflow320}px`);
    await capture(reviewerPage, 'issue-management-reviewer-320.png');
    await reviewer.close();

    assert(errors.length === 0, errors.join('\n'));
    assert(failedRequests.length === 0, failedRequests.join('\n'));
    process.stdout.write(JSON.stringify({
      owner: { editor: true, handoff: true, andFilters: true, mobileOverflow375: ownerOverflow, mobileOverflow320: ownerOverflow320 },
      reviewer: { redacted: true, statusWorkflow: true, mobileOverflow375: reviewerOverflow, mobileOverflow320: reviewerOverflow320 },
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
