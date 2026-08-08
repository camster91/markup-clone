// @vitest-environment jsdom

import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { IntegrationsSection } from '@/components/ProjectSettings';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const fetchMock = vi.fn();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('IntegrationsSection reliable delivery UX', () => {
  it('shows delivery activity, retries a dead letter, and reveals a webhook secret once', async () => {
    const delivery = {
      id: 'delivery-1', status: 'DEAD_LETTER', attemptCount: 5, retryCycle: 0,
      nextAttemptAt: '2026-08-08T04:00:00.000Z', deliveredAt: null,
      lastStatusCode: 503, lastError: 'Webhook returned 503',
      createdAt: '2026-08-08T03:00:00.000Z', updatedAt: '2026-08-08T04:00:00.000Z',
      integration: { id: 'integration-1', kind: 'webhook' },
      event: { id: 'event-1', type: 'pin.created', occurredAt: '2026-08-08T03:00:00.000Z' },
    };
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/integrations/deliveries/delivery-1/retry')) return json({ queued: true });
      if (url.endsWith('/integrations/deliveries')) return json([delivery]);
      if (url.endsWith('/integrations') && init?.method === 'POST') {
        return json({
          id: 'integration-2', kind: 'webhook',
          signingSecret: 'one-time-signing-secret-abcdefghijklmnopqrstuvwxyz',
        }, 201);
      }
      if (url.endsWith('/integrations')) return json([]);
      throw new Error(`Unexpected URL: ${url}`);
    });

    const container = document.getElementById('root')!;
    await act(async () => {
      root = createRoot(container);
      root.render(<IntegrationsSection projectId="project-1" />);
    });
    await settle();

    expect(container.textContent).toContain('Delivery activity');
    const showActivity = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Show activity');
    await act(async () => { showActivity?.click(); });
    await settle();
    expect(container.textContent).toContain('Dead letter');
    expect(container.textContent).toContain('Webhook returned 503');

    const retry = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Retry');
    expect(retry).toBeTruthy();
    await act(async () => { retry?.click(); });
    await settle();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/project-1/integrations/deliveries/delivery-1/retry',
      expect.objectContaining({ method: 'POST' }),
    );

    const select = container.querySelector('[data-testid="integration-kind"]') as HTMLSelectElement;
    await act(async () => {
      select.value = 'webhook';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    const url = container.querySelector('[data-testid="integration-url-input"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        ?.call(url, 'https://receiver.example/hook');
      url.dispatchEvent(new Event('input', { bubbles: true }));
      url.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(container.textContent).toContain('Copy this signing secret now');
    expect(container.textContent).toContain('one-time-signing-secret-abcdefghijklmnopqrstuvwxyz');
    expect(container.textContent).toContain('It will not be shown again');
  });

  it('configures an explicit GitHub repository and links a successful issue', async () => {
    const githubRow = {
      id: 'integration-github', projectId: 'project-1', kind: 'github',
      configJson: JSON.stringify({ owner: 'acme', repo: 'client-site', labels: ['feedback'] }),
      credentialConfigured: true,
      lastSuccessAt: null, lastError: null, lastErrorAt: null,
      createdAt: '2026-08-08T03:00:00.000Z',
    };
    const delivery = {
      id: 'delivery-github', status: 'SUCCEEDED', attemptCount: 1, retryCycle: 0,
      nextAttemptAt: '2026-08-08T04:00:00.000Z', deliveredAt: '2026-08-08T04:00:00.000Z',
      lastStatusCode: 201, lastError: null,
      externalId: '42', externalUrl: 'https://github.com/acme/client-site/issues/42',
      createdAt: '2026-08-08T03:00:00.000Z', updatedAt: '2026-08-08T04:00:00.000Z',
      integration: { id: 'integration-github', kind: 'github' },
      event: { id: 'event-1', type: 'pin.created', occurredAt: '2026-08-08T03:00:00.000Z' },
    };
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/integrations/deliveries')) return json([delivery]);
      if (url.endsWith('/integrations') && init?.method === 'POST') {
        return json({ id: 'integration-created', kind: 'github', configJson: '{}' }, 201);
      }
      if (url.endsWith('/integrations')) return json([githubRow]);
      throw new Error(`Unexpected URL: ${url}`);
    });

    const container = document.getElementById('root')!;
    await act(async () => {
      root = createRoot(container);
      root.render(<IntegrationsSection projectId="project-1" />);
    });
    await settle();
    expect(container.textContent).toContain('acme/client-site');
    expect(container.textContent).not.toContain('github_pat_private');
    const repository = container.querySelector('[data-testid="integration-url-integration-github"]');
    expect(repository?.classList.contains('break-all')).toBe(true);
    expect(repository?.classList.contains('truncate')).toBe(false);

    const select = container.querySelector('[data-testid="integration-kind"]') as HTMLSelectElement;
    await act(async () => {
      select.value = 'github';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    expect(container.textContent).toContain('Issues: write');

    const setValue = async (label: string, value: string) => {
      const input = container.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
      expect(input).toBeTruthy();
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    };
    await setValue('GitHub owner', 'acme');
    await setValue('GitHub repository', 'client-site');
    await setValue('GitHub labels', 'visual-feedback, bug');
    await setValue('GitHub token', 'github_pat_private_component_token');
    await act(async () => {
      container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();

    const createCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(createCall?.[1]?.body as string)).toEqual({
      kind: 'github',
      config: {
        owner: 'acme', repo: 'client-site', labels: ['visual-feedback', 'bug'],
        token: 'github_pat_private_component_token',
      },
    });

    const showActivity = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Show activity');
    await act(async () => { showActivity?.click(); });
    await settle();
    const issueLink = Array.from(container.querySelectorAll('a'))
      .find((link) => link.textContent?.startsWith('Open GitHub issue')) as HTMLAnchorElement;
    expect(issueLink.href).toBe('https://github.com/acme/client-site/issues/42');
    expect(issueLink.target).toBe('_blank');
    expect(issueLink.rel).toContain('noopener');
  });
});
