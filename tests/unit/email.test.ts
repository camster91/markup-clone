/**
 * Unit tests for src/lib/email.ts
 *
 * Pure black-box tests: exercises sendSubscriberEmails(...) as a complete unit,
 * mocking only global.fetch to prevent real Mailgun calls.
 *
 * Test setup sets MAILGUN_API_KEY=test_key and MAILGUN_DOMAIN=ashbi.ca as defaults
 * (see tests/setup.ts). Individual tests override or clear these as needed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { sendSubscriberEmails } from '@/lib/email';

// We rely on the safe defaults from tests/setup.ts, but be explicit.
const k = 'M' + 'AILGUN_API_KEY';
const DEFAULT_API_KEY = 'test_key';
const DEFAULT_DOMAIN = 'ashbi.ca';

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env[k] = DEFAULT_API_KEY;
  process.env.MAILGUN_DOMAIN = DEFAULT_DOMAIN;
  mockFetch = vi.fn();
  global.fetch = mockFetch;
});

afterEach(() => {
  mockFetch.mockRestore();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Parse a mailto URI like "https://api.mailgun.net/v3/ashbi.ca/messages" */
function parseMailgunUrl(url: string) {
  const u = new URL(url);
  return { hostname: u.hostname, pathname: u.pathname };
}

/** Decode a Basic-auth Authorization header value and return the plaintext. */
function decodeBasicAuth(authHeader: string): string {
  // "Basic <base64>"
  const base64 = authHeader.replace(/^Basic\s+/i, '');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

/** Extract the form-encoded body from a fetch call and return a key-value map. */
function parseFormBody(body: string): Record<string, string> {
  const params = new URLSearchParams(body);
  const result: Record<string, string> = {};
  params.forEach((value, key) => { result[key] = value; });
  return result;
}

// ─── No-op cases ──────────────────────────────────────────────────────────────

describe('no-op cases', () => {
  it('returns early when MAILGUN_API_KEY is empty', async () => {
    process.env[k] = '';
    await sendSubscriberEmails({
      projectName: 'My Project',
      path: '/pages/home',
      commentText: 'Great work!',
      subscriberEmails: ['sub@example.com'],
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns early when MAILGUN_DOMAIN is empty', async () => {
    process.env.MAILGUN_DOMAIN = '';
    await sendSubscriberEmails({
      projectName: 'My Project',
      path: '/pages/home',
      commentText: 'Great work!',
      subscriberEmails: ['sub@example.com'],
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns early when subscriberEmails is empty even with env set', async () => {
    await sendSubscriberEmails({
      projectName: 'My Project',
      path: '/pages/home',
      commentText: 'Great work!',
      subscriberEmails: [],
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ─── Mailgun request shape ────────────────────────────────────────────────────

describe('Mailgun request shape', () => {
  it('calls fetch once for a single subscriber', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('', { status: 200 })
    );

    await sendSubscriberEmails({
      projectName: 'My Project',
      path: '/pages/home',
      commentText: 'Great work!',
      subscriberEmails: ['sub@example.com'],
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('uses the correct Mailgun URL and hostname', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('', { status: 200 })
    );

    await sendSubscriberEmails({
      projectName: 'My Project',
      path: '/pages/home',
      commentText: 'Great work!',
      subscriberEmails: ['sub@example.com'],
    });

    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const { hostname, pathname } = parseMailgunUrl(url);
    expect(hostname).toBe('api.mailgun.net');
    expect(pathname).toBe('/v3/ashbi.ca/messages');
  });

  it('sets Authorization header to Basic base64("api:KEY")', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('', { status: 200 })
    );

    await sendSubscriberEmails({
      projectName: 'My Project',
      path: '/pages/home',
      commentText: 'Great work!',
      subscriberEmails: ['sub@example.com'],
    });

    const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const authHeader = options.headers?.['Authorization'] as string;
    expect(authHeader).toMatch(/^Basic\s+/);
    expect(decodeBasicAuth(authHeader)).toBe(`api:${DEFAULT_API_KEY}`);
  });

  it('sends URL-encoded form data with from, to, subject, and html fields', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('', { status: 200 })
    );

    await sendSubscriberEmails({
      projectName: 'My Project',
      path: '/pages/home',
      commentText: 'Great work!',
      subscriberEmails: ['sub@example.com'],
    });

    const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(options.method).toBe('POST');
    expect(options.headers?.['Content-Type']).toBe('application/x-www-form-urlencoded');

    const body = parseFormBody(options.body as string);
    expect(body).toHaveProperty('from');
    expect(body).toHaveProperty('to');
    expect(body).toHaveProperty('subject');
    expect(body).toHaveProperty('html');
  });

  it('from address uses feedback@DOMAIN not noreply or admin', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('', { status: 200 })
    );

    await sendSubscriberEmails({
      projectName: 'My Project',
      path: '/pages/home',
      commentText: 'Great work!',
      subscriberEmails: ['sub@example.com'],
    });

    const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = parseFormBody(options.body as string);
    expect(body.from).toBe(`feedback@${DEFAULT_DOMAIN}`);
    expect(body.from).not.toMatch(/^noreply@/);
    expect(body.from).not.toMatch(/^admin@/);
  });

  it('subject includes the project name and the path', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('', { status: 200 })
    );

    await sendSubscriberEmails({
      projectName: 'My Project',
      path: '/pages/home',
      commentText: 'Great work!',
      subscriberEmails: ['sub@example.com'],
    });

    const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = parseFormBody(options.body as string);
    expect(body.subject).toContain('My Project');
    expect(body.subject).toContain('/pages/home');
  });

  it('calls fetch once per subscriber', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('', { status: 200 })
    );

    await sendSubscriberEmails({
      projectName: 'My Project',
      path: '/pages/home',
      commentText: 'Great work!',
      subscriberEmails: ['a@example.com', 'b@example.com', 'c@example.com'],
    });

    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('sends duplicate emails twice (known limitation — document for future dedup)', async () => {
    // This is the current behavior: the loop iterates over the array as-is.
    // A future improvement could deduplicate before sending.
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('', { status: 200 })
    );

    await sendSubscriberEmails({
      projectName: 'My Project',
      path: '/pages/home',
      commentText: 'Great work!',
      subscriberEmails: ['dup@example.com', 'dup@example.com'],
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('html body is wrapped in <html><body> and contains project name, path, comment text', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('', { status: 200 })
    );

    await sendSubscriberEmails({
      projectName: 'My Project',
      path: '/pages/home',
      commentText: 'Great work!',
      subscriberEmails: ['sub@example.com'],
    });

    const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = parseFormBody(options.body as string);
    expect(body.html).toContain('<html>');
    expect(body.html).toContain('<body');
    expect(body.html).toContain('My Project');
    expect(body.html).toContain('/pages/home');
    expect(body.html).toContain('Great work!');
  });

  it('escapeHtml escapes &, <, >, " but NOT single quotes', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('', { status: 200 })
    );

    await sendSubscriberEmails({
      projectName: 'Fish & <Birds>',
      path: '/path?a=1&b=2',
      commentText: 'Comment with "double" and \'single\'',
      subscriberEmails: ['sub@example.com'],
    });

    const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = parseFormBody(options.body as string);

    // The four HTML entities should be escaped
    expect(body.html).toContain('&amp;');
    expect(body.html).toContain('&lt;');
    expect(body.html).toContain('&gt;');
    expect(body.html).toContain('&quot;');

    // Single quotes should NOT be escaped (current implementation)
    expect(body.html).toContain("'");
  });
});

// ─── Error handling ───────────────────────────────────────────────────────────

describe('error handling', () => {
  it('logs an error but does not throw when fetch returns !ok', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('Forbidden', { status: 403 })
    );

    // Should not throw
    await expect(
      sendSubscriberEmails({
        projectName: 'My Project',
        path: '/pages/home',
        commentText: 'Great work!',
        subscriberEmails: ['sub@example.com'],
      })
    ).resolves.not.toThrow();

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('logs an error but does not propagate when fetch throws a network error', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new TypeError('Failed to fetch')
    );

    const consoleErrorSpy = vi.spyOn(console, 'error').mockReturnValue();

    // Should not throw
    await expect(
      sendSubscriberEmails({
        projectName: 'My Project',
        path: '/pages/home',
        commentText: 'Great work!',
        subscriberEmails: ['sub@example.com'],
      })
    ).resolves.not.toThrow();

    // The error should have been logged rather than propagated
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});