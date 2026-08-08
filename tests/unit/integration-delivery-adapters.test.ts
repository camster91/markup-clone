import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/safe-url', () => ({
  assertSafeOutboundUrl: vi.fn(async (url: string) => ({ ok: true, value: url })),
}));

import { dispatchDelivery } from '@/lib/integrations/dispatcher';
import { postEvent as postWebhookEvent } from '@/lib/integrations/webhook';
import type { PinCreatedEventV1 } from '@/lib/integrations/events';
import type { IntegrationDeliveryPayload } from '@/lib/integrations/types';

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
      pin: {
        id: 'pin-1', status: 'OPEN', createdAt: '2026-08-08T04:00:00.000Z',
        coordinates: { xPercent: 20, yPercent: 70 },
      },
      project: { id: 'project-1', name: 'Acme Site', domain: 'example.com' },
      page: { path: '/pricing', url: 'https://example.com/pricing' },
      reviewUrl: 'https://review.example.test/projects/project-1?pin=pin-1',
      screenshot: {
        id: 'shot-1', width: 1280, height: 720, capturedAt: '2026-08-08T03:59:00.000Z',
      },
      reviewRound: null,
      environment: null,
      selectors: [],
      elementSnippet: null,
      internal: { priority: 'NONE', assignee: null, tags: [] },
      commentCount: 1,
      commentsTruncated: false,
      comments: [{
        id: 'comment-1', author: 'Client', authorRole: 'client',
        text: 'Please align the CTA', createdAt: '2026-08-08T04:00:00.000Z', attachments: [],
      }],
    },
  },
};

const delivery: IntegrationDeliveryPayload = {
  event,
  payloadJson: JSON.stringify(event),
  deliveryId: 'delivery-1',
  signingSecret: 'test-secret',
  timestamp: '1723075200',
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 204,
    headers: new Headers(),
    text: async () => '',
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('versioned delivery adapters', () => {
  it('sends the exact persisted webhook body with protected signature headers and timeout', async () => {
    await postWebhookEvent({
      url: 'https://receiver.example/hook',
      headers: { Authorization: 'Bearer receiver', 'x-visual-feedback-signature': 'forged' },
    }, delivery);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://receiver.example/hook');
    expect(init.body).toBe(delivery.payloadJson);
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers.Authorization).toBe('Bearer receiver');
    expect(init.headers['X-Visual-Feedback-Signature']).toMatch(/^v1=[a-f0-9]{64}$/);
    expect(init.headers['x-visual-feedback-signature']).toBeUndefined();
  });

  it('maps the v1 issue into the existing useful Slack presentation', async () => {
    const result = await dispatchDelivery(
      'slack',
      { webhookUrl: 'https://hooks.slack.com/services/test' },
      { ...delivery, signingSecret: null },
    );

    expect(result).toEqual({ ok: true, statusCode: 204 });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toContain('Acme Site');
    expect(body.blocks[0].text.text).toContain('/pricing');
    expect(body.blocks[0].text.text).toContain('Please align the CTA');
    expect(body.blocks[1].elements[0].text).toContain('20%, 70%');
  });

  it('returns structured retry metadata for a rate-limited receiver', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ 'Retry-After': '120' }),
      text: async () => 'slow down; internal token must not be stored',
    });

    const result = await dispatchDelivery(
      'webhook',
      { url: 'https://receiver.example/hook' },
      delivery,
    );

    expect(result).toEqual({
      ok: false,
      error: 'Webhook returned 429',
      statusCode: 429,
      retryable: true,
      retryAfter: '120',
    });
    expect(JSON.stringify(result)).not.toContain('internal token must not be stored');
  });

  it('marks permanent receiver errors non-retryable and network failures retryable', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 401, headers: new Headers(), text: async () => 'unauthorized',
    });
    await expect(dispatchDelivery(
      'discord',
      { webhookUrl: 'https://discord.com/api/webhooks/test' },
      { ...delivery, signingSecret: null },
    )).resolves.toEqual(expect.objectContaining({
      ok: false, statusCode: 401, retryable: false,
    }));

    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(dispatchDelivery(
      'slack',
      { webhookUrl: 'https://hooks.slack.com/services/test' },
      { ...delivery, signingSecret: null },
    )).resolves.toEqual({
      ok: false, error: 'fetch failed', retryable: true,
    });
  });

  it('fails closed when a generic webhook has no signing secret', async () => {
    await expect(dispatchDelivery(
      'webhook',
      { url: 'https://receiver.example/hook' },
      { ...delivery, signingSecret: null },
    )).resolves.toEqual({
      ok: false,
      error: 'Webhook signing secret is missing',
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
