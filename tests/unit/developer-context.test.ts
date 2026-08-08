import { describe, expect, it } from 'vitest';
import {
  normalizeBrowserContext,
  parseDeveloperContext,
  sanitizeElementSnippetHtml,
} from '@/lib/developer-context';

describe('developer context validation', () => {
  it('canonicalizes a matching page URL without credentials, query, or fragment', () => {
    const result = parseDeveloperContext({
      pageUrl: 'https://www.example.com/pricing?token=secret#checkout',
      viewportWidth: '1440',
      viewportHeight: '900',
      devicePixelRatio: '2',
      userAgent: 'Mozilla/5.0 Chrome/126.0.0.0 Safari/537.36',
      platform: 'Win32',
      selectorCandidatesJson: JSON.stringify(['#hero', '[data-testid="hero"]', '#hero']),
    }, 'example.com', '/pricing');

    expect(result).toEqual({
      ok: true,
      value: {
        pageUrl: 'https://www.example.com/pricing',
        viewportWidth: 1440,
        viewportHeight: 900,
        devicePixelRatio: 2,
        userAgent: 'Mozilla/5.0 Chrome/126.0.0.0 Safari/537.36',
        platform: 'Win32',
        selectorCandidatesJson: JSON.stringify(['#hero', '[data-testid="hero"]']),
      },
    });
  });

  it('rejects a URL for another project host or with credentials', () => {
    expect(parseDeveloperContext({ pageUrl: 'https://evil.example/path' }, 'example.com', '/path')).toMatchObject({ ok: false });
    expect(parseDeveloperContext({ pageUrl: 'https://user:pass@example.com/path' }, 'example.com', '/path')).toMatchObject({ ok: false });
  });

  it('rejects a URL whose path disagrees with the validated Page path', () => {
    const result = parseDeveloperContext({ pageUrl: 'https://example.com/other' }, 'example.com', '/expected');
    expect(result).toMatchObject({ ok: false });
  });

  it('rejects out-of-range viewport, DPR, and malformed selectors', () => {
    expect(parseDeveloperContext({ viewportWidth: '0' }, 'example.com', '/')).toMatchObject({ ok: false });
    expect(parseDeveloperContext({ viewportHeight: '10001' }, 'example.com', '/')).toMatchObject({ ok: false });
    expect(parseDeveloperContext({ devicePixelRatio: '11' }, 'example.com', '/')).toMatchObject({ ok: false });
    expect(parseDeveloperContext({ selectorCandidatesJson: '{}' }, 'example.com', '/')).toMatchObject({ ok: false });
    expect(parseDeveloperContext({ selectorCandidatesJson: JSON.stringify(['a'.repeat(501)]) }, 'example.com', '/')).toMatchObject({ ok: false });
  });

  it('accepts a completely absent packet for legacy and non-widget callers', () => {
    expect(parseDeveloperContext({}, 'example.com', '/')).toEqual({
      ok: true,
      value: {
        pageUrl: null,
        viewportWidth: null,
        viewportHeight: null,
        devicePixelRatio: null,
        userAgent: null,
        platform: null,
        selectorCandidatesJson: null,
      },
    });
  });
});

describe('server-side element snippet scrubbing', () => {
  it('removes values, token-like attributes, textarea content, and URL queries', () => {
    const html = '<form action="https://example.com/pay?session=secret"><input value="hunter2" data-auth-token="abc"><textarea>private note</textarea><a href="/account?token=secret#x">Account</a></form>';
    const scrubbed = sanitizeElementSnippetHtml(html);
    expect(scrubbed).not.toContain('hunter2');
    expect(scrubbed).not.toContain('private note');
    expect(scrubbed).not.toContain('data-auth-token');
    expect(scrubbed).not.toContain('session=');
    expect(scrubbed).not.toContain('token=');
    expect(scrubbed).toContain('href="/account"');
  });
});

describe('browser context normalization', () => {
  it('distinguishes Edge from Chrome and identifies Windows', () => {
    expect(normalizeBrowserContext(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
      'Win32'
    )).toEqual({ browser: 'Edge 126', platform: 'Windows' });
  });

  it('returns honest unknown labels when fields are absent', () => {
    expect(normalizeBrowserContext(null, null)).toEqual({ browser: 'Unknown browser', platform: 'Unknown platform' });
  });
});
