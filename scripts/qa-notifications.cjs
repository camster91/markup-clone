const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const ORIGIN = 'http://localhost:3030';
const PROJECT_ID = '94000000-0000-4000-8000-000000000005';
const OUTPUT = process.env.QA_OUTPUT_DIR || path.join(process.cwd(), 'screenshots-qa');

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function contextFor(browser, token, viewport) {
  const context = await browser.newContext({ viewport });
  await context.addCookies([
    { name: 'markup.session', value: token, url: ORIGIN, sameSite: 'Strict' },
    { name: 'markup.csrf', value: 'qa-notification-csrf', url: ORIGIN, sameSite: 'Strict' },
  ]);
  return context;
}

function observe(page, label, errors) {
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${label}: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`${label}: ${error.message}`));
  page.on('requestfailed', (request) => {
    if (request.failure()?.errorText !== 'net::ERR_ABORTED') {
      errors.push(`${label}: ${request.url()} ${request.failure()?.errorText}`);
    }
  });
}

async function overflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function run() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const ownerContext = await contextFor(browser, 'qa-collaboration-session', { width: 1280, height: 900 });
    const owner = await ownerContext.newPage();
    observe(owner, 'operator', errors);
    await owner.goto(`${ORIGIN}/projects/${PROJECT_ID}`, { waitUntil: 'domcontentloaded' });
    await owner.getByLabel('Open email notification preferences').click();
    await owner.getByText('Recommended for agency operators').waitFor();
    assert(!(await owner.getByLabel('Email me about new feedback').isChecked()), 'operator was silently opted into new feedback');
    assert(await owner.getByLabel('Email me when I am mentioned').isChecked(), 'legacy mention default was not preserved');
    await owner.getByLabel('Use recommended settings for operator').click();
    assert(await owner.getByLabel('Email me about new feedback').isChecked(), 'operator recommendation did not enable new feedback');
    assert(await owner.getByLabel('Email me when feedback is assigned to me').isChecked(), 'operator recommendation did not enable assignments');
    const ownerSave = owner.waitForResponse((response) => response.url().endsWith('/notification-preferences') && response.request().method() === 'PATCH');
    await owner.getByLabel('Save email notification preferences').click();
    assert((await ownerSave).status() === 200, 'operator preference save failed');
    await owner.getByText('Email preferences saved.').waitFor();

    const injectedResponse = await ownerContext.request.patch(
      `${ORIGIN}/api/projects/${PROJECT_ID}/notification-preferences`,
      {
        headers: { Origin: ORIGIN, 'X-CSRF-Token': 'qa-notification-csrf' },
        data: {
          userId: 'attacker', newPinEmail: false, newCommentEmail: false,
          statusChangeEmail: false, assignmentEmail: false, mentionEmail: false,
        },
      },
    );
    assert(injectedResponse.status() === 400, `body userId injection returned ${injectedResponse.status()}`);
    const ownerApi = await owner.evaluate(async ({ projectId }) => {
      const response = await fetch(`/api/projects/${projectId}/notification-preferences`);
      return { body: await response.json(), cache: response.headers.get('cache-control') };
    }, { projectId: PROJECT_ID });
    assert(ownerApi.body.saved === true && ownerApi.body.preferences.newPinEmail === true, 'operator preference did not persist');
    assert(!JSON.stringify(ownerApi.body).includes('94000000-0000-4000-8000-000000000001'), 'preference API leaked the user id');
    assert(!JSON.stringify(ownerApi.body).includes('ProjectNotificationPreference'), 'preference API leaked internal row data');
    assert(ownerApi.cache?.includes('no-store'), 'preference API is cacheable');
    await owner.getByRole('button', { name: 'Close email notification preferences' })
      .locator('xpath=..')
      .screenshot({ path: path.join(OUTPUT, 'notifications-operator-panel-1280.png') });
    await owner.screenshot({ path: path.join(OUTPUT, 'notifications-operator-1280.png'), fullPage: true });
    await ownerContext.close();

    const clientContext = await contextFor(browser, 'qa-notification-client-session', { width: 375, height: 812 });
    const client = await clientContext.newPage();
    observe(client, 'client', errors);
    await client.goto(`${ORIGIN}/projects/${PROJECT_ID}`, { waitUntil: 'domcontentloaded' });
    assert(!(await client.getByText('External new-feedback alerts').count()), 'client can see external alert administration');
    await client.getByLabel('Open email notification preferences').focus();
    assert(await client.getByLabel('Open email notification preferences').evaluate((element) => element === document.activeElement), 'notification toggle cannot receive keyboard focus');
    await client.keyboard.press('Enter');
    await client.getByText('Recommended for client reviewers').waitFor();
    await client.getByLabel('Use recommended settings for client').click();
    assert(await client.getByLabel('Email me about thread replies').isChecked(), 'client recommendation did not enable replies');
    assert(!(await client.getByLabel('Email me about new feedback').isChecked()), 'client recommendation enabled agency new-feedback mail');
    const clientSave = client.waitForResponse((response) => response.url().endsWith('/notification-preferences') && response.request().method() === 'PATCH');
    await client.getByLabel('Save email notification preferences').click();
    assert((await clientSave).status() === 200, 'client preference save failed');
    await client.getByText('Email preferences saved.').waitFor();
    assert(await overflow(client) <= 1, `client notification panel overflows by ${await overflow(client)}px`);
    await client.screenshot({ path: path.join(OUTPUT, 'notifications-client-375.png'), fullPage: true });
    await clientContext.close();

    assert(errors.length === 0, errors.join('\n'));
    process.stdout.write(JSON.stringify({
      operator: { rolePreset: true, saved: true, injectionRejected: true, apiRedacted: true },
      client: { rolePreset: true, saved: true, keyboard: true, mobile375: true },
      mailgunRequests: 0,
      errors: 0,
    }, null, 2));
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
