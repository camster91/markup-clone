const { chromium } = require('playwright');
const path = require('node:path');

const ORIGIN = 'http://localhost:3030';
const PROJECT_ID = '93000000-0000-4000-8000-000000000001';
const OUTPUT = process.env.QA_OUTPUT_DIR || path.join(process.cwd(), 'screenshots-qa');

function assert(value, message) {
  if (!value) throw new Error(message);
}

function localDateTimeTomorrow() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

async function noOverflow(page, label) {
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(overflow <= 1, `${label} overflows horizontally by ${overflow}px`);
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

async function run() {
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const ownerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ownerContext.addCookies([
      { name: 'markup.session', value: 'qa-managed-share-session', url: ORIGIN, sameSite: 'Strict' },
      { name: 'markup.csrf', value: 'qa-managed-share-csrf', url: ORIGIN, sameSite: 'Strict' },
    ]);
    const owner = await ownerContext.newPage();
    observe(owner, 'owner', errors);
    await owner.goto(`${ORIGIN}/projects/${PROJECT_ID}`, { waitUntil: 'networkidle' });
    await owner.getByText('Public share link').waitFor();
    await owner.getByLabel('Share link expiry').fill(localDateTimeTomorrow());
    await owner.getByLabel('Share link password').fill('Client review 2026');
    const createWait = owner.waitForResponse((response) =>
      response.url().endsWith(`/api/projects/${PROJECT_ID}/share`)
      && response.request().method() === 'POST');
    await owner.getByRole('button', { name: 'Generate share link' }).click();
    const createResponse = await createWait;
    assert(createResponse.status() === 200, `share creation returned ${createResponse.status()}`);
    const created = await createResponse.json();
    assert(created.passwordProtected === true, 'created link was not password protected');
    assert(typeof created.expiresAt === 'string', 'created link lost its expiry');
    assert(!JSON.stringify(created).includes('scrypt$'), 'create response leaked a password hash');
    assert(created.shareUrl.endsWith('/open'), 'managed share URL does not use the cookie opener');
    await owner.getByText('Password protected').waitFor();
    await owner.screenshot({ path: path.join(OUTPUT, 'managed-share-owner-1280.png'), fullPage: true });
    await owner.setViewportSize({ width: 320, height: 740 });
    await noOverflow(owner, 'managed share owner 320px');
    await owner.screenshot({ path: path.join(OUTPUT, 'managed-share-owner-320.png'), fullPage: true });

    const publicContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const review = await publicContext.newPage();
    observe(review, 'public review', errors);
    await review.goto(created.shareUrl, { waitUntil: 'networkidle' });
    await review.getByRole('heading', { name: 'Managed Share QA' }).waitFor();
    await review.getByText('Northstar Studio').waitFor();
    await review.getByText('Welcome to your delivery review.').waitFor();
    assert(await review.getByText('Protected review').isVisible(), 'password gate did not render');
    assert(await review.getByText('No pages captured yet').count() === 0, 'review data rendered before unlock');
    assert(await review.locator('meta[name="referrer"][content="no-referrer"]').count() === 1,
      'share page did not emit no-referrer metadata');
    await noOverflow(review, 'protected review 375px');
    await review.screenshot({ path: path.join(OUTPUT, 'managed-share-password-375.png'), fullPage: true });

    const password = review.getByLabel('Review password');
    assert(await password.evaluate((element) => element === document.activeElement),
      'password field did not receive initial focus');
    await review.keyboard.press('Tab');
    assert(await review.getByRole('button', { name: 'Open review' }).evaluate(
      (element) => element === document.activeElement), 'keyboard order did not reach Open review');
    await password.fill('Wrong password');
    await review.getByRole('button', { name: 'Open review' }).click();
    await review.getByText('Incorrect password. Check the password and try again.').waitFor();
    await password.fill('Client review 2026');
    await review.getByRole('button', { name: 'Open review' }).click();
    await review.getByText('No pages captured yet').waitFor();
    assert(!review.url().includes('/open'), 'unlock did not leave the opener route');
    const shareCookies = (await publicContext.cookies()).filter((cookie) => cookie.name.startsWith('markup.share.'));
    assert(shareCookies.length === 1, 'unlock did not issue exactly one share cookie');
    assert(shareCookies[0].httpOnly && shareCookies[0].sameSite === 'Strict',
      'share cookie is missing HttpOnly or SameSite=Strict');
    assert(!shareCookies[0].name.includes(created.shareToken)
      && !shareCookies[0].value.includes(created.shareToken), 'share cookie exposes the bearer token');

    await owner.setViewportSize({ width: 1280, height: 900 });
    await owner.getByRole('button', { name: 'Replace link' }).click();
    await owner.getByLabel('Share link expiry').fill('');
    await owner.getByLabel('Share link password').fill('Replacement password');
    const replaceWait = owner.waitForResponse((response) =>
      response.url().endsWith(`/api/projects/${PROJECT_ID}/share`)
      && response.request().method() === 'POST');
    await owner.getByRole('button', { name: 'Replace share link' }).click();
    const replacement = await (await replaceWait).json();
    assert(replacement.shareToken !== created.shareToken, 'replacement did not rotate the token');
    const oldResponse = await publicContext.request.get(created.shareUrl, { maxRedirects: 0 });
    assert(oldResponse.status() === 404, 'rotated share link still opens');

    const revokeWait = owner.waitForResponse((response) =>
      response.url().endsWith(`/api/projects/${PROJECT_ID}/share`)
      && response.request().method() === 'DELETE');
    owner.once('dialog', (dialog) => dialog.accept());
    await owner.getByRole('button', { name: 'Revoke' }).click();
    assert((await revokeWait).status() === 200, 'share revoke failed');
    const revokedResponse = await publicContext.request.get(replacement.shareUrl, { maxRedirects: 0 });
    assert(revokedResponse.status() === 404, 'revoked share link still opens');

    assert(errors.length === 0, errors.join('\n'));
    process.stdout.write(JSON.stringify({
      create: { expiry: true, passwordHashRedacted: true, openerUrl: true },
      publicReview: { passwordGate: true, keyboard: true, mobile375: true, noReferrer: true },
      cookie: { httpOnly: true, sameSiteStrict: true, tokenBound: true },
      lifecycle: { wrongPassword: true, unlock: true, rotate: true, revoke: true },
      ownerResponsive: { desktop1280: true, mobile320: true },
      errors: 0,
    }, null, 2));
    await publicContext.close();
    await ownerContext.close();
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
