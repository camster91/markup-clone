import { describe, expect, it } from 'vitest';
import { getClientIp, trustedProxyHops } from '@/lib/request-ip';

function makeReq(headers: Record<string, string>): Request {
  return new Request('https://markup.ashbi.ca/api/test', { headers });
}

const NO_ENV = {};

describe('getClientIp', () => {
  it('ignores a client-supplied x-real-ip by default (bare Caddy passes it through)', () => {
    expect(
      getClientIp(
        makeReq({
          'x-real-ip': '10.9.8.7',
          'x-forwarded-for': '203.0.113.10',
        }),
        NO_ENV,
      )
    ).toBe('203.0.113.10');
  });

  it('rotating x-real-ip does not change the bucket key by default', () => {
    const ips = ['1.1.1.1', '2.2.2.2', '3.3.3.3'].map((spoof) =>
      getClientIp(
        makeReq({ 'x-real-ip': spoof, 'x-forwarded-for': '198.51.100.9' }),
        NO_ENV,
      ),
    );
    expect(new Set(ips)).toEqual(new Set(['198.51.100.9']));
  });

  it('honours x-real-ip only with the TRUST_X_REAL_IP opt-in', () => {
    const req = makeReq({
      'x-real-ip': '203.0.113.10',
      'x-forwarded-for': '198.51.100.1, 172.18.0.1',
    });
    expect(getClientIp(req, { TRUST_X_REAL_IP: 'true' })).toBe('203.0.113.10');
    expect(getClientIp(req, { TRUST_X_REAL_IP: 'false' })).toBe('172.18.0.1');
  });

  it('falls back to x-forwarded-for when the trusted x-real-ip is not an IP', () => {
    expect(
      getClientIp(
        makeReq({ 'x-real-ip': 'not-an-ip', 'x-forwarded-for': '203.0.113.5' }),
        { TRUST_X_REAL_IP: '1' },
      )
    ).toBe('203.0.113.5');
  });

  it('uses the last (rightmost) hop of x-forwarded-for with the default hop count', () => {
    expect(
      getClientIp(makeReq({ 'x-forwarded-for': '198.51.100.1, 203.0.113.50' }), NO_ENV)
    ).toBe('203.0.113.50');
  });

  it('uses the N-th hop from the right when TRUSTED_PROXY_HOPS=N', () => {
    const req = makeReq({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7, 172.18.0.2' });
    expect(getClientIp(req, { TRUSTED_PROXY_HOPS: '2' })).toBe('203.0.113.7');
    expect(getClientIp(req, { TRUSTED_PROXY_HOPS: '1' })).toBe('172.18.0.2');
  });

  it('uses the left-most entry when the chain is shorter than the hop count', () => {
    expect(
      getClientIp(makeReq({ 'x-forwarded-for': '203.0.113.7' }), { TRUSTED_PROXY_HOPS: '3' })
    ).toBe('203.0.113.7');
  });

  it('accepts IPv6 hops', () => {
    expect(
      getClientIp(makeReq({ 'x-forwarded-for': '2001:db8::1' }), NO_ENV)
    ).toBe('2001:db8::1');
  });

  it('trims whitespace around the last hop', () => {
    expect(
      getClientIp(makeReq({ 'x-forwarded-for': '198.51.100.1,  203.0.113.50  ' }), NO_ENV)
    ).toBe('203.0.113.50');
  });

  it('returns unknown when the selected hop is not an IP', () => {
    expect(
      getClientIp(makeReq({ 'x-forwarded-for': 'x'.repeat(5000) }), NO_ENV)
    ).toBe('unknown');
  });

  it('returns unknown when no IP headers are present', () => {
    expect(getClientIp(makeReq({}), NO_ENV)).toBe('unknown');
  });

  it('returns unknown for an empty x-forwarded-for', () => {
    expect(getClientIp(makeReq({ 'x-forwarded-for': '  ,  ' }), NO_ENV)).toBe('unknown');
  });
});

describe('trustedProxyHops', () => {
  it('defaults to 1 and rejects invalid values', () => {
    expect(trustedProxyHops({})).toBe(1);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: '2' })).toBe(2);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: '0' })).toBe(1);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: '-1' })).toBe(1);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: '1.5' })).toBe(1);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: '99' })).toBe(1);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: 'abc' })).toBe(1);
  });
});
