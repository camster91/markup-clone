// Unit tests for the audit() fire-and-forget helper.
// Verifies that audit() never throws and never blocks the request.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { auditLog: mocks },
}));

import { audit } from '@/lib/audit';

describe('audit()', () => {
  beforeEach(() => {
    mocks.create.mockReset();
    mocks.create.mockResolvedValue({ id: 'audit-1' });
  });

  it('calls prisma.auditLog.create with correct data', () => {
    audit({ actor: 'proj-1', action: 'project.create', target: 'proj-1' });
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        actor: 'proj-1',
        action: 'project.create',
        target: 'proj-1',
        metadata: undefined,
      },
    });
  });

  it('includes metadata when provided', () => {
    audit({
      actor: 'proj-1',
      action: 'project.delete',
      target: 'proj-1',
      metadata: { name: 'Test', domain: 'example.com' },
    });
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        actor: 'proj-1',
        action: 'project.delete',
        target: 'proj-1',
        metadata: { name: 'Test', domain: 'example.com' },
      },
    });
  });

  it('does NOT throw when prisma.auditLog.create rejects', async () => {
    mocks.create.mockRejectedValue(new Error('DB connection failed'));
    // Should not throw — fire-and-forget with graceful error handling
    expect(() => audit({ actor: 'x', action: 'project.create', target: 'x' })).not.toThrow();
    // Give the catch handler a tick to run
    await new Promise(r => setTimeout(r, 10));
  });

  it('logs the failed INSERT to stderr (console.error) so audit failures are not silent', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mocks.create.mockRejectedValue(new Error('DB connection failed'));
      audit({ actor: 'proj-1', action: 'project.delete', target: 'proj-1' });
      // Wait long enough for the .catch() microtask to fire.
      await new Promise(r => setTimeout(r, 20));
      expect(errorSpy).toHaveBeenCalled();
      const firstCall = errorSpy.mock.calls[0];
      // First arg should be a recognisable "Audit log failed" prefix; second
      // arg should carry the underlying prisma error message. We assert on
      // the prefix to avoid coupling to the exact err.message shape.
      expect(String(firstCall[0])).toMatch(/Audit log failed/i);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('returns undefined immediately (fire-and-forget)', () => {
    mocks.create.mockResolvedValue({ id: 'log-1' });
    const result = audit({ actor: 'x', action: 'project.create', target: 'x' });
    expect(result).toBeUndefined();
  });

  it('does not block the route: returns synchronously even if the prisma promise never resolves', async () => {
    // A never-resolving promise simulates a wedged DB. The route must still
    // be able to send its response: audit() must return undefined on the
    // next microtask, not wait for create() to settle.
    let resolveCreate: (v: unknown) => void = () => {};
    mocks.create.mockImplementation(
      () => new Promise((res) => { resolveCreate = res; }),
    );

    const start = Date.now();
    const result = audit({ actor: 'proj-1', action: 'project.create', target: 'proj-1' });
    const elapsed = Date.now() - start;

    // audit() is synchronous; it must return undefined and complete in <10ms
    // even though the underlying prisma promise is still pending.
    expect(result).toBeUndefined();
    expect(elapsed).toBeLessThan(10);
    expect(mocks.create).toHaveBeenCalledTimes(1);

    // Now resolve the pending promise so we don't leak an unhandled-rejection
    // warning into the next test.
    resolveCreate({ id: 'late' });
    await new Promise(r => setTimeout(r, 0));
  });
});
