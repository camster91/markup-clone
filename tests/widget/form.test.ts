/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  showModal,
  hideModal,
  getCurrentModal,
  getPendingClick,
  getAnnotationQueue,
  getToolState,
} from '../../src/widget/form';
import { captureViewport } from '../../src/widget/capture';

// Stub captureViewport in form.ts by replacing the module's binding.
// The widget's lifecycle imports captureViewport; the test setup
// replaces the exported function on the imported namespace. The
// cleanest way is to stub the module via vitest's vi.mock, but
// form.ts has side effects (currentModal/currentPin) that need to
// run before any test. We use a top-level vi.mock with a factory.
//
// Note: form.ts is imported above so its module-level state
// initializes once. The mock factory runs first and replaces
// captureViewport before the showModal handler can call it.
vi.mock('../../src/widget/capture', () => ({
  captureViewport: vi.fn(async () =>
    new Blob(['fake'], { type: 'image/png' })
  ),
}));

describe('widget/form', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    // JSDOM viewport
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true });
  });

  afterEach(() => {
    // Reset module state (open modal, in-flight capture guard) so one
    // test's leftovers can't swallow the next test's showModal().
    hideModal();
    document.body.innerHTML = '';
  });

  it('showModal shows a modal in the document', async () => {
    // showModal is the entry point when the user clicks an element in
    // feedback mode. It must create a modal box (with a textarea) and
    // append it to the body so the user can type feedback.
    const target = document.createElement('div');
    target.id = 'target';
    document.body.appendChild(target);

    await showModal(
      100, // clickX
      100, // clickY
      target, // clickTarget
      'Test Author', // authorName
      'https://example.com/api/pins', // apiUrl
      'mk_test', // apiKey
      'proj-1' // projectId
    );

    // The modal is a fixed-position box (320px wide) with a header
    // reading "Pin #N" and a textarea. We assert on the textarea
    // since that's the most reliable signal the form rendered.
    const textareas = document.querySelectorAll('textarea');
    expect(textareas.length).toBe(1);

    // getCurrentModal exposes the modal handles for tests that need
    // to drive the form (e.g. dispatching input events).
    const modal = getCurrentModal();
    expect(modal).not.toBeNull();
    expect(modal!.textarea).toBe(textareas[0]);
  });

  it('showModal records pendingClick with xPercent and yPercent in [0,100]', async () => {
    // The pendingClick record is what gets serialized to the FormData
    // POST. xPercent/yPercent must be in [0,100] so the server can
    // position the pin on the captured image (which uses the same
    // coordinate space).
    const target = document.createElement('div');
    document.body.appendChild(target);
    await showModal(400, 300, target, 'A', 'https://x/api/pins', 'k', 'p');
    const pending = getPendingClick();
    expect(pending).not.toBeNull();
    expect(pending!.xPercent).toBeCloseTo(50, 5);
    expect(pending!.yPercent).toBeCloseTo(50, 5);
  });

  it('showModal pins are not interactive (pointer-events:none)', async () => {
    // The pin marker sits at the click location; clicks on the pin
    // should pass through to the document so the user can still click
    // around to add more pins. The pin's style sets pointer-events:none.
    const target = document.createElement('div');
    document.body.appendChild(target);
    await showModal(100, 100, target, 'A', 'u', 'k', 'p');
    const pin = document.querySelector('[id^="markup-pin-"]') as HTMLElement | null;
    expect(pin).toBeTruthy();
    expect(pin!.style.pointerEvents).toBe('none');
  });

  // ---------- Annotation tools vs. the modal backdrop ----------
  //
  // In a real browser the full-viewport backdrop (modal.overlay) sits
  // above the page, so every click / pointerdown on "the page" while a
  // tool is armed targets the backdrop. These tests dispatch on the
  // backdrop itself — what hit-testing would produce — instead of on a
  // page element.

  async function openModal(): Promise<NonNullable<ReturnType<typeof getCurrentModal>>> {
    const target = document.createElement('div');
    document.body.appendChild(target);
    await showModal(100, 100, target, 'A', 'https://x.example/api/pins', 'mk_test', 'p');
    const modal = getCurrentModal();
    expect(modal).not.toBeNull();
    return modal!;
  }

  function armTool(modal: NonNullable<ReturnType<typeof getCurrentModal>>, kind: string) {
    (modal.toolRow.querySelector(`[data-markup-tool="${kind}"]`) as HTMLButtonElement).click();
  }

  function clickAt(el: Element, x: number, y: number) {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
  }

  it('Arrow tool records clicks that land on the modal backdrop', async () => {
    const modal = await openModal();
    armTool(modal, 'arrow');
    expect(modal.overlay.style.cursor).toBe('crosshair');

    clickAt(modal.overlay, 120, 80);
    clickAt(modal.overlay, 300, 240);

    expect(getAnnotationQueue()).toEqual([{ kind: 'arrow', path: [[120, 80], [300, 240]] }]);
    expect(getToolState().kind).toBe('idle');
    expect(modal.overlay.style.cursor).toBe('');
    // The modal stays open and the preview shows the queued arrow.
    expect(getCurrentModal()).toBe(modal);
    expect(modal.previewList.querySelectorAll('canvas')).toHaveLength(1);
  });

  it('Box tool records backdrop clicks but ignores clicks inside the modal box', async () => {
    const modal = await openModal();
    armTool(modal, 'box');

    clickAt(modal.textarea, 5, 5);
    expect(getToolState()).toMatchObject({ kind: 'box', clicks: 0 });

    clickAt(modal.overlay, 10, 20);
    clickAt(modal.overlay, 400, 500);
    expect(getAnnotationQueue()).toEqual([{ kind: 'box', path: [[10, 20], [400, 500]] }]);
  });

  it('Freehand tool records a stroke whose pointerdown targets the modal backdrop', async () => {
    const modal = await openModal();
    armTool(modal, 'freehand');
    expect(modal.overlay.style.touchAction).toBe('none');

    const ptr = (type: string, x: number, y: number) =>
      modal.overlay.dispatchEvent(
        new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1 })
      );
    ptr('pointerdown', 50, 50);
    ptr('pointermove', 60, 55);
    ptr('pointermove', 70, 65);
    ptr('pointerup', 70, 65);
    // The click that follows the stroke also lands on the backdrop; it
    // must not reopen anything.
    clickAt(modal.overlay, 70, 65);

    expect(getAnnotationQueue()).toEqual([
      { kind: 'freehand', path: [[50, 50], [60, 55], [70, 65]] },
    ]);
    expect(getCurrentModal()).toBe(modal);
    expect(modal.overlay.style.touchAction).toBe('');
  });

  // ---------- showModal re-entrancy while the screenshot is capturing ----------

  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('ignores a second click while the first screenshot is still capturing', async () => {
    const capture = deferred<Blob>();
    vi.mocked(captureViewport).mockClear();
    vi.mocked(captureViewport).mockImplementationOnce(() => capture.promise);
    const target = document.createElement('div');
    document.body.appendChild(target);

    const first = showModal(100, 120, target, 'A', 'u', 'k', 'p');
    const second = showModal(400, 300, target, 'A', 'u', 'k', 'p');
    await second;
    capture.resolve(new Blob(['x'], { type: 'image/png' }));
    await first;

    expect(document.querySelectorAll('textarea')).toHaveLength(1);
    expect(document.querySelectorAll('[id^="markup-pin-"]')).toHaveLength(1);
    expect(getPendingClick()).toMatchObject({ clickX: 100, clickY: 120 });
    expect(vi.mocked(captureViewport)).toHaveBeenCalledTimes(1);
  });

  it('does not open the modal if it was dismissed while capturing (hideModal)', async () => {
    const capture = deferred<Blob>();
    vi.mocked(captureViewport).mockImplementationOnce(() => capture.promise);
    const target = document.createElement('div');
    document.body.appendChild(target);

    const opening = showModal(100, 100, target, 'A', 'u', 'k', 'p');
    hideModal();
    capture.resolve(new Blob(['x'], { type: 'image/png' }));
    await opening;

    expect(getCurrentModal()).toBeNull();
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.querySelector('[id^="markup-pin-"]')).toBeNull();

    // And the guard is released: the next click opens normally.
    await showModal(200, 200, target, 'A', 'u', 'k', 'p');
    expect(getCurrentModal()).not.toBeNull();
  });

  it('turning feedback mode off during capture keeps the modal closed (lifecycle)', async () => {
    const lifecycle = await import('../../src/widget/lifecycle');
    const script = document.createElement('script');
    script.setAttribute('src', 'https://x.example/widget.js');
    script.setAttribute('data-api-key', 'mk_test');
    script.setAttribute('data-project-id', 'proj-1');
    document.head.appendChild(script);
    lifecycle.init();
    try {
      const capture = deferred<Blob>();
      vi.mocked(captureViewport).mockImplementationOnce(() => capture.promise);
      const target = document.createElement('div');
      document.body.appendChild(target);

      lifecycle.startFeedback();
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 30, clientY: 40 }));
      // Placeholder pin while capturing.
      expect(document.querySelector('[id^="markup-pin-"]')).not.toBeNull();
      lifecycle.stopFeedback();
      capture.resolve(new Blob(['x'], { type: 'image/png' }));
      await flush();

      expect(getCurrentModal()).toBeNull();
      expect(document.querySelector('textarea')).toBeNull();
      expect(document.querySelector('[id^="markup-pin-"]')).toBeNull();
    } finally {
      lifecycle.destroy();
    }
  });

  // ---------- Save button while the POST is in flight ----------

  it('keeps Save disabled while saving even if the user keeps typing (no duplicate pins)', async () => {
    const originalFetch = global.fetch;
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = deferred<Response>();
    const fetchMock = vi.fn(() => response.promise);
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      const modal = await openModal();
      modal.textarea.value = 'first draft';
      modal.textarea.dispatchEvent(new Event('input', { bubbles: true }));
      expect(modal.submitBtn.disabled).toBe(false);

      modal.submitBtn.click();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(modal.submitBtn.disabled).toBe(true);
      expect(modal.submitBtn.textContent).toBe('Saving...');

      // Typing mid-save used to re-enable the button.
      modal.textarea.value = 'first draft, edited';
      modal.textarea.dispatchEvent(new Event('input', { bubbles: true }));
      expect(modal.submitBtn.disabled).toBe(true);
      // Neither the shortcut nor a forced handler call starts a second POST.
      modal.textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
      await (modal.submitBtn.onclick as (e: MouseEvent) => Promise<void>)(new MouseEvent('click'));
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // A failed save re-enables Save so the user can retry.
      response.resolve(new Response('boom', { status: 500 }));
      await flush();
      expect(alertSpy).toHaveBeenCalled();
      expect(modal.submitBtn.disabled).toBe(false);
      expect(modal.submitBtn.textContent).toBe('Save pin');
    } finally {
      global.fetch = originalFetch;
      alertSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
