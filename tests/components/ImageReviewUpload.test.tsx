// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReviewAssetUpload from '@/components/ReviewAssetUpload';

const fetchMock = vi.fn();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ReviewAssetUpload', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('uploads an allowlisted image and refreshes the review after success', async () => {
    const onUploaded = vi.fn();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 201 }));
    await act(async () => root.render(<ReviewAssetUpload projectId="11111111-1111-1111-1111-111111111111" onUploaded={onUploaded} />));

    const input = container.querySelector('[aria-label="Upload image or PDF for review"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['image'], 'homepage.png', { type: 'image/png' })] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === 'Upload for review');
    await act(async () => button?.click());

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/11111111-1111-1111-1111-111111111111/images',
      expect.objectContaining({ method: 'POST', body: expect.any(FormData) })
    );
    expect(onUploaded).toHaveBeenCalledTimes(1);
  });

  it('shows a local format error without uploading unsupported files', async () => {
    await act(async () => root.render(<ReviewAssetUpload projectId="11111111-1111-1111-1111-111111111111" onUploaded={vi.fn()} />));

    const input = container.querySelector('[aria-label="Upload image or PDF for review"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['<svg />'], 'unsafe.svg', { type: 'image/svg+xml' })] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === 'Upload for review');
    await act(async () => button?.click());

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('PNG, JPEG, GIF, WebP, or PDF');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends PDFs to the document endpoint and exposes the rendering state', async () => {
    let finishResponse!: (value: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => { finishResponse = resolve; }));
    const onUploaded = vi.fn();
    await act(async () => root.render(<ReviewAssetUpload projectId="11111111-1111-1111-1111-111111111111" onUploaded={onUploaded} />));

    const input = container.querySelector('[aria-label="Upload image or PDF for review"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['%PDF-1.7'], 'proof.pdf', { type: 'application/pdf' })] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === 'Upload for review');
    await act(async () => button?.click());

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/11111111-1111-1111-1111-111111111111/documents',
      expect.objectContaining({ method: 'POST', body: expect.any(FormData) }),
    );
    expect(container.textContent).toContain('Rendering PDF...');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Rendering pages in order');

    await act(async () => finishResponse(new Response(JSON.stringify({ success: true }), { status: 201 })));
    expect(onUploaded).toHaveBeenCalledTimes(1);
  });
});
