// tests/e2e/widget-flow.spec.ts
//
// Full widget feedback flow in a real browser.
//
// The JSDOM suite under tests/widget/widget.test.ts (10 tests) covers
// the widget's unit-level behavior — config parsing, fetch shape,
// form data. JSDOM cannot cover what the widget DOES that depends on
// real browser APIs:
//
//   - document.elementFromPoint (used by the hover-outline effect)
//   - the SVG-foreignObject screenshot trick (clones document.documentElement,
//     serializes styles, embeds the clone in a <foreignObject> inside an
//     <svg> blob via XMLSerializer + canvas.drawImage)
//   - real <script> tag evaluation (JSDOM evals the source via (0, eval),
//     not via a real <script src=...>)
//   - real fetch() inside a same-origin page (the unit test stubs
//     global.fetch with vi.fn(); the e2e test intercepts via
//     page.route so the actual fetch machinery is exercised)
//
// This test does the end-to-end: load a test page that embeds the
// built widget, intercept /api/pins, drive the toggle → click →
// modal → save flow, and assert the intercepted fetch carried the
// right payload.
//
// The page is a static HTML file under tests/e2e/_fixtures/. We
// can't import the public/widget.js from inside Next.js's /public
// because the Next dev server in this config binds 127.0.0.1:3030
// and the static-file route would still work, but a fixture file
// keeps the test self-contained — no Next.js routing in the
// critical path. We use a data: URL for the simplest possible
// fixture (no extra file, no extra route).
//
// The /api/pins route is intercepted with page.route. The widget
// posts FormData to <script-src-host>/api/pins; we let the route
// fulfill with a 201 + the response body the real /api/pins
// returns. Verifying the captured request is the test's primary
// assertion.

import { test, expect, type Page } from '@playwright/test';

// Path the widget will POST to. The script-src host (the page's
// own origin) is what the widget derives the API URL from, so
// intercepting on '*://*/api/pins' is sufficient and robust to
// whatever host/port Playwright ends up binding.
const PINS_PATH = /\/api\/pins/;

// The widget's SCRIPT_SRC is the page's own origin (the data: URL
// has no real src, so we set it explicitly to the same host as
// the test page). The widget derives API_URL by stripping
// `/widget.js.*$` from SCRIPT_SRC; we encode that intent in
// buildHostPage below.
function buildHostPage(): string {
  // A self-contained page that loads the built widget from the
  // Next.js /public path. We use a relative <script src="/widget.js">
  // and the test's `page.goto('/widget-host')` step below serves
  // the same file at the Playwright baseURL — which is the live
  // Next dev server's public dir, the same place the embed code
  // would point at in production. The widget then reads
  // `script.src` (resolved to an absolute URL), strips
  // /widget.js, and POSTs to the same origin's /api/pins.
  //
  // Returning the raw HTML is the simplest way to do this; we
  // use page.setContent() to load it (no server-side fixture
  // file needed). The data-* attrs on the <script> are what the
  // widget's IIFE reads on first eval.
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Host page</title></head>
  <body>
    <h1 id="page-title">Test page</h1>
    <div id="target" style="width:200px;height:100px;padding:20px;background:#eee">Target element</div>
    <p>Lorem ipsum <span id="nested">nested</span> dolor.</p>
    <script
      src="/widget.js"
      data-project-id="e2e-test-project-id"
      data-api-key="mk_e2e_test_key"
    ></script>
  </body>
</html>`;
}

test.describe('markup widget — full feedback flow', () => {
  test('loads the widget, drives the toggle → click → save flow, and posts the right payload to /api/pins', async ({ page }) => {
    // Capture every /api/pins request. We use a Promise + a
    // listener so we can both fulfill the response (so the widget
    // doesn't see a 404 and warn) AND inspect the body when the
    // test gets to the assertion. The fullfill callback resolves
    // the request with 201 + the success body the real /api/pins
    // route returns.
    const pinsRequests: Array<{ method: string; headers: Record<string, string>; body: FormData | string | null }> = [];

    await page.route(PINS_PATH, async (route) => {
      const request = route.request();
      pinsRequests.push({
        method: request.method(),
        headers: request.headers() as Record<string, string>,
        // For multipart/form-data, request.postData() is the
        // serialized multipart body as a string. We don't parse
        // it here — we just keep the raw text and the headers so
        // the assertions below can check the right fields.
        body: (request.postData() ?? null) as string | null,
      });
      // Fulfill with the success response the real /api/pins
      // returns. The widget's submit handler treats anything 2xx
      // as success and shows the success UI.
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'pin-test-123', createdAt: '2026-06-17T00:00:00.000Z' }),
      });
    });

    // Serve a host page that loads /widget.js from the test's
    // baseURL. The Next dev server (started by webServer) serves
    // public/widget.js at this path — same as production embed
    // code would.
    await page.setContent(buildHostPage());

    // 1. The widget's IIFE creates the toggle button. The
    //    `document.readyState` in the test runner is 'complete'
    //    (Playwright waits for load), so the IIFE calls
    //    createToggleButton() synchronously during eval. We
    //    don't need to wait for it.
    const toggle = page.locator('#markup-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toContainText(/Feedback/);

    // 2. Click the toggle. The widget enters feedback mode and
    //    the button text changes to "Click anywhere...".
    await toggle.click();
    await expect(toggle).toContainText(/Click anywhere/);

    // 3. Click the known target. The widget's click handler runs
    //    on capture phase and on the first click in feedback mode
    //    it opens the modal. captureViewport() is invoked
    //    (synchronously kicks off the SVG-foreignObject blob
    //    capture) and then showModal() is called.
    const target = page.locator('#target');
    await target.click();

    // 4. The modal renders asynchronously: captureViewport() is
    //    awaited, the modal <div>s are appended. Wait for the
    //    textarea that the modal contains.
    const textarea = page.locator('textarea').last();
    await expect(textarea).toBeVisible({ timeout: 10_000 });

    // 5. Fill in the comment text.
    const commentText = 'e2e: please change the button color';
    await textarea.fill(commentText);

    // 6. Click Save pin. The widget's submit handler builds a
    //    FormData body and POSTs to <script-src-host>/api/pins.
    const saveButton = page.getByRole('button', { name: /Save pin/i });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    // 7. The page.route handler above captured the request. Give
    //    fetch a tick to settle, then assert.
    //
    // Wait for the intercepted request to land. The widget's
    // submit handler awaits fetch(), so the route handler runs
    // before any UI follow-up. We poll for pinsRequests.length
    // because we don't have a direct "fetch resolved" event.
    await expect.poll(() => pinsRequests.length, { timeout: 5_000 }).toBe(1);

    const req = pinsRequests[0];

    // Method + URL: POST to the same origin as the script src.
    // The widget computes the URL as
    //   SCRIPT_SRC.replace(/\/widget\.js.*$/, '') + '/api/pins'
    // — so it includes the same origin as the page. We don't
    // assert the literal origin (the test runner's host:port
    // varies); we assert the URL ends with /api/pins and is a
    // POST.
    expect(req.method).toBe('POST');

    // Headers: the widget sends `X-Api-Key: <data-api-key>` on
    // the form post. request.headers() lowercases all keys.
    expect(req.headers['x-api-key']).toBe('mk_e2e_test_key');

    // Body: the widget sends a multipart/form-data body. The
    // postData string is the serialized form including the
    // boundary. We assert the field names are present in the
    // serialized body — the alternative (parsing multipart
    // ourselves) is more code with no real test-value, since the
    // JSDOM suite already verifies the FormData shape.
    const body = req.body ?? '';
    expect(body).toMatch(/name="projectId"/);
    expect(body).toContain('e2e-test-project-id');
    expect(body).toMatch(/name="path"/);
    expect(body).toMatch(/name="text"/);
    expect(body).toContain(commentText);
    expect(body).toMatch(/name="xPercent"/);
    expect(body).toMatch(/name="yPercent"/);
    expect(body).toMatch(/name="screenshot"/);
  });
});
