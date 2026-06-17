/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showModal, getCurrentModal, getPendingClick } from '../../src/widget/form';

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
});
