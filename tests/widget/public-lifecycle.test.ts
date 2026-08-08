/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('widget supported public lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    delete (window as Window & { MarkupWidget?: unknown }).MarkupWidget;
    document.head.innerHTML = '';
    document.body.innerHTML = `<script src="https://feedback.example/widget.js" data-api-key="mk_${'a'.repeat(40)}" data-project-id="30000000-0000-4000-8000-000000000001"></script>`;
  });

  it('emits ready/mode events and removes listeners and UI on destroy', async () => {
    const ready = vi.fn();
    const mode = vi.fn();
    document.addEventListener('markup:ready', ready);
    document.addEventListener('markup:modechange', mode);
    const lifecycle = await import('@/widget/lifecycle');
    lifecycle.init();
    expect(ready).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.objectContaining({ ready: true }) }));
    expect(lifecycle.getState()).toEqual({ ready: true, feedbackMode: false });
    lifecycle.startFeedback();
    expect(lifecycle.getState().feedbackMode).toBe(true);
    lifecycle.stopFeedback();
    expect(mode).toHaveBeenLastCalledWith(expect.objectContaining({ detail: { feedbackMode: false } }));
    lifecycle.destroy();
    expect(document.getElementById('markup-toggle')).toBeNull();
    expect(lifecycle.getState()).toEqual({ ready: false, feedbackMode: false });
  });

  it('publishes the lifecycle API on the browser global used by the SDK', async () => {
    await import('@/widget/index');
    const widget = (window as Window & { MarkupWidget?: Record<string, unknown> }).MarkupWidget;
    expect(widget).toMatchObject({
      startFeedback: expect.any(Function),
      stopFeedback: expect.any(Function),
      getState: expect.any(Function),
      destroy: expect.any(Function),
    });
  });
});
