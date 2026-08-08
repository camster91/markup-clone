// Unit tests for src/lib/validation.ts

import { describe, it, expect } from 'vitest';
import {
  LIMITS,
  validatePagePath,
  validatePercent,
  sanitizeText,
  validateScreenshotId,
  validatePinId,
  validateProjectName,
  validateProjectDomain,
  validateEmail,
  validateSubscriberEmail,
  validatePinText,
  validateTeamRole,
} from '../../src/lib/validation';

describe('validateTeamRole', () => {
  it.each(['owner', 'contributor', 'client', 'guest'])(
    'accepts canonical agency role %s',
    (role) => {
      expect(validateTeamRole(role)).toEqual({ ok: true, value: role });
    },
  );

  it('rejects the legacy reviewer label for new writes', () => {
    expect(validateTeamRole('reviewer')).toEqual({
      ok: false,
      error: 'role must be one of: owner, contributor, client, guest',
    });
  });
});

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
    if (r.ok) throw new Error('expected validation failure');
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
    if (r.ok) throw new Error('expected validation failure');
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
    if (r.ok) throw new Error('expected validation failure');
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

describe('validatePinId', () => {
  // Pin model is @default(uuid()) per the Prisma schema, so the same
  // UUID shape as validateScreenshotId applies. The error message uses
  // "pinId" so the route's 400 response names the offending field.

  it('accepts a valid UUID', () => {
    const r = validatePinId('9cf4c12d-cdfc-4ec5-a361-446ef3d6ca19');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('9cf4c12d-cdfc-4ec5-a361-446ef3d6ca19');
  });

  it('accepts uppercase hex', () => {
    expect(validatePinId('9CF4C12D-CDFC-4EC5-A361-446EF3D6CA19').ok).toBe(true);
  });

  it('rejects a UUID without dashes', () => {
    const r = validatePinId('9cf4c12dcdfc4ec5a361446ef3d6ca19');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/pinId/);
  });

  it('rejects path traversal (a common attack)', () => {
    const r = validatePinId('../../../etc/passwd');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/pinId/);
  });

  it('rejects a string with too-short segments', () => {
    expect(validatePinId('9cf4c12d-cdfc-4ec5-a361').ok).toBe(false);
  });

  it('rejects non-string', () => {
    // Accept the wider `unknown` type at the runtime boundary so the
    // route can pass whatever Next decoded from the path segment.
    expect(validatePinId(42 as unknown as string).ok).toBe(false);
    expect(validatePinId(null as unknown as string).ok).toBe(false);
    expect(validatePinId(undefined as unknown as string).ok).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(validatePinId('').ok).toBe(false);
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

  // Unicode / bidi-override policy tests — see doc comment on
  // `validateProjectName` in src/lib/validation.ts. We accept-and-render-safely:
  // React escapes string children, so bidi / zero-width chars are not an XSS
  // vector. They are accepted so that names in Arabic / Hebrew / many Asian
  // scripts (which rely on zero-width joiners and bidi marks) keep working.

  it('accepts U+202E (RIGHT-TO-LEFT OVERRIDE) in a name', () => {
    // Classic "evil\u202Egpj.exe" -> "evil.exe.jpg" spoof. We accept the
    // input; React escapes it on render, and the dashboard shows the
    // domain next to the name, so the spoof doesn't reach a victim.
    const r = validateProjectName('paypal\u202Egpj.exe');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected validation success');
    expect(r.value).toBe('paypal\u202Egpj.exe');
  });

  it('accepts U+200B (ZERO WIDTH SPACE) in a name', () => {
    // Zero-width joiners / spaces are part of legitimate CJK and Arabic
    // rendering. Rejecting them would break valid project names.
    const r = validateProjectName('hello\u200Bworld');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected validation success');
    expect(r.value).toBe('hello\u200Bworld');
  });

  it('rejects U+0000 (null byte) — defense-in-depth', () => {
    // Null bytes truncate C strings, have broken log aggregators and a
    // few ORMs in the past, and never appear in a legitimate name. We
    // reject them at the project-name boundary so a stray null never
    // reaches the DB / filesystem layer.
    const r = validateProjectName('hello\u0000world');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected validation failure');
    expect(r.error).toBe('name must not contain null bytes');
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

describe('validateEmail', () => {
  // Accept cases — the common shape that real subscriber emails follow.

  it('accepts alice@example.com', () => {
    expect(validateEmail('alice@example.com')).toEqual({ ok: true, value: 'alice@example.com' });
  });

  it('accepts alice+test@example.com (plus addressing in the local part)', () => {
    expect(validateEmail('alice+test@example.com')).toEqual({ ok: true, value: 'alice+test@example.com' });
  });

  it('accepts a.b.c@sub.example.com (dotted local part + subdomain)', () => {
    expect(validateEmail('a.b.c@sub.example.com')).toEqual({ ok: true, value: 'a.b.c@sub.example.com' });
  });

  // Reject cases — the obvious-malformed-input set from the task.

  it('rejects "not-an-email" (no @)', () => {
    const r = validateEmail('not-an-email');
    expect(r.ok).toBe(false);
  });

  it('rejects "@" (empty local part)', () => {
    expect(validateEmail('@').ok).toBe(false);
  });

  it('rejects "alice@" (empty domain)', () => {
    expect(validateEmail('alice@').ok).toBe(false);
  });

  it('rejects "alice@.com" (domain starts with a dot)', () => {
    expect(validateEmail('alice@.com').ok).toBe(false);
  });

  it('rejects "alice space@example.com" (space in local part — header-injection guard)', () => {
    expect(validateEmail('alice space@example.com').ok).toBe(false);
  });

  // Defensive: handle non-string and oversize input the same way the
  // other validators in this file do.

  it('rejects non-string input', () => {
    expect(validateEmail(42 as unknown as string).ok).toBe(false);
    expect(validateEmail(null as unknown as string).ok).toBe(false);
  });

  it('rejects empty string', () => {
    expect(validateEmail('').ok).toBe(false);
  });

  it('rejects emails longer than LIMITS.EMAIL_MAX (320 chars)', () => {
    // 320 chars exactly should pass (the regex still matches); 321 should fail.
    const exactly320 = 'a'.repeat(310) + '@example.com'; // 310 + 12 = 322, too long
    expect(validateEmail(exactly320).ok).toBe(false);
  });

  it('rejects CR/LF (header injection guard)', () => {
    // The character set in the regex disallows CR/LF, so any string
    // containing them is rejected at the shape check.
    expect(validateEmail('alice\n@example.com').ok).toBe(false);
    expect(validateEmail('alice\r\n@example.com').ok).toBe(false);
  });

  it('preserves the input case (validateEmail does NOT lowercase)', () => {
    // Case-normalization is the subscriber-specific validator's job.
    // validateEmail is the generic primitive; it returns what it got.
    expect(validateEmail('Alice@Example.com')).toEqual({ ok: true, value: 'Alice@Example.com' });
  });
});

describe('validateSubscriberEmail', () => {
  it('accepts a normal email and lowercases the result', () => {
    // The DB unique index treats 'Alice@Example.com' and
    // 'alice@example.com' as the same row; normalization must happen
    // at the boundary so the route doesn't have to remember.
    expect(validateSubscriberEmail('Alice@Example.com')).toEqual({ ok: true, value: 'alice@example.com' });
  });

  it('accepts plus-addressed emails and lowercases the result', () => {
    expect(validateSubscriberEmail('Alice+Test@Example.COM')).toEqual({ ok: true, value: 'alice+test@example.com' });
  });

  it('rejects malformed input the same way validateEmail does (no double-validation drift)', () => {
    expect(validateSubscriberEmail('not-an-email').ok).toBe(false);
    expect(validateSubscriberEmail('@').ok).toBe(false);
    expect(validateSubscriberEmail('alice@').ok).toBe(false);
    expect(validateSubscriberEmail('alice@.com').ok).toBe(false);
    expect(validateSubscriberEmail('alice space@example.com').ok).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(validateSubscriberEmail(42 as unknown as string).ok).toBe(false);
  });
});

describe('validatePinText', () => {
  // Accept cases.

  it('accepts "Hello"', () => {
    expect(validatePinText('Hello')).toEqual({ ok: true, value: 'Hello' });
  });

  it('trims leading/trailing whitespace and returns the trimmed value', () => {
    // The trim happens inside the validator so the route doesn't
    // have to remember to .trim() before length-checking.
    expect(validatePinText('  trimmed  ')).toEqual({ ok: true, value: 'trimmed' });
  });

  it('accepts a 1-character string (lower bound)', () => {
    expect(validatePinText('a')).toEqual({ ok: true, value: 'a' });
  });

  it('accepts a 2000-character string (upper bound)', () => {
    const text = 'a'.repeat(2000);
    expect(validatePinText(text)).toEqual({ ok: true, value: text });
  });

  // Reject cases.

  it('rejects an empty string (after trim)', () => {
    const r = validatePinText('');
    expect(r.ok).toBe(false);
    // The error message mentions "empty" so the dashboard can show
    // a user-friendly error.
    if (!r.ok) expect(r.error).toMatch(/empty/);
  });

  it('rejects a string of only whitespace (trimmed to empty)', () => {
    expect(validatePinText('     ').ok).toBe(false);
  });

  it('rejects a 2001-character string (one over the upper bound)', () => {
    const r = validatePinText('a'.repeat(2001));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/2000/);
  });

  it('rejects a string containing U+0000 (null byte) — defense-in-depth', () => {
    // Null bytes truncate C strings and have broken log aggregators
    // and a few ORMs in the past. The pin-comment text is stored as
    // a Postgres text column, but a stray null could still trip a
    // downstream log/email/Markdown tool. Reject at the boundary.
    const r = validatePinText('with\u0000null');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/null/);
  });

  it('rejects non-string input', () => {
    expect(validatePinText(42 as unknown as string).ok).toBe(false);
    expect(validatePinText(null as unknown as string).ok).toBe(false);
  });

  it('accepts multi-line text (newlines are NOT stripped, unlike sanitizeText)', () => {
    // The new validator is intentionally more permissive than
    // sanitizeText for control chars — only null bytes are rejected.
    // Newlines/tabs let users write structured feedback.
    expect(validatePinText('line 1\nline 2\tindented')).toEqual({
      ok: true,
      value: 'line 1\nline 2\tindented',
    });
  });
});
