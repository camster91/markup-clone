/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('markup widget', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-markup-loaded');
    originalFetch = global.fetch;
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 201 }));
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete (window as any).MARKUP_WIDGET_CONFIG;
    document.querySelectorAll('script').forEach(s => s.remove());
    document.querySelectorAll('[id^="markup-"]').forEach(n => n.remove());
  });

  // Helper: load the widget IIFE and trigger its button creation
  async function loadWidget(opts: { projectId?: string; apiKey?: string } = {}) {
    const projectId = opts.projectId ?? 'proj-1';
    const apiKey = opts.apiKey ?? 'mk_test';

    // Create a script tag the widget reads config from (document.currentScript path)
    const script = document.createElement('script');
    script.setAttribute('data-project-id', projectId);
    script.setAttribute('data-api-key', apiKey);
    script.setAttribute('src', '/widget.js');
    document.head.appendChild(script);

    // JSDOM: document.currentScript is always null for dynamically added scripts.
    // We must set it so the widget can read data-* attrs. Also set readyState
    // to 'complete' so the IIFE skips the DOMContentLoaded branch and calls
    // createToggleButton() synchronously during eval.
    Object.defineProperty(document, 'currentScript', { value: script, configurable: true });
    Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });

    // Eval the widget source — the IIFE reads document.currentScript at the top
    // and auto-calls createToggleButton(). We stub captureViewport so JSDOM
    // doesn't crash on the SVG-foreignObject screenshot trick.
    //
    // Resolve the widget path relative to THIS test file rather than
    // hardcoding /Users/biancabienaime/... so the test runs anywhere
    // the repo is checked out. The previous absolute path silently
    // passed on the original developer's machine because there happened
    // to be a byte-identical copy of the file at that exact path.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const widgetPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..', '..', 'public', 'widget.js'
    );
    let widgetSource = await fs.readFile(widgetPath, 'utf-8');
    widgetSource = widgetSource.replace(
      'screenshotBlob = await captureViewport();',
      'screenshotBlob = new Blob(["fake"], { type: "image/png" });'
    );
    (0, eval)(widgetSource);
  }

  it('renders a floating Feedback button when configured', async () => {
    await loadWidget();

    const btn = document.querySelector('#markup-toggle');
    expect(btn).toBeTruthy();
    expect(btn?.textContent).toMatch(/Feedback/i);
  });

  it('clicking the Feedback button enters feedback mode (button text changes)', async () => {
    await loadWidget();

    const btn = document.querySelector('#markup-toggle') as HTMLButtonElement;
    expect(btn).toBeTruthy();

    btn.click();

    // In feedback mode the button text changes to "Click anywhere to leave feedback"
    expect(btn.textContent).toMatch(/Click anywhere/i);
  });

  it('hovering over an element applies a dashed outline (feedback mode)', async () => {
    // JSDOM needs viewport dimensions and a working elementFromPoint for hover to work.
    // Set up viewport + mock elementFromPoint (JSDOM doesn't implement it).
    Object.defineProperty(document.documentElement, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(document.documentElement, 'clientHeight', { value: 600, configurable: true });
    document.body.innerHTML = '<div id="target" style="width:100px;height:100px">target</div>';
    await loadWidget();

    // Enter feedback mode
    (document.querySelector('#markup-toggle') as HTMLButtonElement).click();

    // Hover the target element
    const target = document.getElementById('target') as HTMLElement;
    // JSDOM does not implement elementFromPoint; mock it before dispatching
    Object.defineProperty(document, 'elementFromPoint', {
      value: () => target,
      configurable: true,
    });

    const event = new MouseEvent('mousemove', { bubbles: true, clientX: 50, clientY: 50 });
    target.dispatchEvent(event);

    // Widget applies outline: 2px dashed #FF0055; outline-offset: 2px to lastHoveredEl
    expect(target.style.outline).toBe('2px dashed #FF0055');
    expect(target.style.outlineOffset).toBe('2px');
  });

  it('clicking an element in feedback mode opens a modal with the correct structure', async () => {
    Object.defineProperty(document.documentElement, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(document.documentElement, 'clientHeight', { value: 600, configurable: true });
    document.body.innerHTML = '<div id="t" style="width:50px;height:50px">x</div>';
    await loadWidget();

    // Enter feedback mode
    (document.querySelector('#markup-toggle') as HTMLButtonElement).click();

    // Click the target — this opens the modal
    const t = document.getElementById('t')!;
    t.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 25, clientY: 25 }));

    // Wait for the modal to render
    await new Promise(r => setTimeout(r, 150));

    // The widget should have created a pin marker and a modal with textarea and Save button
    const pin = document.querySelector('[id^="markup-pin-"]');
    const textarea = document.querySelector('textarea');
    const buttons = Array.from(document.querySelectorAll('button'));
    const saveBtn = buttons.find(b => b.textContent?.includes('Save pin'));

    expect(pin).toBeTruthy();
    expect(textarea).toBeTruthy();
    expect(saveBtn).toBeTruthy();
  });

  it('does not crash when the page has no external stylesheets', async () => {
    document.head.innerHTML = '';
    document.body.innerHTML = '<p>no styles</p>';
    await expect(loadWidget()).resolves.not.toThrow();
  });

  it('does not crash when body has display:none', async () => {
    document.body.style.display = 'none';
    await expect(loadWidget()).resolves.not.toThrow();
  });
});