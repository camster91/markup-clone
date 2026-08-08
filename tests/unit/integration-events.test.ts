import { describe, expect, it } from 'vitest';
import {
  buildPinCreatedEventV1,
  serializeIntegrationEvent,
} from '@/lib/integrations/events';
import {
  buildSignedWebhookHeaders,
  generateWebhookSigningSecret,
  signWebhookPayload,
} from '@/lib/integrations/signing';
import {
  classifyDeliveryStatus,
  nextRetryAt,
} from '@/lib/integrations/retry';
import type { IssueHandoffV1 } from '@/lib/issue-handoff';

const issue: IssueHandoffV1 = {
  schema: 'visual-feedback.issue.v1',
  title: 'Align the pricing CTA',
  pin: {
    id: 'pin-1',
    status: 'OPEN',
    createdAt: '2026-08-08T04:00:00.000Z',
    coordinates: { xPercent: 25, yPercent: 50 },
  },
  project: { id: 'project-1', name: 'Acme', domain: 'example.com' },
  page: { path: '/pricing', url: 'https://example.com/pricing' },
  reviewUrl: 'https://review.example.test/projects/project-1?pin=pin-1',
  screenshot: {
    id: 'shot-1', width: 1440, height: 900, capturedAt: '2026-08-08T03:59:00.000Z',
  },
  reviewRound: { id: 'round-1', number: 2, name: 'Launch review' },
  environment: {
    viewport: { width: 1440, height: 900, devicePixelRatio: 2 },
    browser: 'Chrome 126',
    platform: 'Windows',
  },
  selectors: ['#pricing-cta'],
  elementSnippet: '<button>Start</button>',
  internal: {
    priority: 'HIGH',
    assignee: { id: 'user-1', email: 'dev@example.com' },
    tags: [{ id: 'tag-1', name: 'Frontend', key: 'frontend' }],
  },
  commentCount: 1,
  commentsTruncated: false,
  comments: [{
    id: 'comment-1',
    author: 'Client',
    authorRole: 'client',
    text: 'Please align this CTA.',
    createdAt: '2026-08-08T04:00:00.000Z',
    attachments: [],
  }],
};

describe('versioned integration events', () => {
  it('wraps the privacy-bounded issue contract in a stable pin.created envelope', () => {
    const event = buildPinCreatedEventV1({
      eventId: 'event-1',
      occurredAt: '2026-08-08T04:00:00.000Z',
      issue,
    });

    expect(event).toEqual({
      schema: 'visual-feedback.event.v1',
      id: 'event-1',
      type: 'pin.created',
      occurredAt: '2026-08-08T04:00:00.000Z',
      project: issue.project,
      data: { issue },
    });
    expect(serializeIntegrationEvent(event)).toBe(JSON.stringify(event));
    expect(serializeIntegrationEvent(event)).not.toMatch(/apiKey|shareToken|sessionToken/i);
  });

  it('rejects mismatched, invalid, or unbounded envelope identifiers', () => {
    expect(() => buildPinCreatedEventV1({ eventId: '', occurredAt: issue.pin.createdAt, issue }))
      .toThrow('eventId');
    expect(() => buildPinCreatedEventV1({ eventId: 'x'.repeat(129), occurredAt: issue.pin.createdAt, issue }))
      .toThrow('eventId');
    expect(() => buildPinCreatedEventV1({ eventId: 'event-1', occurredAt: 'not-a-date', issue }))
      .toThrow('occurredAt');
  });
});

describe('generic webhook signatures', () => {
  it('signs timestamp dot exact-body with HMAC-SHA256', () => {
    expect(signWebhookPayload('test-secret', '1723075200', '{"hello":"world"}')).toBe(
      'a64687eb9d31c45275421e94fd461dd5fdabb496f4cf0cd629d6208b978d8120',
    );
  });

  it('protects system headers from case-insensitive operator overrides', () => {
    const headers = buildSignedWebhookHeaders({
      operatorHeaders: {
        Authorization: 'Bearer operator-token',
        'content-type': 'text/plain',
        'x-visual-feedback-signature': 'forged',
        'X-Visual-Feedback-Delivery': 'wrong-delivery',
      },
      secret: 'test-secret',
      timestamp: '1723075200',
      payloadJson: '{"hello":"world"}',
      eventId: 'event-1',
      eventType: 'pin.created',
      deliveryId: 'delivery-1',
    });

    expect(headers.Authorization).toBe('Bearer operator-token');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-Visual-Feedback-Event']).toBe('pin.created');
    expect(headers['X-Visual-Feedback-Event-Id']).toBe('event-1');
    expect(headers['X-Visual-Feedback-Delivery']).toBe('delivery-1');
    expect(headers['X-Visual-Feedback-Timestamp']).toBe('1723075200');
    expect(headers['X-Visual-Feedback-Signature']).toBe(
      'v1=a64687eb9d31c45275421e94fd461dd5fdabb496f4cf0cd629d6208b978d8120',
    );
    expect(Object.keys(headers).filter((key) => key.toLowerCase() === 'content-type')).toHaveLength(1);
  });

  it('generates a 32-byte base64url secret suitable for one-time reveal', () => {
    const first = generateWebhookSigningSecret();
    const second = generateWebhookSigningSecret();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
  });
});

describe('bounded delivery retry policy', () => {
  it.each([408, 409, 425, 429, 500, 503])('retries HTTP %s', (status) => {
    expect(classifyDeliveryStatus(status)).toBe('retry');
  });

  it.each([200, 201, 204])('accepts HTTP %s', (status) => {
    expect(classifyDeliveryStatus(status)).toBe('success');
  });

  it.each([400, 401, 403, 404, 422])('dead-letters permanent HTTP %s', (status) => {
    expect(classifyDeliveryStatus(status)).toBe('permanent');
  });

  it('uses the bounded exponential schedule after each failed attempt', () => {
    const now = new Date('2026-08-08T04:00:00.000Z');
    expect(nextRetryAt(1, now).toISOString()).toBe('2026-08-08T04:01:00.000Z');
    expect(nextRetryAt(2, now).toISOString()).toBe('2026-08-08T04:05:00.000Z');
    expect(nextRetryAt(3, now).toISOString()).toBe('2026-08-08T04:30:00.000Z');
    expect(nextRetryAt(4, now).toISOString()).toBe('2026-08-08T06:00:00.000Z');
    expect(() => nextRetryAt(5, now)).toThrow('No retry');
  });

  it('honors numeric and HTTP-date Retry-After values up to six hours', () => {
    const now = new Date('2026-08-08T04:00:00.000Z');
    expect(nextRetryAt(1, now, '120').toISOString()).toBe('2026-08-08T04:02:00.000Z');
    expect(nextRetryAt(1, now, 'Sat, 08 Aug 2026 04:03:00 GMT').toISOString())
      .toBe('2026-08-08T04:03:00.000Z');
    expect(nextRetryAt(1, now, '999999').toISOString()).toBe('2026-08-08T10:00:00.000Z');
  });
});
