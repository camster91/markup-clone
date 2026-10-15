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

  it('boots on DOMContentLoaded when the snippet is in <head> and other scripts follow it', async () => {
    document.body.innerHTML = '';
    const tag = document.createElement('script');
    tag.src = 'https://feedback.example/widget.js';
    tag.setAttribute('data-api-key', `mk_${'b'.repeat(40)}`);
    tag.setAttribute('data-project-id', '30000000-0000-4000-8000-000000000002');
    document.head.appendChild(tag);
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
    Object.defineProperty(document, 'currentScript', { value: tag, configurable: true });
    const lifecycle = await import('@/widget/lifecycle');
    try {
      lifecycle.boot();
      // Script evaluation is over; the parser carries on into <body>.
      Object.defineProperty(document, 'currentScript', { value: null, configurable: true });
      const trailing = document.createElement('script');
      trailing.src = 'https://analytics.example/a.js';
      document.body.appendChild(trailing);
      expect(lifecycle.getState().ready).toBe(false);

      document.dispatchEvent(new Event('DOMContentLoaded'));

      expect(lifecycle.getState().ready).toBe(true);
      expect(lifecycle.getConfig()).toMatchObject({
        apiKey: `mk_${'b'.repeat(40)}`,
        projectId: '30000000-0000-4000-8000-000000000002',
        apiUrl: 'https://feedback.example/api/pins',
      });
    } finally {
      lifecycle.destroy();
      delete (document as unknown as Record<string, unknown>).readyState;
      delete (document as unknown as Record<string, unknown>).currentScript;
    }
  });
});
