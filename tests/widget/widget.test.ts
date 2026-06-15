/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('markup widget', () => {
  let originalFetch: typeof global.fetch;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  // The widget IIFE calls `document.addEventListener('click', fn, true)` at
  // boot and never removes the listener. If we eval the widget more than
  // once (which the tests do — every test calls loadWidget), each eval
  // adds another listener and the stale ones stay bound for the rest of
  // the file. We patch addEventListener/removeEventListener at the test
  // boundary so we can find and detach them in afterEach. This keeps the
  // widget's runtime behavior untouched while making the test environment
  // isolated.
  let realAdd: typeof document.addEventListener;
  let realRemove: typeof document.removeEventListener;
  let trackedListeners: Map<string, Set<EventListenerOrEventListenerObject>>;

  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-markup-loaded');
    originalFetch = global.fetch;
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 201 }));
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Patch document.addEventListener / removeEventListener to track click
    // listeners so we can detach them in afterEach. The widget's stale
    // IIFE click listeners are the main source of cross-test bleed.
    realAdd = document.addEventListener.bind(document);
    realRemove = document.removeEventListener.bind(document);
    trackedListeners = new Map();
    (document as any).addEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions
    ) {
      if (type === 'click') {
        let set = trackedListeners.get('click');
        if (!set) { set = new Set(); trackedListeners.set('click', set); }
        set.add(listener);
      }
      return realAdd(type, listener, options);
    };
    (document as any).removeEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions
    ) {
      if (type === 'click') {
        trackedListeners.get('click')?.delete(listener);
      }
      return realRemove(type, listener, options);
    };
  });

  afterEach(() => {
    // Detach any click listeners the widget IIFE added during this test.
    // Without this, the next test would inherit every prior IIFE's click
    // handler, and a single `t.click()` would open a modal in each one
    // (the orphan IIFEs' isFeedbackMode is still true from their previous
    // test), spawning multiple modals and making the Save click
    // ambiguous.
    for (const [type, set] of trackedListeners.entries()) {
      for (const listener of set) {
        realRemove(type as string, listener as EventListener, true);
      }
    }
    trackedListeners.clear();
    (document as any).addEventListener = realAdd;
    (document as any).removeEventListener = realRemove;

    global.fetch = originalFetch;
    warnSpy.mockRestore();
    delete (window as any).MARKUP_WIDGET_CONFIG;
    document.querySelectorAll('script').forEach(s => s.remove());
    document.querySelectorAll('[id^="markup-"]').forEach(n => n.remove());
    // The widget's modal box and overlay are plain <div>s with no markup-*
    // id, so the selector above misses them. Without this, a test that
    // opens a modal leaks 2 <div>s into the next test's body, which causes
    // `document.querySelectorAll('button')` to return Save buttons from
    // orphaned modals that are no longer wired to the widget's currentModal
    // closure — clicking them does nothing.
    document.querySelectorAll('body > div').forEach(n => n.remove());
  });

  // Helper: load the widget IIFE and trigger its button creation
  async function loadWidget(opts: { projectId?: string; apiKey?: string; src?: string } = {}) {
    const projectId = opts.projectId ?? 'proj-1';
    const apiKey = opts.apiKey ?? 'mk_test';
    const src = opts.src ?? '/widget.js';

    // Create a script tag the widget reads config from (document.currentScript path)
    const script = document.createElement('script');
    script.setAttribute('data-project-id', projectId);
    script.setAttribute('data-api-key', apiKey);
    script.setAttribute('src', src);
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

  // Helper: walk the widget through feedback-mode → click target → type into
  // the comment textarea → click "Save pin". Returns once the fetch has been
  // issued (callers can then inspect `global.fetch.mock.calls[0]`).
  //
  // Each call to loadWidget() (re)evals the widget IIFE, which adds a fresh
  // `document.addEventListener('click', ...)` AND creates a fresh
  // #markup-toggle button. The old IIFE's listener and button linger in
  // document and body across tests. So when this test fires a click on the
  // target element, every previous IIFE's click handler also runs (its
  // own isFeedbackMode may be true, so it spawns an orphan modal). The
  // orphan modal's Save button is bound to the previous IIFE's
  // `currentModal` reference, which has since been overwritten — clicking
  // it calls submitPending on the orphan IIFE, which either fires a fetch
  // with stale state or no-ops. To avoid that ambiguity, we find the
  // textarea in the *most recently appended* modal (the active one) and
  // use the Save button inside that same modal box.
  async function clickSaveInFeedbackMode() {
    Object.defineProperty(document.documentElement, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(document.documentElement, 'clientHeight', { value: 600, configurable: true });
    // The widget computes xPercent = clickX / window.innerWidth, so
    // JSDOM's default innerWidth (1024) would skew the percentage. Pin
    // it to match the test's expected clientWidth/clientHeight.
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true });
    // JSDOM doesn't implement elementFromPoint; provide a stub that returns the body
    // so showModal's call to getCssPath on the click target resolves.
    document.body.innerHTML = '<div id="t" style="width:50px;height:50px">x</div>';
    await loadWidget();

    (document.querySelector('#markup-toggle') as HTMLButtonElement).click();
    const t = document.getElementById('t')!;
    t.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 25, clientY: 25 }));

    // Wait for the modal to render and the screenshot capture to resolve
    await new Promise(r => setTimeout(r, 200));

    // Pick the LAST textarea in DOM order — that's the one in the modal
    // that the just-loaded widget instance opened.
    const textareas = Array.from(document.querySelectorAll('textarea')) as HTMLTextAreaElement[];
    const textarea = textareas[textareas.length - 1];
    expect(textarea).toBeTruthy();
    textarea.value = 'Please change this button color';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    // Find the Save pin button inside the SAME modal box as that textarea.
    // The modal box is the ancestor div with inline style `width:320px`.
    // Walking up from the textarea: parent = body div, parent's parent = box.
    const modalBox = textarea.closest('div')!.parentElement!;
    expect(modalBox).toBeTruthy();
    const saveBtn = Array.from(modalBox.querySelectorAll('button'))
      .find(b => b.textContent?.includes('Save pin')) as HTMLButtonElement;
    expect(saveBtn).toBeTruthy();
    expect(saveBtn.disabled).toBe(false);
    saveBtn.click();

    // Give the async submit handler a tick to call fetch
    await new Promise(r => setTimeout(r, 50));
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

  // ---------- Audit 3.6: fetch shape (URL, headers, body) in feedback mode ----------

  it('Save click posts to <script-src>/api/pins with the X-Api-Key header', async () => {
    await clickSaveInFeedbackMode();

    // global.fetch is a vi.fn(); assert it was called exactly once with the
    // shape widget.js builds in submitPending().
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // JSDOM resolves the script's relative `src='/widget.js'` against the
    // test runner's base URL (http://localhost:3000), so SCRIPT_SRC is the
    // absolute form. The widget code itself does
    //   SCRIPT_SRC.replace(/\/widget\.js.*$/, '') + '/api/pins'
    // — mirror that exact derivation here so the test is robust to changes
    // in the test runner's base URL.
    const scriptEl = document.querySelector('script[src*="widget.js"]') as HTMLScriptElement;
    const scriptSrc = scriptEl?.src ?? '/widget.js';
    const expectedUrl = scriptSrc.replace(/\/widget\.js.*$/, '') + '/api/pins';
    expect(url).toBe(expectedUrl);

    // Headers are a plain object in widget.js. We accept either Headers or object.
    const headers = init.headers as Record<string, string>;
    expect(headers).toBeDefined();
    expect(headers['X-Api-Key']).toBe('mk_test');
  });

  it('Save click sends a FormData body with projectId, path, xPercent, yPercent, text, and screenshot', async () => {
    await clickSaveInFeedbackMode();

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const fd = init.body as FormData;

    expect(fd).toBeInstanceOf(FormData);
    expect(fd.get('projectId')).toBe('proj-1');
    expect(typeof fd.get('path')).toBe('string');
    expect((fd.get('path') as string).length).toBeGreaterThan(0);
    // xPercent / yPercent are stored as strings in the FormData (widget does String(...))
    expect(typeof fd.get('xPercent')).toBe('string');
    expect(typeof fd.get('yPercent')).toBe('string');
    // The x/y values reflect the click coords we dispatched (25, 25) over an 800x600 viewport
    expect(parseFloat(fd.get('xPercent') as string)).toBeCloseTo((25 / 800) * 100, 5);
    expect(parseFloat(fd.get('yPercent') as string)).toBeCloseTo((25 / 600) * 100, 5);
    expect(fd.get('text')).toBe('Please change this button color');

    // The test stub replaces captureViewport with a fake Blob; the widget should
    // attach it as a 'screenshot' File-like entry.
    const screenshot = fd.get('screenshot');
    expect(screenshot).toBeTruthy();
    expect(screenshot).toBeInstanceOf(Blob);
  });

  it('bails out with a clear warning when data-api-key is missing (no fetch ever fires)', async () => {
    // Load with no API key — the IIFE should warn and return early, never
    // even creating the #markup-toggle button.
    document.body.innerHTML = '<p>host site</p>';
    await loadWidget({ apiKey: '' });

    // 1. Visible signal: no Feedback button rendered.
    expect(document.querySelector('#markup-toggle')).toBeNull();

    // 2. Auditable signal: a clear, single-line warning was logged.
    const calls = warnSpy.mock.calls.map(args => String(args[0] ?? ''));
    expect(calls.some(msg => /missing data-api-key or data-project-id/i.test(msg))).toBe(true);

    // 3. Hard signal: fetch was NEVER called. This is the security-relevant
    //    one — a silent swallow would let a misconfigured embed pretend to work.
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bails out with a clear warning when data-project-id is missing (no fetch ever fires)', async () => {
    document.body.innerHTML = '<p>host site</p>';
    await loadWidget({ projectId: '' });

    expect(document.querySelector('#markup-toggle')).toBeNull();
    const calls = warnSpy.mock.calls.map(args => String(args[0] ?? ''));
    expect(calls.some(msg => /missing data-api-key or data-project-id/i.test(msg))).toBe(true);

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads data-project-id from the script tag and uses it as the form-data projectId (audit A-4)', async () => {
    // The widget's config reader (public/widget.js line 12) does:
    //   const PROJECT_ID = scriptEl.getAttribute('data-project-id') || '';
    // This test exercises that reader end-to-end by loading the widget
    // with a UUID-shaped data-project-id, then running the full feedback
    // flow and asserting the SAME UUID flows out in the FormData body.
    //
    // A regression that re-introduces a placeholder ('00000000-...') or
    // a stale fallback (e.g. apiKey-as-projectId) would be caught here.
    const realProjectId = 'b0a6f8c2-1234-4d5e-8abc-0123456789ab';

    // Set up viewport + a target element so the feedback flow can run
    // (mirrors the clickSaveInFeedbackMode helper, but with a UUID
    // projectId and a re-entrant setup).
    Object.defineProperty(document.documentElement, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(document.documentElement, 'clientHeight', { value: 600, configurable: true });
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true });
    document.body.innerHTML = '<div id="t" style="width:50px;height:50px">x</div>';

    await loadWidget({ projectId: realProjectId });

    (document.querySelector('#markup-toggle') as HTMLButtonElement).click();
    const t = document.getElementById('t')!;
    t.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 25, clientY: 25 }));
    await new Promise(r => setTimeout(r, 200));

    const textareas = Array.from(document.querySelectorAll('textarea')) as HTMLTextAreaElement[];
    const textarea = textareas[textareas.length - 1];
    expect(textarea).toBeTruthy();
    textarea.value = 'audit A-4 project id test';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    const modalBox = textarea.closest('div')!.parentElement!;
    const saveBtn = Array.from(modalBox.querySelectorAll('button'))
      .find(b => b.textContent?.includes('Save pin')) as HTMLButtonElement;
    expect(saveBtn).toBeTruthy();
    saveBtn.click();
    await new Promise(r => setTimeout(r, 50));

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const fd = init.body as FormData;
    // The widget MUST have read the data-project-id from the script tag
    // and shipped it verbatim in the form body. Anything else — empty
    // string, placeholder UUID, the apiKey — fails this assertion.
    expect(fd.get('projectId')).toBe(realProjectId);
    expect(fd.get('projectId')).not.toBe('');
    expect(fd.get('projectId')).not.toBe('mk_test');
  });

  it('posts to the host derived from the script src — NOT a URL pinned to the projectId (regression for wrong-project-domain)', async () => {
    // The widget computes API_URL from SCRIPT_SRC on line 10:
    //   API_URL = SCRIPT_SRC.replace(/\/widget\.js.*$/, '') + '/api/pins'
    // The projectId is sent in the FormData body, not in the URL. This means
    // if the embed code loads the widget from a different host than the one
    // associated with data-project-id, pin data (including projectId) flows
    // to the script-src host. That is the audit's "wrong project domain"
    // leak path.
    //
    // This test pins the *current behavior* so a future refactor that tries
    // to "fix" the leak by deriving the URL from projectId (a tempting but
    // wrong fix that would let the script src host stay attacker-controlled)
    // is caught. The proper fix is to enforce a projectId→allowed-host
    // allowlist in the widget or, better, on the server.
    Object.defineProperty(document.documentElement, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(document.documentElement, 'clientHeight', { value: 600, configurable: true });
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true });
    document.body.innerHTML = '<div id="t" style="width:50px;height:50px">x</div>';

    // Use a clearly cross-origin-looking script src. JSDOM doesn't actually
    // fetch the script — we eval the local file regardless — but the widget
    // reads `scriptEl.src` from the tag, so the URL derivation runs on this
    // string.
    const attackerSrc = 'https://evil.example.com/widget.js?cb=12345';
    await loadWidget({ projectId: 'real-project-id', src: attackerSrc });

    (document.querySelector('#markup-toggle') as HTMLButtonElement).click();
    const t = document.getElementById('t')!;
    t.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 25, clientY: 25 }));
    await new Promise(r => setTimeout(r, 200));

    // Same orphan-modal defense as clickSaveInFeedbackMode: pick the LAST
    // textarea in DOM order (the one in the modal this widget instance opened).
    const textareas = Array.from(document.querySelectorAll('textarea')) as HTMLTextAreaElement[];
    const textarea = textareas[textareas.length - 1];
    expect(textarea).toBeTruthy();
    textarea.value = 'leak test';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    const modalBox = textarea.closest('div')!.parentElement!;
    const saveBtn = Array.from(modalBox.querySelectorAll('button'))
      .find(b => b.textContent?.includes('Save pin')) as HTMLButtonElement;
    expect(saveBtn).toBeTruthy();
    saveBtn.click();
    await new Promise(r => setTimeout(r, 50));

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    // Lock down the documented security boundary: the URL is taken from the
    // script src host, and the projectId is sent in the body. If a future
    // change moves projectId into the URL, OR derives the URL from
    // projectId, this assertion will fail and the change will have to be
    // justified explicitly.
    const expectedUrl = attackerSrc.replace(/\/widget\.js.*$/, '') + '/api/pins';
    expect(url).toBe(expectedUrl);
    expect(url).toContain('evil.example.com');
    expect(url).not.toContain('real-project-id');

    const fd = init.body as FormData;
    expect(fd.get('projectId')).toBe('real-project-id');
  });
});