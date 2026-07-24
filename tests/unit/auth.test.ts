// Unit tests for src/lib/auth.ts
// Tests the auth primitives that gate every API route.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock @prisma/client BEFORE importing auth — auth depends on it via prisma.ts
const authMocks = vi.hoisted(() => ({
  project: { findUnique: vi.fn() },
  session: { findUnique: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: authMocks,
}));

const cookieStore = vi.hoisted(() => {
  const data: { value?: string } = { value: undefined };
  return {
    data,
    get: (name: string) =>
      data.value !== undefined ? { name, value: data.value } : undefined,
    set: (_n: string, value: string) => {
      data.value = value === '' ? undefined : value;
    },
    delete: () => {
      data.value = undefined;
    },
    has: () => data.value !== undefined,
  };
});

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => cookieStore),
}));

import {
  isDashboardOrigin,
  requireDashboardOrigin,
  requireDashboardSession,
  requireProjectKey,
  generateApiKey,
} from '@/lib/auth';
import { prisma } from '@/lib/prisma';

function makeReq(headers: Record<string, string>): Request {
  return new Request('https://markup.ashbi.ca/api/test', { headers });
}

function liveSession() {
  return {
    id: 'session-test-1',
    userId: 'user-test-1',
    token: 'test-dashboard-session',
    expiresAt: new Date(Date.now() + 3600_000),
    createdAt: new Date(),
    user: { id: 'user-test-1', email: 'operator@example.com', role: 'operator' },
  };
}

describe('isDashboardOrigin', () => {
  const ORIGINAL = process.env.DASHBOARD_HOST;
  beforeEach(() => { process.env.DASHBOARD_HOST = 'markup.ashbi.ca'; });
  afterEach(() => { process.env.DASHBOARD_HOST = ORIGINAL; });

  it('accepts an Origin header that includes the dashboard host', () => {
    expect(isDashboardOrigin(makeReq({ origin: 'https://markup.ashbi.ca' }))).toBe(true);
  });

  it('accepts an Origin header that is a subdomain of the dashboard host', () => {
    // Defensive: if someone hosts admin on admin.markup.ashbi.ca, they pass.
    expect(isDashboardOrigin(makeReq({ origin: 'https://admin.markup.ashbi.ca' }))).toBe(true);
  });

  it('rejects an Origin header from a different host entirely', () => {
    expect(isDashboardOrigin(makeReq({ origin: 'https://evil.com' }))).toBe(false);
  });

  it('rejects when Origin is absent AND sec-fetch-site is not same-origin', () => {
    // A direct curl from anywhere has no Origin header. The auth model is:
    // dashboard calls have Origin; widget calls have X-Api-Key.
    // So missing Origin without same-origin = no dashboard access.
    expect(isDashboardOrigin(makeReq({}))).toBe(false);
  });

  it('accepts when sec-fetch-site is same-origin (browser same-origin fetch)', () => {
    expect(isDashboardOrigin(makeReq({ 'sec-fetch-site': 'same-origin' }))).toBe(true);
  });

  it('rejects when sec-fetch-site is cross-site (browser cross-origin fetch)', () => {
    expect(isDashboardOrigin(makeReq({
      'sec-fetch-site': 'cross-site',
      'origin': 'https://evil.com',
    }))).toBe(false);
  });

  it('honors a custom DASHBOARD_HOST env var', () => {
    process.env.DASHBOARD_HOST = 'feedback.example.com';
    expect(isDashboardOrigin(makeReq({ origin: 'https://feedback.example.com' }))).toBe(true);
    expect(isDashboardOrigin(makeReq({ origin: 'https://markup.ashbi.ca' }))).toBe(false);
  });

  it('treats an empty-string Origin as absent', () => {
    expect(isDashboardOrigin(makeReq({ origin: '' }))).toBe(false);
  });

  it('rejects an Origin that contains the dashboard host as a substring (not a host match)', () => {
    // Old `String.includes()` check accepted these. The strict-host check must not.
    expect(isDashboardOrigin(makeReq({ origin: 'https://evil.com/?next=markup.ashbi.ca' }))).toBe(false);
    expect(isDashboardOrigin(makeReq({ origin: 'https://markup.ashbi.ca.evil.com' }))).toBe(false);
  });

  it('rejects an Origin with a different port even on the same host', () => {
    // `markup.ashbi.ca:8080` is not the dashboard host.
    expect(isDashboardOrigin(makeReq({ origin: 'https://markup.ashbi.ca:8080' }))).toBe(false);
  });
});

describe('requireDashboardOrigin', () => {
  beforeEach(() => { process.env.DASHBOARD_HOST = 'markup.ashbi.ca'; });

  it('returns null (allow) when origin matches', () => {
    const res = requireDashboardOrigin(makeReq({ origin: 'https://markup.ashbi.ca' }));
    expect(res).toBeNull();
  });

  it('returns 401 response when origin does not match', async () => {
    const res = requireDashboardOrigin(makeReq({ origin: 'https://evil.com' }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    const body = await res!.json();
    expect(body.error).toBe('Unauthorized');
  });
});

describe('requireDashboardSession', () => {
  beforeEach(() => {
    process.env.DASHBOARD_HOST = 'markup.ashbi.ca';
    cookieStore.data.value = 'test-dashboard-session';
    authMocks.session.findUnique.mockResolvedValue(liveSession());
  });

  it('returns null when Origin matches and a live session cookie is present', async () => {
    const res = await requireDashboardSession(makeReq({ origin: 'https://markup.ashbi.ca' }));
    expect(res).toBeNull();
  });

  it('returns 401 when Origin is wrong even with a live session', async () => {
    const res = await requireDashboardSession(makeReq({ origin: 'https://evil.com' }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it('returns 401 when Origin matches but there is no session cookie', async () => {
    cookieStore.data.value = undefined;
    const res = await requireDashboardSession(makeReq({ origin: 'https://markup.ashbi.ca' }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it('returns 401 when Origin matches but the session row is missing', async () => {
    authMocks.session.findUnique.mockResolvedValue(null);
    const res = await requireDashboardSession(makeReq({ origin: 'https://markup.ashbi.ca' }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });
});

describe('requireProjectKey', () => {
  const mockFindUnique = prisma.project.findUnique as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.DASHBOARD_HOST = 'markup.ashbi.ca';
    mockFindUnique.mockReset();
    cookieStore.data.value = undefined;
    authMocks.session.findUnique.mockResolvedValue(null);
  });

  it('allows dashboard-origin + live session without an X-Api-Key', async () => {
    cookieStore.data.value = 'test-dashboard-session';
    authMocks.session.findUnique.mockResolvedValue(liveSession());
    const res = await requireProjectKey(makeReq({ origin: 'https://markup.ashbi.ca' }), 'proj-id');
    expect(res).toBeNull();
  });

  it('does NOT allow dashboard-origin alone without a session (Origin is forgeable)', async () => {
    const res = await requireProjectKey(makeReq({ origin: 'https://markup.ashbi.ca' }), 'proj-id');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    const body = await res!.json();
    expect(body.error).toBe('Missing X-Api-Key');
  });

  it('returns 401 if X-Api-Key is missing on a widget-origin call', async () => {
    const res = await requireProjectKey(makeReq({}), 'proj-id');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    const body = await res!.json();
    expect(body.error).toBe('Missing X-Api-Key');
  });

  it('returns 401 if X-Api-Key does not match the project key', async () => {
    mockFindUnique.mockResolvedValue({ apiKey: 'mk_correctkey123' });
    const res = await requireProjectKey(
      makeReq({ 'x-api-key': 'mk_wrongkey999' }),
      'proj-id'
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    const body = await res!.json();
    expect(body.error).toBe('Invalid API key');
  });

  it('returns 403 if the project does not exist (no apiKey row)', async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await requireProjectKey(
      makeReq({ 'x-api-key': 'mk_anykey' }),
      'proj-id'
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = await res!.json();
    expect(body.error).toBe('No API key for project');
  });

  it('returns null (allow) when the X-Api-Key matches the project key', async () => {
    mockFindUnique.mockResolvedValue({ apiKey: 'mk_correctkey' });
    const res = await requireProjectKey(
      makeReq({ 'x-api-key': 'mk_correctkey' }),
      'proj-id'
    );
    expect(res).toBeNull();
  });

  it('does a constant-ish lookup: prisma.findUnique is called with the project id', async () => {
    mockFindUnique.mockResolvedValue({ apiKey: 'mk_xx' });
    await requireProjectKey(makeReq({ 'x-api-key': 'mk_xx' }), 'specific-proj-id-42');
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: 'specific-proj-id-42' },
      select: { apiKey: true },
    });
  });
});

describe('generateApiKey', () => {
  it('returns a string starting with "mk_"', () => {
    const key = generateApiKey();
    expect(key.startsWith('mk_')).toBe(true);
  });

  it('returns a string of the expected length (mk_ + 40 hex chars = 43 total)', () => {
    const key = generateApiKey();
    // 3 chars 'mk_' + 40 hex chars = 43
    expect(key).toHaveLength(43);
  });

  it('uses only hex characters after the prefix', () => {
    const key = generateApiKey();
    const hex = key.slice(3);
    expect(hex).toMatch(/^[0-9a-f]{40}$/);
  });

  it('generates unique keys on consecutive calls', () => {
    const keys = new Set<string>();
    for (let i = 0; i < 1000; i++) keys.add(generateApiKey());
    expect(keys.size).toBe(1000);
  });

  it('has enough entropy that brute-forcing a project is infeasible', () => {
    // 40 hex chars = 20 bytes = 160 bits. Way more than needed.
    // Sanity: at least 32 hex chars (128 bits).
    const key = generateApiKey();
    expect(key.length - 3).toBeGreaterThanOrEqual(32);
  });
});
