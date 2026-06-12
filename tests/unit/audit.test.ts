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

  it('returns undefined immediately (fire-and-forget)', () => {
    mocks.create.mockResolvedValue({ id: 'log-1' });
    const result = audit({ actor: 'x', action: 'project.create', target: 'x' });
    expect(result).toBeUndefined();
  });
});
