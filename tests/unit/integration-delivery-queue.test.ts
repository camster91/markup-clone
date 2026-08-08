import { describe, expect, it, vi } from 'vitest';
import {
  enqueuePinCreatedEvent,
  processDeliveryBatch,
  type DeliveryClaim,
  type DeliveryRecordedOutcome,
  type DeliveryStore,
} from '@/lib/integrations/delivery-queue';
import type { DeliveryDispatchResult } from '@/lib/integrations/dispatcher';
import type { IssueHandoffV1 } from '@/lib/issue-handoff';
import { encryptIntegrationCredential } from '@/lib/integrations/credential-crypto';

const issue: IssueHandoffV1 = {
  schema: 'visual-feedback.issue.v1',
  title: 'Fix the header',
  pin: {
    id: 'pin-1', status: 'OPEN', createdAt: '2026-08-08T04:00:00.000Z',
    coordinates: { xPercent: 25, yPercent: 75 },
  },
  project: { id: 'project-1', name: 'Acme', domain: 'example.com' },
  page: { path: '/', url: 'https://example.com/' },
  reviewUrl: 'https://review.example.test/projects/project-1?pin=pin-1',
  screenshot: { id: 'shot-1', width: 1, height: 1, capturedAt: '2026-08-08T04:00:00.000Z' },
  reviewRound: null,
  environment: null,
  selectors: [],
  elementSnippet: null,
  internal: { priority: 'NONE', assignee: null, tags: [] },
  commentCount: 1,
  commentsTruncated: false,
  comments: [{
    id: 'comment-1', author: 'Client', authorRole: 'client', text: 'Fix the header',
    createdAt: '2026-08-08T04:00:00.000Z', attachments: [],
  }],
};

function eventJson(id = 'event-1'): string {
  return JSON.stringify({
    schema: 'visual-feedback.event.v1',
    id,
    type: 'pin.created',
    occurredAt: '2026-08-08T04:00:00.000Z',
    project: issue.project,
    data: { issue },
  });
}

function claim(overrides: Partial<DeliveryClaim> = {}): DeliveryClaim {
  return {
    id: 'delivery-1',
    attemptCount: 0,
    retryCycle: 0,
    lockedBy: 'worker-1',
    integration: {
      id: 'integration-1',
      kind: 'webhook',
      configJson: JSON.stringify({
        url: 'https://receiver.example/hook',
        headers: { Authorization: 'Bearer receiver-super-secret' },
      }),
      signingSecret: 'signing-super-secret',
      credentialCiphertext: null,
    },
    event: { id: 'event-1', type: 'pin.created', payloadJson: eventJson() },
    ...overrides,
  };
}

function storeFor(claims: DeliveryClaim[]) {
  const recorded: DeliveryRecordedOutcome[] = [];
  const store: DeliveryStore = {
    claimDue: vi.fn(async () => claims),
    recordOutcome: vi.fn(async (_claim, outcome) => { recorded.push(outcome); }),
  };
  return { store, recorded };
}

describe('transactional integration outbox', () => {
  it('persists one immutable event and one pending delivery per configured target', async () => {
    const create = vi.fn(async ({ data }) => ({ id: data.id }));
    const tx = {
      integration: { findMany: vi.fn(async () => [{ id: 'int-1' }, { id: 'int-2' }]) },
      integrationEvent: { create },
    };

    const result = await enqueuePinCreatedEvent(tx, {
      projectId: 'project-1',
      eventId: 'event-1',
      occurredAt: '2026-08-08T04:00:00.000Z',
      issue,
    });

    expect(result).toEqual({ eventId: 'event-1', deliveryCount: 2 });
    expect(tx.integration.findMany).toHaveBeenCalledWith({
      where: { projectId: 'project-1' }, select: { id: true },
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'event-1',
        projectId: 'project-1',
        schema: 'visual-feedback.event.v1',
        type: 'pin.created',
        occurredAt: new Date('2026-08-08T04:00:00.000Z'),
        payloadJson: eventJson(),
        deliveries: {
          create: [{ integrationId: 'int-1' }, { integrationId: 'int-2' }],
        },
      }),
    });
  });

  it('does not retain an event when the project has no configured targets', async () => {
    const tx = {
      integration: { findMany: vi.fn(async () => []) },
      integrationEvent: { create: vi.fn() },
    };
    await expect(enqueuePinCreatedEvent(tx, {
      projectId: 'project-1', eventId: 'event-1', occurredAt: issue.pin.createdAt, issue,
    })).resolves.toBeNull();
    expect(tx.integrationEvent.create).not.toHaveBeenCalled();
  });
});

describe('durable integration delivery processor', () => {
  it('records successful attempts and returns a bounded batch summary', async () => {
    const { store, recorded } = storeFor([claim()]);
    const dispatch = vi.fn(async (): Promise<DeliveryDispatchResult> => ({
      ok: true, statusCode: 204,
    }));
    const now = new Date('2026-08-08T04:00:00.000Z');

    const result = await processDeliveryBatch({
      store, dispatch, workerId: 'worker-1', now, batchSize: 999,
    });

    expect(store.claimDue).toHaveBeenCalledWith({ workerId: 'worker-1', now, batchSize: 50 });
    expect(result).toEqual({ claimed: 1, succeeded: 1, retryScheduled: 0, deadLettered: 0 });
    expect(recorded).toEqual([expect.objectContaining({
      status: 'SUCCEEDED', attemptNumber: 1, statusCode: 204,
    })]);
  });

  it('schedules a retry, then dead-letters a retryable fifth failure', async () => {
    const { store, recorded } = storeFor([
      claim({ id: 'delivery-1', attemptCount: 0 }),
      claim({ id: 'delivery-2', attemptCount: 4 }),
    ]);
    const dispatch = vi.fn(async (): Promise<DeliveryDispatchResult> => ({
      ok: false, error: 'receiver unavailable', retryable: true, statusCode: 503,
    }));

    const result = await processDeliveryBatch({
      store, dispatch, workerId: 'worker-1', now: new Date('2026-08-08T04:00:00.000Z'),
    });

    expect(result).toEqual({ claimed: 2, succeeded: 0, retryScheduled: 1, deadLettered: 1 });
    expect(recorded[0]).toEqual(expect.objectContaining({
      status: 'RETRY_SCHEDULED',
      attemptNumber: 1,
      nextAttemptAt: new Date('2026-08-08T04:01:00.000Z'),
    }));
    expect(recorded[1]).toEqual(expect.objectContaining({
      status: 'DEAD_LETTER', attemptNumber: 5, nextAttemptAt: null,
    }));
  });

  it('dead-letters invalid stored data without calling an adapter', async () => {
    const { store, recorded } = storeFor([
      claim({ event: { id: 'event-1', type: 'pin.created', payloadJson: '{broken' } }),
      claim({ id: 'delivery-2', integration: { ...claim().integration, kind: 'unknown' } }),
    ]);
    const dispatch = vi.fn();

    const result = await processDeliveryBatch({ store, dispatch, workerId: 'worker-1' });

    expect(dispatch).not.toHaveBeenCalled();
    expect(result.deadLettered).toBe(2);
    expect(recorded[0].error).toBe('Stored event payload is invalid');
    expect(recorded[1].error).toBe('Stored integration kind is invalid');
  });

  it('redacts configured and signing secrets before recording errors', async () => {
    const { store, recorded } = storeFor([claim()]);
    const dispatch = vi.fn(async (): Promise<DeliveryDispatchResult> => ({
      ok: false,
      error: 'receiver echoed Bearer receiver-super-secret and signing-super-secret',
      retryable: false,
      statusCode: 401,
    }));

    await processDeliveryBatch({ store, dispatch, workerId: 'worker-1' });

    expect(recorded[0].status).toBe('DEAD_LETTER');
    const error = recorded[0].error ?? '';
    expect(error).toContain('[REDACTED]');
    expect(error).not.toContain('receiver-super-secret');
    expect(error).not.toContain('signing-super-secret');
    expect(error.length).toBeLessThanOrEqual(1000);
  });

  it('opens a GitHub credential only in memory and retains the created issue reference', async () => {
    const key = Buffer.alloc(32, 3);
    const token = 'github_pat_private_delivery_token';
    const { store, recorded } = storeFor([claim({
      integration: {
        id: 'integration-github',
        kind: 'github',
        configJson: JSON.stringify({ owner: 'acme', repo: 'site', labels: ['feedback'] }),
        signingSecret: null,
        credentialCiphertext: encryptIntegrationCredential(token, key),
      },
    })]);
    const dispatch = vi.fn(async (_kind, config): Promise<DeliveryDispatchResult> => {
      expect(config).toEqual({ owner: 'acme', repo: 'site', labels: ['feedback'], token });
      return {
        ok: true,
        statusCode: 201,
        externalId: '42',
        externalUrl: 'https://github.com/acme/site/issues/42',
      };
    });

    await processDeliveryBatch({ store, dispatch, workerId: 'worker-1', credentialKey: key });

    expect(recorded[0]).toEqual(expect.objectContaining({
      status: 'SUCCEEDED',
      externalId: '42',
      externalUrl: 'https://github.com/acme/site/issues/42',
    }));
    expect(JSON.stringify(recorded)).not.toContain(token);
  });

  it('dead-letters a GitHub delivery when its encrypted credential is unavailable', async () => {
    const { store, recorded } = storeFor([claim({
      integration: {
        id: 'integration-github', kind: 'github',
        configJson: JSON.stringify({ owner: 'acme', repo: 'site', labels: [] }),
        signingSecret: null, credentialCiphertext: null,
      },
    })]);
    const dispatch = vi.fn();

    await processDeliveryBatch({
      store, dispatch, workerId: 'worker-1', credentialKey: Buffer.alloc(32, 3),
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(recorded[0]).toEqual(expect.objectContaining({
      status: 'DEAD_LETTER', error: 'GitHub credential is unavailable',
    }));
  });
});
