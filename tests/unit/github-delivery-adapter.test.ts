import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchDelivery } from '@/lib/integrations/dispatcher';
import type { PinCreatedEventV1 } from '@/lib/integrations/events';
import {
  githubEventMarker,
  postEvent,
  verifyGithubRepository,
} from '@/lib/integrations/github';

const event: PinCreatedEventV1 = {
  schema: 'visual-feedback.event.v1',
  id: 'event-1',
  type: 'pin.created',
  occurredAt: '2026-08-08T04:00:00.000Z',
  project: { id: 'project-1', name: 'Acme Site', domain: 'example.com' },
  data: {
    issue: {
      schema: 'visual-feedback.issue.v1',
      title: 'Please align the CTA',
      pin: { id: 'pin-1', status: 'OPEN', createdAt: '2026-08-08T04:00:00.000Z', coordinates: { xPercent: 20, yPercent: 70 } },
      project: { id: 'project-1', name: 'Acme Site', domain: 'example.com' },
      page: { path: '/pricing', url: 'https://example.com/pricing' },
      reviewUrl: 'https://review.example.test/projects/project-1?pin=pin-1',
      screenshot: { id: 'shot-1', width: 1280, height: 720, capturedAt: '2026-08-08T03:59:00.000Z' },
      reviewRound: null,
      environment: null,
      selectors: [],
      elementSnippet: null,
      internal: { priority: 'HIGH', assignee: null, tags: [] },
      commentCount: 1,
      commentsTruncated: false,
      comments: [{ id: 'comment-1', author: 'Client', authorRole: 'client', text: 'Please align the CTA', createdAt: '2026-08-08T04:00:00.000Z', attachments: [] }],
    },
  },
};

const delivery = {
  event,
  payloadJson: JSON.stringify(event),
  deliveryId: 'delivery-1',
  signingSecret: null,
  timestamp: '1786161600',
};

const config = {
  owner: 'acme-agency',
  repo: 'client-site',
  labels: ['visual-feedback', 'bug'],
  token: 'github_pat_private_token_value',
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('GitHub delivery adapter', () => {
  it('creates a developer-ready issue with a stable dedupe marker', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers(),
        json: async () => ({ number: 42, html_url: 'https://github.com/acme-agency/client-site/issues/42' }),
      });

    await expect(postEvent(config, delivery)).resolves.toEqual({
      statusCode: 201,
      externalId: '42',
      externalUrl: 'https://github.com/acme-agency/client-site/issues/42',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/acme-agency/client-site/issues?state=all&sort=created&direction=desc&per_page=100',
    );
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://api.github.com/repos/acme-agency/client-site/issues');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.headers.Authorization).toBe('Bearer github_pat_private_token_value');
    expect(init.headers['X-GitHub-Api-Version']).toBe('2026-03-10');
    const body = JSON.parse(init.body);
    expect(body.title).toBe('Please align the CTA');
    expect(body.labels).toEqual(['visual-feedback', 'bug']);
    expect(body.body).toContain('[Open the exact feedback pin]');
    expect(body.body).toContain(githubEventMarker('event-1'));
  });

  it('reuses an existing marked issue instead of creating a duplicate', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => [{
        number: 17,
        html_url: 'https://github.com/acme-agency/client-site/issues/17',
        body: `Existing issue\n${githubEventMarker('event-1')}`,
      }],
    });

    await expect(postEvent(config, delivery)).resolves.toEqual({
      statusCode: 200,
      externalId: '17',
      externalUrl: 'https://github.com/acme-agency/client-site/issues/17',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('verifies repository access without creating an issue', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ full_name: 'acme-agency/client-site', has_issues: true }),
    });

    await expect(verifyGithubRepository(config)).resolves.toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/acme-agency/client-site',
      expect.objectContaining({ method: 'GET', redirect: 'error' }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps GitHub response bodies and tokens out of permanent errors', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: new Headers(),
      json: async () => ({ message: 'echo github_pat_private_token_value' }),
    });

    const result = await dispatchDelivery('github', config, delivery);
    expect(result).toEqual({
      ok: false,
      error: 'GitHub returned 401',
      statusCode: 401,
      retryable: false,
    });
    expect(JSON.stringify(result)).not.toContain(config.token);
  });

  it('retries a GitHub 403 carrying a retry delay', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      headers: new Headers({ 'Retry-After': '60' }),
      json: async () => ({ message: 'secondary rate limit' }),
    });

    await expect(dispatchDelivery('github', config, delivery)).resolves.toEqual({
      ok: false,
      error: 'GitHub returned 403',
      statusCode: 403,
      retryable: true,
      retryAfter: '60',
    });
  });
});
