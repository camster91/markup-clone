import { describe, expect, it } from 'vitest';
import {
  buildInvitationUrl,
  generateInvitationToken,
  hashInvitationToken,
  validateInvitationPassword,
  validateInvitationToken,
} from '@/lib/team-invitations';

describe('team invitation capabilities', () => {
  it('generates non-deterministic 256-bit tokens and stores a stable hash', () => {
    const first = generateInvitationToken();
    const second = generateInvitationToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
    expect(hashInvitationToken(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInvitationToken(first)).toBe(hashInvitationToken(first));
    expect(hashInvitationToken(first)).not.toBe(hashInvitationToken(second));
  });

  it('rejects malformed or non-canonical tokens', () => {
    expect(validateInvitationToken('short').ok).toBe(false);
    expect(validateInvitationToken(`${'A'.repeat(43)}=`).ok).toBe(false);
    expect(validateInvitationToken(`${'A'.repeat(42)}!`).ok).toBe(false);
    expect(validateInvitationToken('A'.repeat(43))).toEqual({
      ok: true,
      value: 'A'.repeat(43),
    });
  });

  it('puts the plaintext capability only in a URL fragment', () => {
    const token = 'A'.repeat(43);
    const url = buildInvitationUrl('https://markup.ashbi.ca', token);
    expect(url).toBe(`https://markup.ashbi.ca/invite#${token}`);
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/invite');
    expect(parsed.search).toBe('');
    expect(parsed.hash).toBe(`#${token}`);
  });

  it('requires a bounded password with letters and numbers', () => {
    expect(validateInvitationPassword('Strong client pass 2026')).toEqual({
      ok: true,
      value: 'Strong client pass 2026',
    });
    expect(validateInvitationPassword('short7').ok).toBe(false);
    expect(validateInvitationPassword('letters only password').ok).toBe(false);
    expect(validateInvitationPassword('123456789012').ok).toBe(false);
    expect(validateInvitationPassword('a1'.repeat(65)).ok).toBe(false);
  });
});
