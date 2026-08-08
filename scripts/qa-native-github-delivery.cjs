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
  return context;
}

async function capture(page, name, fullPage = false) {
  await page.screenshot({ path: path.join(OUTPUT, name), fullPage });
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
  const consoleErrors = [];
  const failedRequests = [];
  const githubApiRequests = [];
  const recordFailedRequest = (label, request) => {
    const reason = request.failure()?.errorText ?? 'unknown';
    if (reason === 'net::ERR_ABORTED') return;
    failedRequests.push(`${label}: ${request.url()} ${reason}`);
  };

  try {
    const owner = await session(browser, 'qa-owner-session-token', { width: 1280, height: 1000 });
    const ownerPage = await owner.newPage();
    ownerPage.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(`owner console: ${message.text()}`);
    });
    ownerPage.on('requestfailed', (request) => recordFailedRequest('owner request', request));
    ownerPage.on('request', (request) => {
      if (request.url().startsWith('https://api.github.com/')) githubApiRequests.push(request.url());
    });

    await ownerPage.goto(`${ORIGIN}/projects/${PROJECT_ID}`, { waitUntil: 'domcontentloaded' });
    await ownerPage.getByRole('heading', { name: 'Native GitHub QA' }).first().waitFor();
    await ownerPage.getByText('Outbound integrations').waitFor();
    await ownerPage.getByTestId('integration-kind').selectOption('github');
    const ownerInput = ownerPage.getByLabel('GitHub owner');
    await ownerInput.focus();
    await ownerPage.keyboard.press('Tab');
    assert(await ownerPage.getByLabel('GitHub repository').evaluate((node) => node === document.activeElement), 'repository input is missing from keyboard order');
    await ownerPage.keyboard.press('Tab');
    assert(await ownerPage.getByLabel('GitHub labels').evaluate((node) => node === document.activeElement), 'labels input is missing from keyboard order');
    await ownerPage.keyboard.press('Tab');
    assert(await ownerPage.getByLabel('GitHub token').evaluate((node) => node === document.activeElement), 'token input is missing from keyboard order');
    await ownerPage.getByLabel('GitHub owner').fill('ashbi');
    await ownerPage.getByLabel('GitHub repository').fill('agency-feedback');
    await ownerPage.getByLabel('GitHub labels').fill('visual-feedback, client-review');
    await ownerPage.getByLabel('GitHub token').fill('github_pat_local_qa_token_12345');
    const createResponse = ownerPage.waitForResponse((response) =>
      response.url() === `${ORIGIN}/api/projects/${PROJECT_ID}/integrations`
        && response.request().method() === 'POST',
    );
    await ownerPage.getByRole('button', { name: 'Add integration' }).click();
    const saved = await createResponse;
    assert(saved.status() === 201, `GitHub integration create returned ${saved.status()}`);
    await ownerPage.getByText('ashbi/agency-feedback').waitFor();

    const ownerTextAfterCreate = await ownerPage.locator('body').innerText();
    assert(!ownerTextAfterCreate.includes('github_pat_local_qa_token_12345'), 'GitHub token remained visible after save');
    assert((await ownerPage.getByLabel('GitHub token').inputValue()) === '', 'GitHub token input was not cleared');
    assert(ownerTextAfterCreate.includes('Metadata: read'), 'least-privilege token guidance is missing');
    assert(ownerTextAfterCreate.includes('Issues: write'), 'GitHub issue permission guidance is missing');

    await ownerPage.getByRole('button', { name: 'Show activity' }).click();
    const issueLink = ownerPage.getByRole('link', { name: /Open GitHub issue/ });
    await issueLink.waitFor();
    assert(await issueLink.getAttribute('href') === 'https://github.com/acme/client-site/issues/42', 'issue link target is unsafe or incorrect');
    assert(await issueLink.getAttribute('target') === '_blank', 'issue link does not open in a new tab');
    const rel = await issueLink.getAttribute('rel');
    assert(rel?.includes('noopener') && rel.includes('noreferrer'), 'issue link is missing rel protections');
    await capture(ownerPage, 'native-github-owner-activity-1280.png');

    await ownerPage.setViewportSize({ width: 375, height: 812 });
    await ownerPage.waitForTimeout(150);
    const owner375 = await assertNoOverflow(ownerPage, 'owner 375px');
    await capture(ownerPage, 'native-github-owner-375.png', true);
    await ownerPage.setViewportSize({ width: 320, height: 740 });
    await ownerPage.waitForTimeout(150);
    const owner320 = await assertNoOverflow(ownerPage, 'owner 320px');
    await capture(ownerPage, 'native-github-owner-320.png', true);
    await owner.close();

    const reviewer = await session(browser, 'qa-reviewer-session-token', { width: 1280, height: 900 });
    const reviewerPage = await reviewer.newPage();
    reviewerPage.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(`reviewer console: ${message.text()}`);
    });
    reviewerPage.on('requestfailed', (request) => recordFailedRequest('reviewer request', request));
    await reviewerPage.goto(`${ORIGIN}/projects/${PROJECT_ID}`, { waitUntil: 'domcontentloaded' });
    await reviewerPage.getByRole('heading', { name: 'Native GitHub QA' }).first().waitFor();
    await reviewerPage.getByText('Reviewer access').waitFor();
    await reviewerPage.getByText('Loading review workflow...').waitFor({ state: 'hidden' });
    const reviewerText = await reviewerPage.locator('body').innerText();
    assert(!reviewerText.includes('Outbound integrations'), 'reviewer can see integration administration');
    assert(!reviewerText.includes('acme/client-site'), 'reviewer can see repository metadata');
    assert(!reviewerText.includes('Open GitHub issue'), 'reviewer can see external issue links');
    await capture(reviewerPage, 'native-github-reviewer-1280.png');
    await reviewerPage.setViewportSize({ width: 375, height: 812 });
    await reviewerPage.waitForTimeout(150);
    const reviewer375 = await assertNoOverflow(reviewerPage, 'reviewer 375px');
    await capture(reviewerPage, 'native-github-reviewer-375.png', true);
    await reviewer.close();

    assert(githubApiRequests.length === 0, `browser unexpectedly contacted GitHub: ${githubApiRequests.join(', ')}`);
    assert(consoleErrors.length === 0, consoleErrors.join('\n'));
    assert(failedRequests.length === 0, failedRequests.join('\n'));
    process.stdout.write(JSON.stringify({
      owner: {
        configuredWithoutTokenLeak: true,
        safeIssueLink: true,
        overflow375: owner375,
        overflow320: owner320,
      },
      reviewer: { integrationsRedacted: true, overflow375: reviewer375 },
      githubApiRequests: githubApiRequests.length,
      consoleErrors: consoleErrors.length,
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
