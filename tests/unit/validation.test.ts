// Unit tests for src/lib/validation.ts

import { describe, it, expect } from 'vitest';
import {
  LIMITS,
  validatePagePath,
  validatePercent,
  sanitizeText,
  validateScreenshotId,
  validateProjectName,
  validateProjectDomain,
} from '../../src/lib/validation';

describe('LIMITS', () => {
  it('exports the expected constants', () => {
    expect(LIMITS.TEXT_MAX).toBe(10_000);
    expect(LIMITS.PROJECT_NAME_MAX).toBe(200);
    expect(LIMITS.X_PERCENT_MIN).toBe(0);
    expect(LIMITS.X_PERCENT_MAX).toBe(100);
  });
});

describe('validatePagePath', () => {
  it('accepts a simple path', () => {
    expect(validatePagePath('/about')).toEqual({ ok: true, value: '/about' });
  });

  it('accepts a deep nested path', () => {
    expect(validatePagePath('/a/b/c/d/e')).toEqual({ ok: true, value: '/a/b/c/d/e' });
  });

  it('accepts a path with query-string-like chars', () => {
    // We don't reject these — the path is opaque to the server.
    expect(validatePagePath('/search?q=foo&p=1')).toEqual({ ok: true, value: '/search?q=foo&p=1' });
  });

  it('rejects an empty path', () => {
    expect(validatePagePath('')).toEqual({ ok: false, error: 'path must not be empty' });
  });

  it('rejects a path that does not start with /', () => {
    expect(validatePagePath('about')).toEqual({ ok: false, error: 'path must start with /' });
  });

  it('rejects a path that contains .. (path traversal)', () => {
    const r = validatePagePath('/../etc/passwd');
    expect(r).toEqual({ ok: false, error: 'path must not contain ..' });
  });

  it('rejects a path with backslash', () => {
    // No '..' so the traversal check doesn't fire first; the backslash
    // check should be the one that rejects.
    expect(validatePagePath('/foo\\bar')).toEqual({ ok: false, error: 'path must not contain backslashes' });
  });

  it('rejects a path with null bytes', () => {
    expect(validatePagePath('/foo\x00bar')).toEqual({ ok: false, error: 'path must not contain control characters' });
  });

  it('rejects a path longer than LIMITS.PATH_MAX', () => {
    const longPath = '/' + 'a'.repeat(LIMITS.PATH_MAX + 1);
    const r = validatePagePath(longPath);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('≤');
  });

  it('accepts a path at exactly the max length', () => {
    const path = '/' + 'a'.repeat(LIMITS.PATH_MAX - 1);
    const r = validatePagePath(path);
    expect(r.ok).toBe(true);
  });
});

describe('validatePercent', () => {
  it('accepts 0', () => {
    expect(validatePercent(0, 'xPercent')).toEqual({ ok: true, value: 0 });
  });

  it('accepts 100', () => {
    expect(validatePercent(100, 'yPercent')).toEqual({ ok: true, value: 100 });
  });

  it('accepts 50.5 (a float in range)', () => {
    expect(validatePercent(50.5, 'xPercent')).toEqual({ ok: true, value: 50.5 });
  });

  it('rejects -0.1 (just below 0)', () => {
    const r = validatePercent(-0.1, 'xPercent');
    expect(r.ok).toBe(false);
  });

  it('rejects 100.1 (just above 100)', () => {
    const r = validatePercent(100.1, 'yPercent');
    expect(r.ok).toBe(false);
  });

  it('rejects NaN', () => {
    const r = validatePercent(NaN, 'xPercent');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('finite');
  });

  it('rejects Infinity', () => {
    expect(validatePercent(Infinity, 'xPercent').ok).toBe(false);
    expect(validatePercent(-Infinity, 'yPercent').ok).toBe(false);
  });

  it('rejects a non-number (defensive)', () => {
    // @ts-expect-error: testing runtime input
    expect(validatePercent('50', 'xPercent').ok).toBe(false);
    // @ts-expect-error: testing runtime input
    expect(validatePercent(null, 'xPercent').ok).toBe(false);
  });
});

describe('sanitizeText', () => {
  it('accepts simple text', () => {
    expect(sanitizeText('Hello, world!', 100, 'text')).toEqual({ ok: true, value: 'Hello, world!' });
  });

  it('accepts text with newlines and tabs (keeps them)', () => {
    expect(sanitizeText('line 1\nline 2\tindented', 100, 'text').ok).toBe(true);
  });

  it('strips control characters (null, bell, etc.)', () => {
    const cleaned = sanitizeText('hello\x00\x07world', 100, 'text');
    expect(cleaned).toEqual({ ok: true, value: 'helloworld' });
  });

  it('rejects text longer than max', () => {
    const r = sanitizeText('x'.repeat(101), 100, 'text');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('100');
  });

  it('rejects non-string input (defensive)', () => {
    expect(sanitizeText(42 as unknown as string, 100, 'text').ok).toBe(false);
  });
});

describe('validateScreenshotId', () => {
  it('accepts a valid UUID', () => {
    expect(validateScreenshotId('9cf4c12d-cdfc-4ec5-a361-446ef3d6ca19').ok).toBe(true);
  });

  it('accepts uppercase hex', () => {
    expect(validateScreenshotId('9CF4C12D-CDFC-4EC5-A361-446EF3D6CA19').ok).toBe(true);
  });

  it('rejects a UUID without dashes', () => {
    expect(validateScreenshotId('9cf4c12dcdfc4ec5a361446ef3d6ca19').ok).toBe(false);
  });

  it('rejects path traversal (a common attack)', () => {
    expect(validateScreenshotId('../../../etc/passwd').ok).toBe(false);
  });

  it('rejects a string with too-short segments', () => {
    expect(validateScreenshotId('9cf4c12d-cdfc-4ec5-a361').ok).toBe(false);
  });

  it('rejects non-string', () => {
    expect(validateScreenshotId(42 as unknown as string).ok).toBe(false);
  });
});

describe('validateProjectName', () => {
  it('accepts a simple name', () => {
    expect(validateProjectName('Acme Site').ok).toBe(true);
  });

  it('accepts a long-but-valid name', () => {
    expect(validateProjectName('a'.repeat(200)).ok).toBe(true);
  });

  it('rejects empty name', () => {
    expect(validateProjectName('').ok).toBe(false);
  });

  it('rejects a name longer than 200', () => {
    expect(validateProjectName('a'.repeat(201)).ok).toBe(false);
  });
});

describe('validateProjectDomain', () => {
  it('accepts a regular domain', () => {
    expect(validateProjectDomain('example.com').ok).toBe(true);
  });

  it('accepts a subdomain', () => {
    expect(validateProjectDomain('www.example.com').ok).toBe(true);
  });

  it('rejects a domain with a scheme (no http://)', () => {
    expect(validateProjectDomain('https://example.com').ok).toBe(false);
  });

  it('rejects a domain with a path', () => {
    expect(validateProjectDomain('example.com/about').ok).toBe(false);
  });

  it('rejects a domain with a port', () => {
    expect(validateProjectDomain('example.com:8080').ok).toBe(false);
  });

  it('rejects "localhost" (SSRF protection)', () => {
    expect(validateProjectDomain('localhost').ok).toBe(false);
  });

  it('rejects a *.localhost subdomain (SSRF protection)', () => {
    expect(validateProjectDomain('api.localhost').ok).toBe(false);
  });

  it('rejects a *.local domain (mDNS)', () => {
    expect(validateProjectDomain('devbox.local').ok).toBe(false);
  });

  it('rejects an IP address (v4)', () => {
    expect(validateProjectDomain('127.0.0.1').ok).toBe(false);
  });

  it('rejects an IP address (v6)', () => {
    expect(validateProjectDomain('::1').ok).toBe(false);
  });

  it('rejects an empty domain', () => {
    expect(validateProjectDomain('').ok).toBe(false);
  });

  it('rejects a domain longer than 253 chars (DNS limit)', () => {
    expect(validateProjectDomain('a'.repeat(254) + '.com').ok).toBe(false);
  });

  // SSRF bypass regression tests (see src/lib/validation.ts). These are
  // the hostnames that a Chromium client on the recapture path would
  // happily connect to and render, leaking instance credentials or
  // service tokens. They MUST be rejected.

  it('rejects metadata.google.internal (GCE metadata server)', () => {
    expect(validateProjectDomain('metadata.google.internal').ok).toBe(false);
  });

  it('rejects a sub-host of metadata.google.internal', () => {
    expect(validateProjectDomain('compute.metadata.google.internal').ok).toBe(false);
  });

  it('rejects metadata.azure.com (Azure IMDS)', () => {
    expect(validateProjectDomain('metadata.azure.com').ok).toBe(false);
  });

  it('rejects *.lan / *.intranet / *.corp / *.private', () => {
    for (const d of ['server.lan', 'git.intranet', 'db.corp', 'wiki.private']) {
      expect(validateProjectDomain(d).ok).toBe(false);
    }
  });

  it('rejects *.svc.cluster.local (k8s service DNS)', () => {
    expect(validateProjectDomain('postgres.svc.cluster.local').ok).toBe(false);
  });

  it('rejects decimal-encoded IPv4 (2130706433 = 127.0.0.1)', () => {
    expect(validateProjectDomain('2130706433').ok).toBe(false);
  });

  it('rejects single-label 0 (whole-network shorthand for 0.0.0.0)', () => {
    expect(validateProjectDomain('0').ok).toBe(false);
  });
});
