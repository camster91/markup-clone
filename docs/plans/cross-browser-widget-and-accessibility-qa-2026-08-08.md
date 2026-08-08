# Cross-browser widget and accessibility QA — 2026-08-08

**Status:** complete locally; production untouched
**Parent:** `docs/plans/agency-product-release-2026-08-07.md` release evidence

## Outcome

Turn the existing Chromium-only E2E claims into executable evidence across
Chromium, Firefox, and WebKit for the real built widget and recapture flow. Add
browser-native keyboard/accessibility assertions where JSDOM is insufficient,
capture screenshots for visual inspection, and fix defects exposed by the runs.

## Scope

1. Repair the widget E2E fixture so its relative `/widget.js` request has the
   configured application origin and the test actually executes the built asset.
2. Run the existing widget and recapture flows in Chromium, Firefox, and WebKit.
3. Add real-browser keyboard/focus, accessible-name, touch-target, viewport
   overflow, console-error, and request-failure assertions for the widget journey.
4. Capture desktop and 375px screenshots from the supported engines and inspect
   the rendered result rather than relying only on exit status.
5. Record exact browser versions/results and any justified engine limitation.

## Safety boundaries

- Use only the healthy local production-mode container and intercepted fixture
  requests; do not create production data or contact external services.
- Do not weaken the widget's screenshot or accessibility contract just to make a
  browser pass. A real incompatibility becomes a product fix or a documented gate.
- Production, Git, npm publication, and deployment remain approval-gated.

## Verification

- Preserve the failing Chromium baseline as RED evidence for the origin defect.
- Pass all Playwright projects with real browser engines.
- Run full Vitest and warning-free ESLint after any product-code change.
- Visually inspect the captured mobile/desktop screenshots and record findings.

## Completion evidence

- The original Chromium test failed before the widget toggle appeared because
  `page.setContent()` ran on `about:blank`; after establishing an application
  origin, it exposed the actual product defect instead of passing a mock flow.
- The real built widget then failed screenshot upload because Chromium marked the
  canvas non-origin-clean after drawing the blob-backed SVG `foreignObject` and
  `canvas.toBlob()` threw `SecurityError`. Loading the same self-contained SVG
  through a `FileReader` data URL preserves an origin-clean canvas without a new
  dependency. See MDN's [canvas security guidance](https://developer.mozilla.org/en-US/docs/Web/HTML/How_to/CORS_enabled_image).
- The widget flow now proves an actual `capture.png` with `image/png` in the
  multipart request and records no console, page, or request failures.
- Added dialog semantics, connected form labels, 16px mobile fields, 44px controls,
  visible focus, focus trapping, Escape close, focus return, pressed-state tools,
  mobile-safe width/height, and consistent inherited control typography.
- Playwright 1.62 passed 9/9 local production-mode journeys on Chromium
  151.0.7922.34, Firefox 153.0, and WebKit 26.5: real widget submission,
  recapture state, and the 320px keyboard/accessibility contract on every engine.
- Visual inspection of the Chromium, Firefox, and WebKit screenshots at 320px,
  375px, and desktop confirmed clean hierarchy, focus visibility, spacing,
  typography, and no clipping or horizontal overflow.
- Final-tree Vitest passed 875 tests with 3 intentional skips. Standalone ESLint,
  Prisma validation, zero-vulnerability production audit, host production build,
  and exact Linux image build all passed. The local container is healthy and its
  widget SHA-256 matches the working-tree artifact.
- The shipped widget remains small at 27.54 kB uncompressed / 9.61 kB gzip.

Production, Git, npm publication, and the retained-prior-image rollback remain
approval-gated.
