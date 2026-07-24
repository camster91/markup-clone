// Unit tests for src/lib/ssrf.ts — outbound webhook URL SSRF guards.
//
// Threat model: a dashboard caller can register an integration webhook
// that the server later fetches. Without host checks that URL can
// point at link-local metadata, RFC1918 ranges, or localhost.

import { describe, it, expect } from 'vitest';
import { assertSafeOutboundUrl } from '@/lib/ssrf';

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
