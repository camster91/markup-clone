import { describe, expect, it } from 'vitest';
import { getClientIp } from '@/lib/request-ip';

function makeReq(headers: Record<string, string>): Request {
  return new Request('https://markup.ashbi.ca/api/test', { headers });
}

describe('getClientIp', () => {
  it('prefers x-real-ip over x-forwarded-for', () => {
    expect(
      getClientIp(
        makeReq({
          'x-real-ip': '203.0.113.10',
          'x-forwarded-for': '198.51.100.1, 203.0.113.10',
        })
      )
    ).toBe('203.0.113.10');
  });

  it('uses the last (rightmost) hop of x-forwarded-for', () => {
    expect(
      getClientIp(makeReq({ 'x-forwarded-for': '198.51.100.1, 203.0.113.50' }))
    ).toBe('203.0.113.50');
  });

  it('trims whitespace around the last hop', () => {
    expect(
      getClientIp(makeReq({ 'x-forwarded-for': '198.51.100.1,  203.0.113.50  ' }))
    ).toBe('203.0.113.50');
  });

  it('returns unknown when no IP headers are present', () => {
    expect(getClientIp(makeReq({}))).toBe('unknown');
  });

  it('returns unknown for an empty x-forwarded-for', () => {
    expect(getClientIp(makeReq({ 'x-forwarded-for': '  ,  ' }))).toBe('unknown');
  });
});
