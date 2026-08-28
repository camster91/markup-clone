import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  normalizeOrigin,
  parseArgs,
  verifyPublicRelease,
} = require('../../scripts/verify-public-release.cjs');

const commonHeaders = {
  'Content-Security-Policy':
    "default-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests",
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), browsing-topics=()',
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function fixture({
  widget = 'console.log("release");',
  omitHeader = '',
  softRedirect = false,
  workspaceApiStatus = 401,
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'markup-public-release-'));
  temporaryDirectories.push(directory);
  const widgetPath = join(directory, 'widget.js');
  await writeFile(widgetPath, widget);

  const fetchImpl = async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const headers = new Headers();
    for (const [name, value] of Object.entries(commonHeaders)) {
      if (name.toLowerCase() !== omitHeader.toLowerCase()) headers.set(name, value);
    }

    if (url.pathname === '/api/health') {
      headers.set('Content-Type', 'application/json');
      return new Response(
        JSON.stringify({ status: 'ok', timestamp: '2026-08-28T00:00:00.000Z' }),
        { status: 200, headers },
      );
    }
    if (url.pathname === '/widget.js') {
      headers.set('Content-Type', 'application/javascript');
      return new Response(widget, { status: 200, headers });
    }
    if (url.pathname === '/api/workspaces') {
      headers.set('Content-Type', 'application/json');
      return new Response(
        JSON.stringify(
          workspaceApiStatus === 401
            ? { error: 'Unauthorized' }
            : { workspaces: [{ id: 'unexpected' }] },
        ),
        { status: workspaceApiStatus, headers },
      );
    }
    if (url.pathname === '/workspaces' && softRedirect) {
      headers.set('Content-Type', 'text/html; charset=utf-8');
      return new Response(
        '<template data-dgst="NEXT_REDIRECT;replace;/?next=%2Fworkspaces#sign-in;307;"></template>',
        { status: 200, headers },
      );
    }
    if (url.pathname === '/workspaces') {
      headers.set('Location', '/');
      return new Response(null, { status: 307, headers });
    }
    if (url.pathname === '/') {
      headers.set('Content-Type', 'text/html; charset=utf-8');
      headers.set('Cache-Control', 'private, no-cache, no-store');
      return new Response('<!doctype html><title>Markup</title>', {
        status: 200,
        headers,
      });
    }
    return new Response(null, { status: 404, headers });
  };

  return { origin: 'https://feedback.example', widgetPath, widget, fetchImpl };
}

describe('public release verifier', () => {
  it('proves health, headers, anonymous redirect, and exact widget provenance', async () => {
    const { origin, widgetPath, widget, fetchImpl } = await fixture();
    const result = await verifyPublicRelease({
      origin,
      expectedWidgetPath: widgetPath,
      fetchImpl,
    });

    expect(result.schema).toBe('ashbi.public-release.v1');
    expect(result.health.status).toBe('ok');
    expect(result.routes).toEqual({
      root: 200,
      health: 200,
      anonymousWorkspaces: {
        pageStatus: 307,
        apiStatus: 401,
        boundary: 'http-redirect',
      },
      widget: 200,
    });
    expect(result.widget.sha256).toBe(
      createHash('sha256').update(widget).digest('hex'),
    );
    expect(result.security.poweredByHidden).toBe(true);
    expect(result.security.trustedHttps).toBe(true);
  });

  it('accepts Next.js streamed redirects only when the anonymous API is denied', async () => {
    const { origin, widgetPath, fetchImpl } = await fixture({ softRedirect: true });
    const result = await verifyPublicRelease({
      origin,
      expectedWidgetPath: widgetPath,
      fetchImpl,
    });
    expect(result.routes.anonymousWorkspaces).toEqual({
      pageStatus: 200,
      apiStatus: 401,
      boundary: 'next-streamed-redirect',
    });
  });

  it('fails closed when the anonymous workspaces API returns data', async () => {
    const { origin, widgetPath, fetchImpl } = await fixture({ workspaceApiStatus: 200 });
    await expect(
      verifyPublicRelease({ origin, expectedWidgetPath: widgetPath, fetchImpl }),
    ).rejects.toThrow('anonymous /api/workspaces returned HTTP 200 instead of 401');
  });

  it('fails closed when a required security header is absent', async () => {
    const { origin, widgetPath, fetchImpl } = await fixture({
      omitHeader: 'X-Frame-Options',
    });
    await expect(
      verifyPublicRelease({ origin, expectedWidgetPath: widgetPath, fetchImpl }),
    ).rejects.toThrow('invalid or missing x-frame-options');
  });

  it('fails closed when the deployed widget differs from the release artifact', async () => {
    const { origin, widgetPath, fetchImpl } = await fixture({
      widget: 'console.log("deployed");',
    });
    await writeFile(widgetPath, 'console.log("expected");');
    await expect(
      verifyPublicRelease({ origin, expectedWidgetPath: widgetPath, fetchImpl }),
    ).rejects.toThrow('widget provenance mismatch');
  });

  it('rejects credentialed or non-TLS public origins and unknown arguments', () => {
    expect(normalizeOrigin('http://127.0.0.1:3030')).toBe('http://127.0.0.1:3030');
    expect(() => normalizeOrigin('http://example.com')).toThrow('trusted HTTPS');
    expect(() => normalizeOrigin('https://user:secret@example.com')).toThrow(
      'must not contain credentials',
    );
    expect(() => parseArgs(['--surprise'])).toThrow('unknown argument');
  });
});
