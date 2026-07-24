// Unit tests for src/lib/request-ip.ts — trusted client IP for rate limits.

import { describe, it, expect } from 'vitest';
import { getClientIp } from '@/lib/request-ip';

function makeReq(headers: Record<string, string>): Request {
  return new Request('https://markup.ashbi.ca/api/test', { headers });
}

describe('getClientIp', () => {
  it('prefers x-real-ip when present', () => {
    expect(
      getClientIp(
        makeReq({
          'x-real-ip': '203.0.113.10',
          'x-forwarded-for': '1.2.3.4, 203.0.113.10',
        })
      )
    ).toBe('203.0.113.10');
  });

  it('takes the last hop of x-forwarded-for when x-real-ip is absent', () => {
    expect(
      getClientIp(makeReq({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8, 203.0.113.99' }))
    ).toBe('203.0.113.99');
  });

  it('trims whitespace around the last XFF hop', () => {
    expect(getClientIp(makeReq({ 'x-forwarded-for': '1.2.3.4,  203.0.113.50  ' }))).toBe(
      '203.0.113.50'
    );
  });

  it('returns unknown when neither header is present', () => {
    expect(getClientIp(makeReq({}))).toBe('unknown');
  });

  it('returns unknown when x-forwarded-for is empty/whitespace', () => {
    expect(getClientIp(makeReq({ 'x-forwarded-for': '  ,  ' }))).toBe('unknown');
  });
});
