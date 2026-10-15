import { describe, expect, it } from 'vitest';
import {
  isBlockedIp,
  isBlockedIpv6,
  parseIpv6,
  validateOutboundUrlShape,
} from '@/lib/safe-url';

describe('parseIpv6', () => {
  it('expands compressed, dotted-tail and zoned forms', () => {
    expect(parseIpv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6('::ffff:127.0.0.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
    expect(parseIpv6('fe80::1%eth0')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6('2001:db8:0:0:0:0:0:1')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]);
  });

  it('rejects malformed input', () => {
    expect(parseIpv6('1::2::3')).toBeNull();
    expect(parseIpv6('::ffff:999.0.0.1')).toBeNull();
    expect(parseIpv6('1:2:3:4:5:6:7')).toBeNull();
    expect(parseIpv6('gggg::1')).toBeNull();
  });
});

describe('isBlockedIp — IPv6', () => {
  it.each([
    '::1',
    '::',
    '::ffff:127.0.0.1', // IPv4-mapped loopback (was missed by the old ^:ffff: regex)
    '::ffff:10.0.0.5',
    '::ffff:169.254.169.254',
    '::ffff:7f00:1', // hex-form mapped 127.0.0.1
    '::ffff:a9fe:a9fe', // hex-form mapped 169.254.169.254
    '0:0:0:0:0:ffff:7f00:1',
    '::ffff:0:127.0.0.1', // IPv4-translated
    '::127.0.0.1', // IPv4-compatible (deprecated)
    '64:ff9b::7f00:1', // NAT64
    '64:ff9b::808:808', // NAT64 even for a public v4 — whole prefix blocked
    '2002:7f00:1::1', // 6to4
    '2001:0:4136:e378:8000:63bf:3fff:fdd2', // Teredo
    'fe80::1',
    'febf::1',
    'fec0::1', // site-local
    'fc00::1',
    'fd12:3456::1',
    'ff02::1', // multicast
    'not-an-ip',
  ])('blocks %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each([
    '2606:4700:4700::1111',
    '2a00:1450:4001:80b::200e',
    '::ffff:8.8.8.8', // mapped public v4
  ])('allows public %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });

  it('treats unparseable input as blocked', () => {
    expect(isBlockedIpv6('zzzz')).toBe(true);
  });
});

describe('validateOutboundUrlShape — IP literals', () => {
  it.each([
    'https://[::1]/hook',
    'https://[::ffff:127.0.0.1]/hook',
    'https://[::ffff:7f00:1]/hook',
    'https://[2606:4700:4700::1111]/hook',
    'https://127.0.0.1/hook',
  ])('rejects IP literal %s', (url) => {
    const result = validateOutboundUrlShape(url);
    expect(result.ok).toBe(false);
  });

  it('rejects a trailing-dot localhost', () => {
    expect(validateOutboundUrlShape('https://localhost./hook').ok).toBe(false);
    expect(validateOutboundUrlShape('https://foo.internal./hook').ok).toBe(false);
  });

  it('accepts a normal https hostname', () => {
    expect(validateOutboundUrlShape('https://hooks.slack.com/services/T/B/X')).toEqual({
      ok: true,
      value: 'https://hooks.slack.com/services/T/B/X',
    });
  });
});
