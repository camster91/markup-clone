const { chromium } = require('playwright');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const ORIGIN = 'http://localhost:3030';
const PROJECT_ID = '30000000-0000-4000-8000-000000000001';
const WORKSPACE_ID = '10000000-0000-4000-8000-000000000001';
const TEAM_ID = '20000000-0000-4000-8000-000000000001';
const OUTPUT = process.env.QA_OUTPUT_DIR || path.join(process.cwd(), 'screenshots-qa');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function session(browser, token, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.addCookies([
    { name: 'markup.session', value: token, url: ORIGIN, sameSite: 'Strict' },
    { name: 'markup.csrf', value: 'qa-agency-csrf-token', url: ORIGIN, sameSite: 'Strict' },
  ]);
  return context;
}

function observe(page, label, consoleErrors, failedRequests) {
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`${label}: ${message.text()}`);
  });
  page.on('pageerror', (error) => consoleErrors.push(`${label}: ${error.message}`));
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText || 'unknown';
    if (reason !== 'net::ERR_ABORTED') failedRequests.push(`${label}: ${request.url()} ${reason}`);
  });
}

async function noOverflow(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(overflow <= 1, `${label} overflows horizontally by ${overflow}px`);
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const consoleErrors = [];
  const failedRequests = [];
  let secret;
  try {
    const ownerContext = await session(browser, 'qa-owner-session', { width: 1280, height: 900 });
    const owner = await ownerContext.newPage();
    observe(owner, 'owner', consoleErrors, failedRequests);
    await owner.goto(`${ORIGIN}/workspaces/${WORKSPACE_ID}/teams/${TEAM_ID}`, { waitUntil: 'networkidle' });
    await owner.getByRole('heading', { name: 'Review defaults' }).waitFor();
    await owner.getByLabel('Review round name template').fill('Acme delivery {n}');
    await owner.getByLabel('Start new rounds paused').check();
    const defaultsResponse = owner.waitForResponse((response) =>
      response.url() === `${ORIGIN}/api/workspaces/${WORKSPACE_ID}/teams/${TEAM_ID}`
      && response.request().method() === 'PATCH');
    await owner.getByRole('button', { name: 'Save defaults' }).click();
    assert((await defaultsResponse).status() === 200, 'review defaults update failed');
    await owner.getByText('Review defaults saved').waitFor();
    await owner.screenshot({ path: path.join(OUTPUT, 'review-defaults-owner-1280.png'), fullPage: true });

    await owner.goto(`${ORIGIN}/projects/${PROJECT_ID}`, { waitUntil: 'networkidle' });
    await owner.getByText('Loading review workflow...').waitFor({ state: 'hidden' });
    assert(await owner.getByLabel('Review round name').inputValue() === 'Acme delivery 1', 'review round suggestion did not use the client default');
    await owner.getByText('New rounds start with new feedback paused for this client account.').waitFor();
    await owner.getByRole('heading', { name: 'Developer API access' }).waitFor();
    await owner.getByLabel('Token name').fill('QA automation');
    const createResponse = owner.waitForResponse((response) =>
      response.url() === `${ORIGIN}/api/projects/${PROJECT_ID}/api-tokens`
      && response.request().method() === 'POST');
    await owner.getByRole('button', { name: 'Create token' }).click();
    const created = await createResponse;
    assert(created.status() === 201, `developer token create returned ${created.status()}`);
    const createBody = await created.json();
    assert(!Object.prototype.hasOwnProperty.call(createBody.token, 'tokenHash'), 'token create response leaked its hash');
    secret = await owner.getByLabel('One-time developer token').inputValue();
    assert(/^mkv1_[A-Za-z0-9_-]{43}$/.test(secret), 'one-time developer token has the wrong shape');
    await owner.screenshot({ path: path.join(OUTPUT, 'developer-api-owner-1280.png'), fullPage: true });
    await owner.setViewportSize({ width: 320, height: 740 });
    await noOverflow(owner, 'developer API owner 320px');
    await owner.screenshot({ path: path.join(OUTPUT, 'developer-api-owner-320.png'), fullPage: true });

    const api = await owner.request.get(`${ORIGIN}/api/v1/projects/${PROJECT_ID}/issues?limit=2`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    assert(api.status() === 200, `public issue API returned ${api.status()}`);
    const apiBody = await api.json();
    assert(apiBody.apiVersion === 'v1', 'public issue API version is missing');
    assert(Array.isArray(apiBody.data), 'public issue API data is not an array');
    assert(apiBody.pagination?.limit === 2, 'public issue API pagination is incorrect');
    assert(api.headers()['access-control-allow-origin'] === undefined, 'public issue API unexpectedly enables browser CORS');
    await owner.getByRole('button', { name: 'I saved it' }).click();
    assert(await owner.getByLabel('One-time developer token').count() === 0, 'one-time token remained visible after dismissal');

    const clientContext = await session(browser, 'qa-client-session', { width: 375, height: 812 });
    const client = await clientContext.newPage();
    observe(client, 'client', consoleErrors, failedRequests);
    await client.goto(`${ORIGIN}/projects/${PROJECT_ID}`, { waitUntil: 'networkidle' });
    const clientText = await client.locator('body').innerText();
    assert(!clientText.includes('Developer API access'), 'client can see developer token controls');
    assert(!clientText.includes('QA automation'), 'client can see developer token metadata');
    await noOverflow(client, 'developer API client 375px');
    await client.screenshot({ path: path.join(OUTPUT, 'developer-api-client-375.png'), fullPage: true });
    await clientContext.close();

    const revokeResponse = owner.waitForResponse((response) =>
      response.url().includes('/api-tokens/') && response.request().method() === 'DELETE');
    await owner.getByRole('button', { name: 'Revoke QA automation' }).click();
    assert((await revokeResponse).status() === 200, 'developer token revoke failed');
    const revokedApi = await owner.request.get(`${ORIGIN}/api/v1/projects/${PROJECT_ID}/issues`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    assert(revokedApi.status() === 401, 'revoked token still authorizes API requests');
    assert((await revokedApi.json()).error?.code === 'AUTH_INVALID', 'revoked token exposes the wrong error contract');
    await ownerContext.close();

    const sdkContext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const sdkPage = await sdkContext.newPage();
    observe(sdkPage, 'sdk', consoleErrors, failedRequests);
    await sdkPage.goto(`${ORIGIN}/invite`, { waitUntil: 'networkidle' });
    const sdkSource = readFileSync(path.join(process.cwd(), 'packages/markup-sdk/dist/index.js'), 'utf8');
    const sdkResult = await sdkPage.evaluate(async ({ source, origin, projectId }) => {
      const moduleUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      try {
        const { MarkupSDK } = await import(moduleUrl);
        const sdk = new MarkupSDK({
          host: origin,
          projectId,
          apiKey: 'mk_qa_agency_roles_project_key',
          authorName: 'SDK QA',
          loadTimeoutMs: 5000,
        });
        let modeEvents = 0;
        const unsubscribe = sdk.on('modechange', () => { modeEvents += 1; });
        const mounted = await sdk.mount();
        const scriptCount = document.querySelectorAll(`script[src="${origin}/widget.js"]`).length;
        const sameMount = await sdk.mount();
        sdk.startFeedback();
        const active = sdk.getState();
        sdk.stopFeedback();
        const stopped = sdk.getState();
        unsubscribe();
        sdk.destroy();
        return {
          mounted, sameMount, active, stopped, modeEvents,
          scriptCount,
          remainingScripts: document.querySelectorAll(`script[src="${origin}/widget.js"]`).length,
        };
      } finally {
        URL.revokeObjectURL(moduleUrl);
      }
    }, { source: sdkSource, origin: ORIGIN, projectId: PROJECT_ID });
    assert(sdkResult.mounted.ready && sdkResult.sameMount.ready, 'SDK did not mount idempotently');
    assert(sdkResult.scriptCount === 1, 'SDK injected the widget script more than once');
    assert(sdkResult.active.feedbackMode === true && sdkResult.stopped.feedbackMode === false, 'SDK lifecycle controls failed');
    assert(sdkResult.modeEvents >= 2, 'SDK typed mode events did not fire');
    assert(sdkResult.remainingScripts === 0, 'SDK destroy left its script behind');
    await sdkContext.close();

    assert(consoleErrors.length === 0, consoleErrors.join('\n'));
    assert(failedRequests.length === 0, failedRequests.join('\n'));
    process.stdout.write(JSON.stringify({
      developerTokens: { oneTimeSecret: true, hashRedacted: true, clientHidden: true, revokedDenied: true },
      publicApi: { version: 'v1', bearerAuth: true, boundedPagination: true, corsDisabled: true },
      browserSdk: { idempotentMount: true, lifecycle: true, typedEvents: true, cleanup: true },
      reviewDefaults: { clientAccountOwned: true, numberedSuggestion: true, pausePreference: true },
      responsive: { owner320: true, client375: true },
      consoleErrors: 0,
      failedRequests: 0,
    }, null, 2));
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
