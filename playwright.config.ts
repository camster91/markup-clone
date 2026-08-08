// playwright.config.ts
//
// e2e configuration for the markup-clone dashboard. The vitest suite
// (875+ tests under tests/**) is the unit/integration layer; this
// config is the e2e layer — a small number of full-browser flows
// that JSDOM cannot cover: the real DOM, real `elementFromPoint`,
// real Fetch in a real <script> context, and the actual ScreenshotView
// state machine driven by user clicks.
//
// Design choices:
//
// 1. testDir: 'tests/e2e' keeps e2e files in their own tree so the
//    vitest `include` glob ('tests/**/*.test.{ts,tsx}') never picks
//    them up. e2e files use the `.spec.ts` suffix (also outside the
//    vitest glob) so the two test runners stay isolated by filename
//    pattern, not by the exclude list (which would couple them).
//
// 2. baseURL: 'http://localhost:3030' matches the deploy.sh
//    HOST_PORT (3030). When the operator runs `npx playwright test`
//    locally they can either point baseURL at an already-running dev
//    server or let `webServer` spin one up. Both `npm run dev` (port
//    3000 by default) and the production `npm start` (also 3000
//    unless PORT is set) are pinned to 3030 here so the e2e suite
//    matches the deployed target without env-var plumbing.
//
// 3. webServer: prefer `npm run build && npm start` so the e2e
//    suite runs against the production bundle (the same one the
//    user gets from `npm run build`); fall back to `npm run dev`
//    when the env var `PLAYWRIGHT_DEV=1` is set, which is useful
//    when iterating locally and you don't want to wait on a
//    rebuild. We don't try to be smart about detecting the env —
//    the operator sets PLAYWRIGHT_DEV when they want dev mode.
//
// 4. Don't run `npx playwright install` from this config: the
//    browser binary downloads are an operator step that depends on
//    network/cache, and the env we run the tests in is offline by
//    design. The README's "Running e2e tests" section documents the
//    one-time `npx playwright install chromium firefox webkit` step.
//
// 5. `testIgnore` on the vitest files is belt-and-suspenders. The
//    vitest `include` glob already excludes .spec.ts files, but if
//    a future test file uses a .test.ts suffix AND lives under
//    tests/e2e/, we don't want playwright to pick it up. The
//    conventional split is: .test.* = vitest, .spec.* = playwright.
//
// 6. The deploy.sh script intentionally does NOT run playwright.
//    Playwright is a CI step on the dev machine, not a production
//    gate. A production VPS would need the chromium binary
//    installed (~300MB), which the deploy script's image
//    constraint doesn't anticipate.

import { defineConfig, devices } from '@playwright/test';

const PORT = 3030;
const HOST = '127.0.0.1';

const useDevServer = process.env.PLAYWRIGHT_DEV === '1';

export default defineConfig({
  testDir: 'tests/e2e',
  testIgnore: '**/*.test.ts', // vitest files; keep e2e to .spec.ts
  // Spec files can take a few seconds each (network mocks, real
  // page loads, click → state transition → poll tick). The default
  // 30s timeout is too tight for the recapture flow which is a
  // multi-tick state machine. 60s per test is plenty.
  timeout: 60_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // 1 worker is enough for the small e2e suite. Parallelism across
  // workers would mean multiple `npm run build`s racing for the
  // same .next dir; serial keeps the dev server's view of the
  // filesystem coherent. Set workers=2+ in CI if the suite grows.
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://${HOST}:${PORT}`,
    trace: 'on-first-retry',
    // `headless: true` is the default; we set it explicitly so a
    // future operator who wants to debug can flip it to false
    // without diving into the playwright docs.
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    command: useDevServer ? 'npm run dev' : 'npm run build && npm start',
    url: `http://${HOST}:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
    // Bind next to 3030 so the e2e suite's baseURL matches the
    // deploy port. `next dev` and `next start` both honor the
    // PORT env var.
    env: {
      PORT: String(PORT),
      HOSTNAME: HOST,
    },
  },
});
