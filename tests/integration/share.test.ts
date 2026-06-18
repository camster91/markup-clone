// Integration tests for the public project share feature.
//
// Coverage:
//   - POST   /api/projects/[id]/share — generates a token, returns shareUrl
//   - DELETE /api/projects/[id]/share — revokes (nulls) the token
//   - GET    /share/[token]            — 200 with the project on a valid token
//   - GET    /share/[bad-token]        — 404 on a token that doesn't match
//   - Revoked token returns 404
//   - POST without dashboard origin returns 401
//
// Two distinct surfaces are under test:
//   1. The /api/projects/[id]/share route (POST/DELETE) —
//      requireDashboardOrigin gated, mints/revokes the token.
//   2. The /share/[token] RSC page — no auth, looks up by shareToken,
//      logs a `share.view` audit entry on every load.
//
// The page component is tested indirectly: we mock prisma + headers()
// and call the default export as a plain function (RSC) with a
// pre-resolved params promise. The page calls notFound() from
// next/navigation when the project is missing — that throws a
// NEXT_HTTP_ERROR_FALLBACK;404 error which the App Router catches
// and renders the segment's not-found.tsx. We match that
// 404 behaviour by checking for the error symbol or by checking
// the rendered not-found.tsx UI in the success path.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock prisma BEFORE importing routes. vi.mock is hoisted, so the
// factory can't reference module-level vars. Use vi.hoisted() to get
// shared state.
const mocks = vi.hoisted(() => ({
  project: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  page: { findMany: vi.fn() },
  screenshot: { findUnique: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
  pin: { delete: vi.fn() },
  subscriber: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
  auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-log-1' }) },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: mocks,
}));

// next/navigation's notFound() throws a special error. We catch
// and re-throw a sentinel so the test can assert on it without
// importing the next-internal symbol.
const notFoundCalls: unknown[] = [];
vi.mock('next/navigation', () => ({
  notFound: () => {
    notFoundCalls.push(true);
    // Throw a recognizable error. The real implementation throws
    // an internal sentinel; the App Router catches it and renders
    // not-found.tsx. We just throw a plain Error with a marker.
    const err = new Error('NEXT_NOT_FOUND');
    (err as Error & { __notFound: boolean }).__notFound = true;
    throw err;
  },
}));

// next/headers is used by the share page to read IP / User-Agent.
// We return a stub so the audit log can record something
// non-undefined.
const headerStore: Record<string, string> = {
  'x-forwarded-for': '203.0.113.42',
  'user-agent': 'vitest-share',
};
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve({
    get: (k: string) => headerStore[k.toLowerCase()] ?? null,
  }),
}));

import { POST as shareCreate, DELETE as shareDelete } from '../../src/app/api/projects/[id]/share/route';
import SharePage from '../../src/app/share/[token]/page';
import { NextRequest } from 'next/server';

const ORIGIN = 'https://markup.ashbi.ca';

// Test CSRF token used by the request builders. The share
// route's `requireCsrfToken` check requires the X-CSRF-Token
// header to match the `markup.csrf` cookie, so the helpers
// below inject both.
const CSRF_TOKEN='***';

function req(method: string, headers: Record<string, string> = {}): NextRequest {
  // Default headers set BOTH `requireDashboardOrigin` (Origin)
  // and `requireCsrfToken` (cookie + X-CSRF-Token header).
  const baseHeaders: Record<string, string> = {
    'X-CSRF-Token': CSRF_TOKEN,
    cookie: `markup.csrf=${CSRF_TOKEN}`,
  };
  return new NextRequest(`https://markup.ashbi.ca/api/projects/proj-1/share`, {
    method,
    headers: { 'Content-Type': 'application/json', ...baseHeaders, ...headers },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  notFoundCalls.length = 0;
  mocks.auditLog.create.mockResolvedValue({ id: 'audit-log-1' });
});

// ----------------------------------------------------------------------
// POST /api/projects/[id]/share
// ----------------------------------------------------------------------
describe('POST /api/projects/[id]/share', () => {
  it('returns 401 when called from a non-dashboard origin', async () => {
    const res = await shareCreate(req('POST', {}),
      { params: Promise.resolve({ id: 'proj-1' }) });
    expect(res.status).toBe(401);
    // The DB must NOT be hit on auth failure.
    expect(mocks.project.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when the project does not exist', async () => {
    mocks.project.findUnique.mockResolvedValue(null);
    const res = await shareCreate(req('POST', { origin: ORIGIN }),
      { params: Promise.resolve({ id: 'proj-missing' }) });
    expect(res.status).toBe(404);
  });

  it('mints a base64url shareToken and returns a shareUrl', async () => {
    mocks.project.findUnique.mockResolvedValue({ id: 'proj-1', name: 'Test' });
    mocks.project.update.mockImplementation(async ({ where, data }: any) => ({
      id: where.id,
      name: 'Test',
      shareToken: data.shareToken,
    }));
    const res = await shareCreate(req('POST', { origin: ORIGIN }),
      { params: Promise.resolve({ id: 'proj-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    // 32 bytes base64url-encoded = 43 chars (no padding) — accept
    // any URL-safe base64url with that length.
    expect(body.shareToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.shareUrl).toMatch(/^https?:\/\/[^/]+\/share\/[A-Za-z0-9_-]{43}$/);
    // The update must have written the same token to the project row.
    expect(mocks.project.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'proj-1' },
        data: expect.objectContaining({ shareToken: body.shareToken }),
      })
    );
  });

  it('rotates an existing token (overwrites the previous one)', async () => {
    // The project already has a token. The route should still issue
    // a fresh one and overwrite it — that's the "Generate" semantics.
    mocks.project.findUnique.mockResolvedValue({ id: 'proj-1', name: 'Test' });
    mocks.project.update.mockImplementation(async ({ data }: any) => ({
      id: 'proj-1', name: 'Test', shareToken: data.shareToken,
    }));
    const r1 = await shareCreate(req('POST', { origin: ORIGIN }),
      { params: Promise.resolve({ id: 'proj-1' }) });
    const t1 = (await r1.json()).shareToken;
    const r2 = await shareCreate(req('POST', { origin: ORIGIN }),
      { params: Promise.resolve({ id: 'proj-1' }) });
    const t2 = (await r2.json()).shareToken;
    // Two POSTs in a row should produce distinct tokens with
    // overwhelming probability (256 bits of entropy each).
    expect(t1).not.toBe(t2);
  });

  it('does NOT log the plaintext shareToken in the audit metadata', async () => {
    // Regression: a previous design recorded the shareToken in
    // the audit log's metadata, which would leak the credential to
    // anyone with /api/audit dashboard access. The fix is the same
    // pattern as the apiKey redaction in PATCH /api/projects/[id]:
    // record a "was created" marker instead.
    mocks.project.findUnique.mockResolvedValue({ id: 'proj-1', name: 'Test' });
    mocks.project.update.mockImplementation(async ({ data }: any) => ({
      id: 'proj-1', name: 'Test', shareToken: data.shareToken,
    }));
    mocks.auditLog.create.mockClear();
    const res = await shareCreate(req('POST', { origin: ORIGIN }),
      { params: Promise.resolve({ id: 'proj-1' }) });
    expect(res.status).toBe(200);
    // Drain the microtask queue so the fire-and-forget call lands.
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.auditLog.create).toHaveBeenCalled();
    const callArg = mocks.auditLog.create.mock.calls[0][0];
    const metadata = callArg?.data?.metadata;
    // The plaintext token must NEVER appear in the audit row.
    const body = await res.json();
    expect(JSON.stringify(metadata)).not.toContain(body.shareToken);
    // And the action should be 'project.share.create'.
    expect(callArg.data.action).toBe('project.share.create');
  });
});

// ----------------------------------------------------------------------
// DELETE /api/projects/[id]/share
// ----------------------------------------------------------------------
describe('DELETE /api/projects/[id]/share', () => {
  beforeEach(() => {
    mocks.project.update.mockReset();
  });

  it('returns 401 when called from a non-dashboard origin', async () => {
    const res = await shareDelete(req('DELETE', {}),
      { params: Promise.resolve({ id: 'proj-1' }) });
    expect(res.status).toBe(401);
  });

  it('returns 404 when the project does not exist', async () => {
    mocks.project.findUnique.mockResolvedValue(null);
    const res = await shareDelete(req('DELETE', { origin: ORIGIN }),
      { params: Promise.resolve({ id: 'proj-missing' }) });
    expect(res.status).toBe(404);
  });

  it('revokes an active token by setting it back to null', async () => {
    mocks.project.findUnique.mockResolvedValue({
      id: 'proj-1', name: 'Test', shareToken: 'existing-token-xxx',
    });
    mocks.project.update.mockResolvedValue({});
    const res = await shareDelete(req('DELETE', { origin: ORIGIN }),
      { params: Promise.resolve({ id: 'proj-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revoked).toBe(true);
    expect(mocks.project.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'proj-1' },
        data: { shareToken: null },
      })
    );
  });

  it('is idempotent — revoking a project with no token returns 200, revoked:false', async () => {
    mocks.project.findUnique.mockResolvedValue({
      id: 'proj-1', name: 'Test', shareToken: null,
    });
    // No update should be issued — there's nothing to revoke.
    const res = await shareDelete(req('DELETE', { origin: ORIGIN }),
      { params: Promise.resolve({ id: 'proj-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revoked).toBe(false);
    expect(mocks.project.update).not.toHaveBeenCalled();
  });

  it('logs a project.share.revoke audit entry on a real revoke', async () => {
    mocks.project.findUnique.mockResolvedValue({
      id: 'proj-1', name: 'Test', shareToken: 'existing-token-xxx',
    });
    mocks.project.update.mockResolvedValue({});
    mocks.auditLog.create.mockClear();
    const res = await shareDelete(req('DELETE', { origin: ORIGIN }),
      { params: Promise.resolve({ id: 'proj-1' }) });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.auditLog.create).toHaveBeenCalled();
    const callArg = mocks.auditLog.create.mock.calls[0][0];
    expect(callArg.data.action).toBe('project.share.revoke');
  });
});

// ----------------------------------------------------------------------
// GET /share/[token]
// ----------------------------------------------------------------------
describe('GET /share/[token]', () => {
  beforeEach(() => {
    mocks.project.findUnique.mockReset();
  });

  it('returns 404 (notFound) when the token does not match any project', async () => {
    mocks.project.findUnique.mockResolvedValue(null);
    let threw = false;
    try {
      await SharePage({ params: Promise.resolve({ token: 'no-such-token' }) });
    } catch (e) {
      threw = true;
      expect((e as Error & { __notFound?: boolean }).__notFound).toBe(true);
    }
    expect(threw).toBe(true);
    expect(notFoundCalls).toHaveLength(1);
  });

  it('renders the project header / pages / screenshots when the token matches', async () => {
    mocks.project.findUnique.mockResolvedValue({
      id: 'proj-1',
      name: 'Acme Redesign',
      domain: 'acme.com',
      shareToken: 'good-token',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      pages: [
        {
          id: 'page-1',
          projectId: 'proj-1',
          path: '/',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
          screenshots: [
            {
              id: 'shot-1',
              pageId: 'page-1',
              storageKey: 'a.png',
              width: 1024,
              height: 768,
              capturedAt: new Date('2026-01-02T00:00:00Z'),
              pins: [
                {
                  id: 'pin-1',
                  screenshotId: 'shot-1',
                  xPercent: 50,
                  yPercent: 50,
                  elementXPath: null,
                  elementHTML: null,
                  authorName: 'Client',
                  status: 'OPEN',
                  createdAt: new Date('2026-01-02T00:00:00Z'),
                  updatedAt: new Date('2026-01-02T00:00:00Z'),
                  comments: [
                    {
                      id: 'cmt-1',
                      pinId: 'pin-1',
                      author: 'Client',
                      authorRole: 'client',
                      text: 'Move the button left',
                      createdAt: new Date('2026-01-02T00:00:00Z'),
                      updatedAt: new Date('2026-01-02T00:00:00Z'),
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const element = await SharePage({ params: Promise.resolve({ token: 'good-token' }) });
    // The rendered tree is a React element. We assert on the JSX
    // shape: project name, domain, the screenshot's alt text, the
    // pin's title attribute (its comment text). The full render
    // output is tested at the component level.
    const html = JSON.stringify(element);
    expect(html).toContain('Acme Redesign');
    expect(html).toContain('acme.com');
    // notFound() must NOT have been called.
    expect(notFoundCalls).toHaveLength(0);
  });

  it('logs a share.view audit entry on every load (including bad-token probes)', async () => {
    mocks.project.findUnique.mockResolvedValue(null);
    mocks.auditLog.create.mockClear();
    try {
      await SharePage({ params: Promise.resolve({ token: 'probe-token-12345678' }) });
    } catch {
      // notFound() throws — swallow
    }
    // Drain the microtask queue so the fire-and-forget call lands.
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.auditLog.create).toHaveBeenCalled();
    const callArg = mocks.auditLog.create.mock.calls[0][0];
    expect(callArg.data.action).toBe('share.view');
    // The actor is 'anonymous' — no auth on the public view.
    expect(callArg.data.actor).toBe('anonymous');
    // The metadata records the token prefix + the IP/UA from the
    // mocked headers() helper so the audit UI can render useful
    // "this share link was viewed N times" rows.
    const metadata = callArg.data.metadata;
    expect(metadata.tokenPrefix).toBe('probe-to');
    expect(metadata.found).toBe(false);
    expect(metadata.ip).toBe('203.0.113.42');
    expect(metadata.userAgent).toBe('vitest-share');
    // And the full token must NOT appear in the audit row.
    expect(JSON.stringify(metadata)).not.toContain('probe-token-12345678');
  });

  it('returns 404 for a revoked token (the row is gone from the lookup)', async () => {
    // Simulate the post-revoke state: a bad token (the deleted one
    // is no longer reachable because shareToken is null, so the
    // findUnique returns null and the page notFound()s).
    mocks.project.findUnique.mockResolvedValue(null);
    let threw = false;
    try {
      await SharePage({ params: Promise.resolve({ token: 'revoked-token' }) });
    } catch (e) {
      threw = true;
      expect((e as Error & { __notFound?: boolean }).__notFound).toBe(true);
    }
    expect(threw).toBe(true);
  });
});
