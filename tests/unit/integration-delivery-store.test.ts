import { describe, expect, it, vi } from 'vitest';
import { PrismaDeliveryStore } from '@/lib/integrations/prisma-delivery-store';
import type { DeliveryClaim, DeliveryRecordedOutcome } from '@/lib/integrations/delivery-queue';

const now = new Date('2026-08-08T04:00:00.000Z');

const claimed: DeliveryClaim = {
  id: 'delivery-1',
  attemptCount: 0,
  retryCycle: 0,
  lockedBy: 'worker-1',
  integration: {
    id: 'integration-1', kind: 'webhook', configJson: '{"url":"https://example.com"}',
    signingSecret: 'secret',
    credentialCiphertext: null,
  },
  event: { id: 'event-1', type: 'pin.created', payloadJson: '{}' },
};

describe('Postgres integration delivery store', () => {
  it('claims due and stale rows atomically with skip-locked concurrency protection', async () => {
    const queryRaw = vi.fn(async (query: unknown) => {
      expect(query).toBeDefined();
      return [{ id: 'delivery-1' }];
    });
    const prisma = {
      $transaction: vi.fn(async (callback) => callback({ $queryRaw: queryRaw })),
      integrationDelivery: { findMany: vi.fn(async () => [claimed]) },
    };
    const store = new PrismaDeliveryStore(prisma as never);

    await expect(store.claimDue({ workerId: 'worker-1', now, batchSize: 20 }))
      .resolves.toEqual([claimed]);

    const sql = (queryRaw.mock.calls[0]?.[0] as { sql?: string } | undefined)?.sql ?? '';
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain('"status" IN (\'PENDING\', \'RETRY_SCHEDULED\')');
    expect(sql).toContain('"status" = \'PROCESSING\'');
    expect(sql).toContain('"lockedAt" <=');
    expect(prisma.integrationDelivery.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['delivery-1'] }, lockedBy: 'worker-1', status: 'PROCESSING' },
      include: {
        integration: { select: { id: true, kind: true, configJson: true, signingSecret: true, credentialCiphertext: true } },
        event: { select: { id: true, type: true, payloadJson: true } },
      },
    });
  });

  it('does not query delivery details when no rows were claimed', async () => {
    const prisma = {
      $transaction: vi.fn(async (callback) => callback({ $queryRaw: vi.fn(async () => []) })),
      integrationDelivery: { findMany: vi.fn() },
    };
    const store = new PrismaDeliveryStore(prisma as never);
    await expect(store.claimDue({ workerId: 'worker-1', now, batchSize: 20 })).resolves.toEqual([]);
    expect(prisma.integrationDelivery.findMany).not.toHaveBeenCalled();
  });

  it('records an immutable successful attempt and clears the target health error', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const attemptCreate = vi.fn(async () => ({}));
    const integrationUpdate = vi.fn(async () => ({}));
    const tx = {
      integrationDelivery: { updateMany },
      integrationDeliveryAttempt: { create: attemptCreate },
      integration: { update: integrationUpdate },
    };
    const prisma = { $transaction: vi.fn(async (callback) => callback(tx)) };
    const store = new PrismaDeliveryStore(prisma as never);
    const outcome: DeliveryRecordedOutcome = {
      status: 'SUCCEEDED', attemptNumber: 1,
      startedAt: now, completedAt: new Date('2026-08-08T04:00:01.250Z'),
      statusCode: 204, error: null, nextAttemptAt: null,
      externalId: '42', externalUrl: 'https://github.com/acme/site/issues/42',
    };

    await store.recordOutcome(claimed, outcome);

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'delivery-1', status: 'PROCESSING', lockedBy: 'worker-1' },
      data: expect.objectContaining({
        status: 'SUCCEEDED', attemptCount: 1, lockedAt: null, lockedBy: null,
        deliveredAt: outcome.completedAt, lastStatusCode: 204, lastError: null,
        externalId: '42', externalUrl: 'https://github.com/acme/site/issues/42',
      }),
    });
    expect(attemptCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      deliveryId: 'delivery-1', cycle: 0, attemptNumber: 1, status: 'SUCCEEDED', durationMs: 1250,
    }) });
    expect(integrationUpdate).toHaveBeenCalledWith({
      where: { id: 'integration-1' },
      data: { lastSuccessAt: outcome.completedAt, lastError: null, lastErrorAt: null },
    });
  });

  it('refuses to record an outcome after ownership of the claim was lost', async () => {
    const tx = {
      integrationDelivery: { updateMany: vi.fn(async () => ({ count: 0 })) },
      integrationDeliveryAttempt: { create: vi.fn() },
      integration: { update: vi.fn() },
    };
    const store = new PrismaDeliveryStore({
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as never);
    const outcome: DeliveryRecordedOutcome = {
      status: 'DEAD_LETTER', attemptNumber: 1, startedAt: now, completedAt: now,
      statusCode: 401, error: 'unauthorized', nextAttemptAt: null,
      externalId: null, externalUrl: null,
    };

    await expect(store.recordOutcome(claimed, outcome)).rejects.toThrow('claim ownership');
    expect(tx.integrationDeliveryAttempt.create).not.toHaveBeenCalled();
  });
});
