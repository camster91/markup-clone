import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  processDeliveryBatch: vi.fn(),
}));

vi.mock('@/lib/integrations/delivery-queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/integrations/delivery-queue')>()),
  processDeliveryBatch: mocks.processDeliveryBatch,
}));

vi.mock('@/lib/integrations/prisma-delivery-store', () => ({
  PrismaDeliveryStore: class PrismaDeliveryStore {},
}));

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { POST } from '@/app/api/internal/integration-deliveries/process/route';
import { authorizeDeliveryWorker } from '@/lib/integrations/worker-auth';

const SECRET = 'local-test-worker-secret-at-least-32-chars';

function request(token?: string): NextRequest {
  return new NextRequest('https://markup.test/api/internal/integration-deliveries/process', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
}

beforeEach(() => {
  process.env.DELIVERY_WORKER_SECRET = SECRET;
  mocks.processDeliveryBatch.mockReset();
  mocks.processDeliveryBatch.mockResolvedValue({
    claimed: 2, succeeded: 1, retryScheduled: 1, deadLettered: 0,
  });
});

afterEach(() => {
  delete process.env.DELIVERY_WORKER_SECRET;
});

describe('delivery worker authentication', () => {
  it('accepts only an exact bearer secret and fails closed without server configuration', () => {
    expect(authorizeDeliveryWorker(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(authorizeDeliveryWorker(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(authorizeDeliveryWorker(null, SECRET)).toBe(false);
    expect(authorizeDeliveryWorker(`Bearer ${SECRET}`, '')).toBe(false);
  });
});

describe('POST /api/internal/integration-deliveries/process', () => {
  it('rejects missing and incorrect bearer credentials without touching the queue', async () => {
    await expect(POST(request())).resolves.toMatchObject({ status: 401 });
    await expect(POST(request('incorrect-secret'))).resolves.toMatchObject({ status: 401 });
    expect(mocks.processDeliveryBatch).not.toHaveBeenCalled();
  });

  it('returns 503 when the worker secret is not configured', async () => {
    delete process.env.DELIVERY_WORKER_SECRET;
    const response = await POST(request(SECRET));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Delivery worker is not configured' });
  });

  it('processes a bounded batch and returns its safe summary', async () => {
    const response = await POST(request(SECRET));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      claimed: 2, succeeded: 1, retryScheduled: 1, deadLettered: 0,
    });
    expect(mocks.processDeliveryBatch).toHaveBeenCalledWith(expect.objectContaining({
      workerId: expect.stringMatching(/^worker-/),
      batchSize: 20,
    }));
  });

  it('does not expose internal processor errors', async () => {
    mocks.processDeliveryBatch.mockRejectedValueOnce(new Error('database url and secret details'));
    const response = await POST(request(SECRET));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Delivery processing failed' });
  });
});
