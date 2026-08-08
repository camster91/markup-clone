const { chromium } = require('playwright');
const path = require('node:path');

const ORIGIN = 'http://localhost:3030';
const PROJECT_ID = '94000000-0000-4000-8000-000000000005';
const OUTPUT = process.env.QA_OUTPUT_DIR || path.join(process.cwd(), 'screenshots-qa');

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const transports = { overviewPresence: 0, overviewEvents: 0, presenceGets: 0, heartbeats: [], events: 0 };
  try {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    await context.addCookies([
      { name: 'markup.session', value: 'qa-collaboration-session', url: ORIGIN, sameSite: 'Strict' },
      { name: 'markup.csrf', value: 'qa-collaboration-csrf', url: ORIGIN, sameSite: 'Strict' },
    ]);
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('requestfailed', (request) => {
      if (request.failure()?.errorText !== 'net::ERR_ABORTED') {
        errors.push(`${request.url()} ${request.failure()?.errorText}`);
      }
    });
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname === '/api/events') {
        if (page.url() === `${ORIGIN}/`) transports.overviewEvents += 1;
        else transports.events += 1;
      }
      if (url.pathname === '/api/presence') {
        if (page.url() === `${ORIGIN}/`) transports.overviewPresence += 1;
        else if (request.method() === 'GET') transports.presenceGets += 1;
        else if (request.method() === 'POST') transports.heartbeats.push(request.postDataJSON());
      }
    });

    await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' });
    await page.getByRole('link', { name: 'Collaboration Transport QA' }).waitFor();
    await page.getByText('3 pins', { exact: true }).waitFor();
    await page.getByText('2 open', { exact: true }).waitFor();
    await page.waitForTimeout(500);
    assert(transports.overviewPresence === 0, 'overview opened a presence transport');
    assert(transports.overviewEvents === 0, 'overview opened an event stream');

    await page.goto(`${ORIGIN}/projects/${PROJECT_ID}`, { waitUntil: 'domcontentloaded' });
    await page.getByText('2 captures').waitFor();
    const panels = page.locator('[role="tabpanel"]');
    assert(await panels.count() === 2, 'two screenshots did not render');
    const firstPanel = panels.first();
    const imageUrl = await firstPanel.locator('img').getAttribute('src');
    const focusedScreenshotId = imageUrl?.match(/\/api\/screenshots\/([^/]+)\/image/)?.[1];
    assert(focusedScreenshotId, 'could not identify the focused screenshot');
    await firstPanel.hover({ position: { x: 50, y: 30 } });
    await page.waitForTimeout(5500);

    assert(transports.events === 1, `expected one SSE connection, saw ${transports.events}`);
    assert(transports.presenceGets >= 1 && transports.presenceGets <= 3,
      `presence GET fan-out detected: ${transports.presenceGets}`);
    assert(transports.heartbeats.length >= 1 && transports.heartbeats.length <= 3,
      `heartbeat fan-out detected: ${transports.heartbeats.length}`);
    const focusedHeartbeat = transports.heartbeats.find((body) => body?.screenshotId === focusedScreenshotId);
    assert(focusedHeartbeat && typeof focusedHeartbeat.cursorX === 'number'
      && typeof focusedHeartbeat.cursorY === 'number',
    `focused cursor did not reach the project heartbeat: ${JSON.stringify(transports.heartbeats)}`);
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(overflow <= 1, `mobile project overflows by ${overflow}px`);
    await page.screenshot({
      path: path.join(OUTPUT, 'collaboration-transport-375.png'),
      fullPage: true,
    });
    assert(errors.length === 0, errors.join('\n'));
    process.stdout.write(JSON.stringify({
      overview: { presence: 0, events: 0 },
      focusedProject: {
        screenshots: 2,
        eventStreams: transports.events,
        presenceGets: transports.presenceGets,
        heartbeats: transports.heartbeats.length,
        cursorRouted: true,
        mobile375: true,
      },
      errors: 0,
    }, null, 2));
    await context.close();
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
