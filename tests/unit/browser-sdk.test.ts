/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkupSDK } from '../../packages/markup-sdk/src/index';

const PROJECT_ID = '30000000-0000-4000-8000-000000000001';
const API_KEY = `mk_${'a'.repeat(40)}`;

describe('MarkupSDK browser loader', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    delete (window as Window & { MarkupWidget?: unknown }).MarkupWidget;
  });

  it('validates host, project id, and browser key before touching the DOM', () => {
    expect(() => new MarkupSDK({ host: 'http://feedback.example', projectId: PROJECT_ID, apiKey: API_KEY })).toThrow(/https/i);
    expect(() => new MarkupSDK({ host: 'https://feedback.example', projectId: 'bad', apiKey: API_KEY })).toThrow(/projectId/);
    expect(() => new MarkupSDK({ host: 'https://feedback.example', projectId: PROJECT_ID, apiKey: 'bad' })).toThrow(/apiKey/);
    expect(document.querySelector('script')).toBeNull();
  });

  it('mounts once with safe attributes and controls the supported widget lifecycle', async () => {
    const startFeedback = vi.fn();
    const stopFeedback = vi.fn();
    const destroy = vi.fn();
    const getState = vi.fn(() => ({ ready: true, feedbackMode: false }));
    const sdk = new MarkupSDK({
      host: 'https://feedback.example/', projectId: PROJECT_ID, apiKey: API_KEY, authorName: 'Cam',
    });
    const mounted = sdk.mount();
    const script = document.querySelector('script') as HTMLScriptElement;
    expect(script.src).toBe('https://feedback.example/widget.js');
    expect(script.dataset.projectId).toBe(PROJECT_ID);
    expect(script.dataset.apiKey).toBe(API_KEY);
    expect(script.dataset.author).toBe('Cam');
    (window as Window & { MarkupWidget: unknown }).MarkupWidget = { startFeedback, stopFeedback, destroy, getState };
    document.dispatchEvent(new CustomEvent('markup:ready', { detail: { projectId: PROJECT_ID } }));
    await expect(mounted).resolves.toEqual({ ready: true, feedbackMode: false });
    await expect(sdk.mount()).resolves.toEqual({ ready: true, feedbackMode: false });
    expect(document.querySelectorAll('script')).toHaveLength(1);
    sdk.startFeedback();
    sdk.stopFeedback();
    expect(startFeedback).toHaveBeenCalledOnce();
    expect(stopFeedback).toHaveBeenCalledOnce();
    sdk.destroy();
    expect(destroy).toHaveBeenCalledOnce();
    expect(document.querySelector('script')).toBeNull();
  });

  it('subscribes and unsubscribes typed lifecycle events', () => {
    const sdk = new MarkupSDK({ host: 'http://localhost:3030', projectId: PROJECT_ID, apiKey: API_KEY });
    const listener = vi.fn();
    const off = sdk.on('submitted', listener);
    document.dispatchEvent(new CustomEvent('markup:submitted', { detail: { pinId: 'pin-1' } }));
    expect(listener).toHaveBeenCalledWith({ pinId: 'pin-1' });
    off();
    document.dispatchEvent(new CustomEvent('markup:submitted', { detail: { pinId: 'pin-2' } }));
    expect(listener).toHaveBeenCalledOnce();
  });
});
