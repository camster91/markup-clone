import { defineConfig } from 'vite';

// Widget bundler config.
//
// The widget is a 500-LOC IIFE that's been grown into a single file over
// time. We split the source into 5 ES modules under src/widget/ and
// bundle them back into a single IIFE at public/widget.js so the host
// page's <script src="/widget.js"> tag continues to work unchanged.
//
// - input: src/widget/index.ts re-exports the 5 modules and auto-boots.
// - output: IIFE with a single global name "MarkupWidget" so the test
//   suite can inject it into scope via the test helper's eval path.
// - minify: true — this is shipped to customer pages.
// - target: 'es2018' — broad browser support, matches the original
//   unminified IIFE's use of async/await + spread + FormData.
// - keepNames: true (esbuild option) — preserve the `captureViewport`
//   function name in the minified output. The test suite (widget.test.ts)
//   string-replaces `screenshotBlob = await captureViewport();` to
//   stub the screenshot for JSDOM. Without this, Vite inlines
//   captureViewport and the test stub no longer matches.

export default defineConfig({
  build: {
    outDir: 'public',
    emptyOutDir: false,
    minify: 'esbuild',
    target: 'es2018',
    rollupOptions: {
      input: 'src/widget/index.ts',
      output: {
        entryFileNames: 'widget.js',
        format: 'iife',
        name: 'MarkupWidget',
      },
    },
  },
  esbuild: {
    keepNames: true,
  },
});
