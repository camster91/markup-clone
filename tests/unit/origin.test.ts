// Unit tests for the unified host/origin parser.
//
// `parseHost` is the single source of truth for translating a
// DASHBOARD_HOST-style env var (which can be set in two equivalent forms
// — bare hostname or full URL) into a { host, origin } pair. These tests
// pin each input form so a refactor can't silently regress one of them.

import { describe, it, expect } from 'vitest';
import { parseHost } from '@/lib/origin';

describe('parseHost', () => {
  it('returns the default when value is undefined', () => {
    expect(parseHost(undefined)).toEqual({
      host: 'markup.ashbi.ca',
      origin: 'https://markup.ashbi.ca',
    });
  });

  it('returns the default when value is null', () => {
    expect(parseHost(null)).toEqual({
      host: 'markup.ashbi.ca',
      origin: 'https://markup.ashbi.ca',
    });
  });

  it('returns the default when value is an empty string', () => {
    expect(parseHost('')).toEqual({
      host: 'markup.ashbi.ca',
      origin: 'https://markup.ashbi.ca',
    });
  });

  it('handles a bare hostname by prefixing https:// for the origin', () => {
    expect(parseHost('markup.ashbi.ca')).toEqual({
      host: 'markup.ashbi.ca',
      origin: 'https://markup.ashbi.ca',
    });
  });

  it('handles a full https URL with no port or path', () => {
    expect(parseHost('https://markup.ashbi.ca')).toEqual({
      host: 'markup.ashbi.ca',
      origin: 'https://markup.ashbi.ca',
    });
  });

  it('preserves the configured port in both `host` and `origin`', () => {
    expect(parseHost('https://markup.ashbi.ca:8443')).toEqual({
      host: 'markup.ashbi.ca:8443',
      origin: 'https://markup.ashbi.ca:8443',
    });
  });

  it('extracts the hostname when the URL includes a path', () => {
    expect(parseHost('https://markup.ashbi.ca/foo')).toEqual({
      host: 'markup.ashbi.ca',
      origin: 'https://markup.ashbi.ca',
    });
  });

  it('preserves a non-default scheme (http) when one is provided', () => {
    // The parser is scheme-aware but doesn't impose https. Local dev on
    // a non-TLS port uses this path; the auth allow-list still works
    // because it compares the configured host and port, not schemes.
    expect(parseHost('http://markup.ashbi.ca:3000')).toEqual({
      host: 'markup.ashbi.ca:3000',
      origin: 'http://markup.ashbi.ca:3000',
    });
  });
});
