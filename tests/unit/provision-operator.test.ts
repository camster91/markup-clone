import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  hashPassword,
  provisionOperator,
  validateInput,
  verifyPassword,
} = require('../../scripts/provision-operator.cjs');

describe('production operator provisioner', () => {
  it('normalizes email, enforces bounded secrets, and hashes without retaining plaintext', () => {
    expect(validateInput(' Owner@Example.com ', 'correct horse battery')).toEqual({
      email: 'owner@example.com',
      password: 'correct horse battery',
    });
    expect(() => validateInput('owner', 'correct horse battery')).toThrow('email is invalid');
    expect(() => validateInput('owner@example.com', 'too-short')).toThrow('12 to 128');
    const hash = hashPassword('correct horse battery');
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(hash).not.toContain('correct horse battery');
    expect(verifyPassword('correct horse battery', hash)).toBe(true);
    expect(verifyPassword('wrong password value', hash)).toBe(false);
  });

  it('creates once and becomes an idempotent no-op for the same credentials', async () => {
    const create = vi.fn(async ({ data }: { data: Record<string, string> }) => ({
      id: 'operator-1', email: data.email, role: data.role,
    }));
    const created = await provisionOperator({ findUnique: vi.fn(async () => null), create }, 'owner@example.com', 'correct horse battery');
    expect(created.status).toBe('created');
    const passwordHash = create.mock.calls[0][0].data.passwordHash;

    const unchanged = await provisionOperator({
      findUnique: vi.fn(async () => ({ id: 'operator-1', email: 'owner@example.com', role: 'operator', passwordHash })),
      create: vi.fn(),
    }, 'owner@example.com', 'correct horse battery');
    expect(unchanged.status).toBe('unchanged');
  });

  it('refuses implicit promotion and password replacement, but permits explicit rotation', async () => {
    await expect(provisionOperator({
      findUnique: vi.fn(async () => ({ id: 'reviewer-1', email: 'owner@example.com', role: 'reviewer', passwordHash: 'x' })),
    }, 'owner@example.com', 'correct horse battery')).rejects.toThrow('refusing implicit privilege escalation');

    const existing = { id: 'operator-1', email: 'owner@example.com', role: 'operator', passwordHash: hashPassword('old password value') };
    await expect(provisionOperator({ findUnique: vi.fn(async () => existing) }, 'owner@example.com', 'new password value')).rejects.toThrow('--rotate');

    const update = vi.fn(async (args: { data: { passwordHash: string } }) => {
      if (!args.data.passwordHash) throw new Error('missing password hash');
      return { id: existing.id, email: existing.email, role: existing.role };
    });
    const rotated = await provisionOperator({ findUnique: vi.fn(async () => existing), update }, 'owner@example.com', 'new password value', true);
    expect(rotated.status).toBe('rotated');
    expect(verifyPassword('new password value', update.mock.calls[0]![0].data.passwordHash)).toBe(true);
  });
});
