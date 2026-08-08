const { chromium } = require('playwright');
const path = require('node:path');

const ORIGIN = 'http://localhost:3030';
const WORKSPACE_ID = '10000000-0000-4000-8000-000000000001';
const TEAM_ID = '20000000-0000-4000-8000-000000000001';
const PROJECT_ID = '30000000-0000-4000-8000-000000000001';
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

async function capture(page, name, fullPage = true) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(OUTPUT, name), fullPage });
}

async function noOverflow(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(overflow <= 1, `${label} overflows horizontally by ${overflow}px`);
  return overflow;
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

async function run() {
  const browser = await chromium.launch({ headless: true });
  const consoleErrors = [];
  const failedRequests = [];
  let acceptUrl;
  const invitedEmail = `qa-client-${Date.now()}@example.test`;
  try {
    const operatorContext = await session(browser, 'qa-operator-session', { width: 1280, height: 900 });
    const operator = await operatorContext.newPage();
    observe(operator, 'operator', consoleErrors, failedRequests);
    await operator.goto(`${ORIGIN}/workspaces/${WORKSPACE_ID}`, { waitUntil: 'networkidle' });
    await operator.getByRole('heading', { name: 'Client review branding' }).waitFor();
    await operator.getByLabel('Reviewer-facing brand name').fill('Northstar Studio');
    await operator.getByLabel('Brand accent color').fill('#facc15');
    await operator.getByLabel('Reviewer welcome message').fill('Review the latest build with us.');
    const brandingResponse = operator.waitForResponse((response) =>
      response.url() === `${ORIGIN}/api/workspaces/${WORKSPACE_ID}`
      && response.request().method() === 'PATCH',
    );
    await operator.getByRole('button', { name: 'Save branding' }).click();
    const branded = await brandingResponse;
    assert(branded.status() === 200, `branding update returned ${branded.status()}`);
    await operator.getByText('Branding saved').waitFor();
    await capture(operator, 'agency-branding-operator-1280.png');
    await operatorContext.close();

    const ownerContext = await session(browser, 'qa-owner-session', { width: 1280, height: 900 });
    const owner = await ownerContext.newPage();
    observe(owner, 'owner', consoleErrors, failedRequests);
    await owner.goto(`${ORIGIN}/workspaces/${WORKSPACE_ID}/teams/${TEAM_ID}`, { waitUntil: 'networkidle' });
    await owner.getByRole('heading', { name: 'Acme Website Delivery' }).waitFor();
    const ownerText = await owner.locator('body').innerText();
    assert(ownerText.includes('People and access'), 'owner access manager is missing');
    assert(ownerText.includes('owner@example.test'), 'owner cannot see the member directory');
    assert(ownerText.includes('developer@example.test'), 'owner cannot see contributor membership');
    await capture(owner, 'agency-roles-owner-1280.png');

    await owner.getByLabel('Invitation email').fill(invitedEmail);
    await owner.getByLabel('Invitation role').selectOption('client');
    const createResponse = owner.waitForResponse((response) =>
      response.url().endsWith(`/teams/${TEAM_ID}/invitations`)
      && response.request().method() === 'POST',
    );
    await owner.getByRole('button', { name: 'Create invitation' }).click();
    const invitationResponse = await createResponse;
    assert(invitationResponse.status() === 201, `invitation create returned ${invitationResponse.status()}`);
    await owner.getByText('Copy this invitation link now').waitFor();
    acceptUrl = await owner.getByLabel('One-time invitation link').inputValue();
    assert(acceptUrl.startsWith(`${ORIGIN}/invite#`), 'one-time invitation URL does not use a fragment');
    assert(!acceptUrl.includes('tokenHash'), 'invitation URL leaks its hash field');
    await capture(owner, 'agency-roles-owner-one-time-link-1280.png');
    await owner.setViewportSize({ width: 320, height: 740 });
    await noOverflow(owner, 'owner 320px');
    await capture(owner, 'agency-roles-owner-320.png');
    await ownerContext.close();

    const contributorContext = await session(browser, 'qa-contributor-session', { width: 375, height: 812 });
    const contributor = await contributorContext.newPage();
    observe(contributor, 'contributor', consoleErrors, failedRequests);
    await contributor.goto(`${ORIGIN}/workspaces/${WORKSPACE_ID}/teams/${TEAM_ID}`, { waitUntil: 'networkidle' });
    const contributorText = await contributor.locator('body').innerText();
    assert(contributorText.includes('Contributor access'), 'contributor role badge is missing');
    assert(contributorText.includes('New site'), 'contributor cannot create a site');
    assert(!contributorText.includes('People and access'), 'contributor can see people controls');
    assert(!contributorText.includes('owner@example.test'), 'contributor can see member emails');
    await noOverflow(contributor, 'contributor 375px');
    await capture(contributor, 'agency-roles-contributor-375.png');
    await contributorContext.close();

    const clientContext = await session(browser, 'qa-client-session', { width: 375, height: 812 });
    const client = await clientContext.newPage();
    observe(client, 'client', consoleErrors, failedRequests);
    await client.goto(`${ORIGIN}/workspaces/${WORKSPACE_ID}/teams/${TEAM_ID}`, { waitUntil: 'networkidle' });
    const clientText = await client.locator('body').innerText();
    assert(clientText.includes('Client review access'), 'client role badge is missing');
    assert(!clientText.includes('New site'), 'client can see site creation');
    assert(!clientText.includes('People and access'), 'client can see people controls');
    await noOverflow(client, 'client 375px');
    await capture(client, 'agency-roles-client-375.png');
    await client.getByRole('link', { name: 'Acme Marketing Site' }).click();
    await client.waitForURL(`${ORIGIN}/projects/${PROJECT_ID}`);
    await client.getByRole('heading', { name: 'Acme Marketing Site' }).first().waitFor();
    await client.getByText('Loading review workflow...').waitFor({ state: 'hidden' });
    const brandedClient = await client.locator('body').innerText();
    assert(brandedClient.includes('Northstar Studio'), `client review is missing agency branding: ${brandedClient.slice(0, 500)}`);
    assert(brandedClient.includes('Review the latest build with us.'), 'client review is missing welcome copy');
    assert(brandedClient.includes('Client review access'), 'client project access label is unclear');
    await noOverflow(client, 'client project 375px');
    await capture(client, 'agency-branding-client-project-375.png');
    await clientContext.close();

    const guestContext = await session(browser, 'qa-guest-session', { width: 375, height: 812 });
    const guest = await guestContext.newPage();
    observe(guest, 'guest', consoleErrors, failedRequests);
    await guest.goto(`${ORIGIN}/workspaces/${WORKSPACE_ID}`, { waitUntil: 'networkidle' });
    const guestWorkspace = await guest.locator('body').innerText();
    assert(guestWorkspace.includes('Acme Website Delivery'), 'guest cannot see their team');
    assert(guestWorkspace.includes('1 site'), 'guest sees a client-wide site count');
    assert(!guestWorkspace.includes('Private Internal Team'), 'guest can see an unrelated team');
    assert(!guestWorkspace.includes('member'), 'guest can see member-directory counts');
    await capture(guest, 'agency-roles-guest-workspace-375.png');
    await guest.getByRole('link', { name: /Open/ }).click();
    await guest.waitForURL(`${ORIGIN}/projects/${PROJECT_ID}`);
    await guest.getByRole('heading', { name: 'Acme Marketing Site' }).first().waitFor();
    await guest.getByText('Loading review workflow...').waitFor({ state: 'hidden' });
    assert(guest.url() === `${ORIGIN}/projects/${PROJECT_ID}`, 'guest did not redirect to the assigned project');
    const guestProject = await guest.locator('body').innerText();
    assert(guestProject.includes('Guest access'), 'guest project uses an unclear access label');
    assert(guestProject.includes('Northstar Studio'), 'guest review is missing agency branding');
    await noOverflow(guest, 'guest project 375px');
    await capture(guest, 'agency-roles-guest-project-375.png');
    await guestContext.close();

    const inviteContext = await browser.newContext({ viewport: { width: 320, height: 740 } });
    const invite = await inviteContext.newPage();
    observe(invite, 'invite', consoleErrors, failedRequests);
    await invite.goto(acceptUrl, { waitUntil: 'networkidle' });
    assert(invite.url() === `${ORIGIN}/invite`, 'invitation fragment was not removed immediately');
    const inviteText = await invite.locator('body').innerText();
    assert(inviteText.includes('Acme Website Delivery'), 'invitation details did not load');
    assert(inviteText.includes('Client access'), 'invitation role is unclear');
    assert(inviteText.includes('Northstar Studio'), 'invitation is missing agency branding');
    assert(inviteText.includes('Review the latest build with us.'), 'invitation is missing welcome copy');
    assert(!inviteText.includes(acceptUrl.split('#')[1]), 'invitation token was rendered');
    const acceptButton = invite.getByRole('button', { name: 'Accept invitation' });
    assert(await acceptButton.evaluate((node) => getComputedStyle(node).backgroundColor) === 'rgb(250, 204, 21)', 'invitation accent was not applied');
    assert(await acceptButton.evaluate((node) => getComputedStyle(node).color) === 'rgb(17, 24, 39)', 'light accent uses unreadable button text');
    await noOverflow(invite, 'invite 320px');
    await capture(invite, 'agency-roles-invite-320.png');
    await invite.getByLabel('Account password').fill('agencyinvite123');
    const acceptResponse = invite.waitForResponse((response) =>
      response.url().endsWith('/api/invitations/accept') && response.request().method() === 'POST',
    );
    await invite.getByRole('button', { name: 'Accept invitation' }).click();
    const accepted = await acceptResponse;
    assert(accepted.status() === 200, `invitation acceptance returned ${accepted.status()}`);
    await invite.getByText('Invitation accepted').waitFor();
    await capture(invite, 'agency-roles-invite-accepted-320.png');
    await inviteContext.close();

    const archiveContext = await session(browser, 'qa-owner-session', { width: 1280, height: 900 });
    const archive = await archiveContext.newPage();
    observe(archive, 'archive', consoleErrors, failedRequests);
    await archive.goto(`${ORIGIN}/projects/${PROJECT_ID}`, { waitUntil: 'networkidle' });
    await archive.getByRole('heading', { name: 'Acme Marketing Site' }).first().waitFor();
    await archive.getByRole('button', { name: 'Site settings' }).click();
    archive.once('dialog', (dialog) => dialog.accept());
    const archiveResponse = archive.waitForResponse((response) =>
      response.url() === `${ORIGIN}/api/projects/${PROJECT_ID}`
      && response.request().method() === 'PATCH',
    );
    await archive.getByRole('button', { name: 'Archive site' }).click();
    assert((await archiveResponse).status() === 200, 'site archive request failed');
    await archive.getByText('Archived site.').waitFor();
    await archive.goto(`${ORIGIN}/archive`, { waitUntil: 'networkidle' });
    const archiveText = await archive.locator('body').innerText();
    assert(archiveText.includes('Acme Marketing Site'), 'archived site is missing from the archive');
    assert(archiveText.includes('Client: Acme Website Delivery'), 'archive does not preserve client organization');
    assert(!archiveText.includes('API Key'), 'archive renders project setup secrets');
    assert(!archiveText.includes('Outbound integrations'), 'archive starts live integration controls');
    await noOverflow(archive, 'archive 1280px');
    await capture(archive, 'agency-organization-archive-1280.png');
    await archive.setViewportSize({ width: 320, height: 740 });
    await noOverflow(archive, 'archive 320px');
    await capture(archive, 'agency-organization-archive-320.png');
    const restoreResponse = archive.waitForResponse((response) =>
      response.url() === `${ORIGIN}/api/projects/${PROJECT_ID}`
      && response.request().method() === 'PATCH',
    );
    await archive.getByRole('button', { name: 'Restore site' }).click();
    assert((await restoreResponse).status() === 200, 'site restore request failed');
    await archive.getByRole('heading', { name: 'Archive is empty' }).waitFor();
    await archive.goto(`${ORIGIN}/workspaces/${WORKSPACE_ID}/teams/${TEAM_ID}`, { waitUntil: 'networkidle' });
    assert((await archive.locator('body').innerText()).includes('1 active site'), 'restored site did not return to its client account');
    await archiveContext.close();

    assert(consoleErrors.length === 0, consoleErrors.join('\n'));
    assert(failedRequests.length === 0, failedRequests.join('\n'));
    process.stdout.write(JSON.stringify({
      owner: { peopleManager: true, oneTimeFragmentLink: true, overflow320: 0 },
      contributor: { projectAdmin: true, peopleRedacted: true, overflow375: 0 },
      client: { reviewOnly: true, peopleRedacted: true, overflow375: 0 },
      guest: { oneProjectOnly: true, countsRedacted: true, overflow375: 0 },
      invitation: { fragmentRemoved: true, tokenNotRendered: true, accepted: true, overflow320: 0 },
      branding: { operatorManaged: true, clientAndGuestApplied: true, contrastSafe: true },
      organization: { agencyClientSiteLabels: true, archiveRestore: true, overflow320: 0 },
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
