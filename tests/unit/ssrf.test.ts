// Unit tests for src/lib/ssrf.ts — outbound webhook URL SSRF guards.
//
// Threat model: a dashboard caller can register an integration webhook
// that the server later fetches. Without host checks that URL can
// point at link-local metadata, RFC1918 ranges, or localhost.
// Resolve-time checks (safeOutboundFetch) close DNS-rebinding where
// a hostname resolves to a private IP at fetch time.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const lookupMock = vi.hoisted(() => vi.fn());

vi.mock('node:dns/promises', () => ({
  default: { lookup: lookupMock },
  lookup: lookupMock,
}));

import {
  assertSafeOutboundUrl,
  isBlockedResolvedAddress,
  safeOutboundFetch,
} from '@/lib/ssrf';

describe('assertSafeOutboundUrl', () => {
  it('accepts a public HTTPS Slack webhook URL', () => {
    const res = assertSafeOutboundUrl('https://hooks.slack.com/services/xxx');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.url.hostname).toBe('hooks.slack.com');
    }
  });

  it.each([
    'http://localhost/hook',
    'https://localhost/hook',
    'http://127.0.0.1/hook',
    'https://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/internal',
    'http://192.168.1.1/admin',
    'http://[::1]/hook',
    'https://user:pass@evil.example.com/hook',
  ])('rejects unsafe URL %s', (raw) => {
    const res = assertSafeOutboundUrl(raw);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.length).toBeGreaterThan(0);
    }
  });

  it('rejects non-http(s) protocols', () => {
    const res = assertSafeOutboundUrl('ftp://example.com/file');
    expect(res.ok).toBe(false);
  });

  it('rejects malformed URLs', () => {
    const res = assertSafeOutboundUrl('not a url');
    expect(res.ok).toBe(false);
  });
});

describe('isBlockedResolvedAddress', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '192.168.1.1',
    '172.16.0.1',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    '::1',
    'fd12::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ])('blocks %s', (ip) => {
    expect(isBlockedResolvedAddress(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34'])('allows public %s', (ip) => {
    expect(isBlockedResolvedAddress(ip)).toBe(false);
  });
});

describe('safeOutboundFetch', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    lookupMock.mockReset();
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('rejects when DNS lookup returns a private IP', async () => {
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    await expect(
      safeOutboundFetch('https://evil.example.com/hook', { method: 'POST' })
    ).rejects.toThrow('resolved address is not allowed');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects when any of several resolved addresses is private', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]);
    await expect(
      safeOutboundFetch('https://rebinder.example.com/hook')
    ).rejects.toThrow('resolved address is not allowed');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('fetches when all resolved addresses are public', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    const res = await safeOutboundFetch('https://hooks.example.com/services/x', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://hooks.example.com/services/x',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('rejects unsafe URL shape before DNS lookup', async () => {
    await expect(safeOutboundFetch('http://127.0.0.1/hook')).rejects.toThrow();
    expect(lookupMock).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
