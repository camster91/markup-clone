import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { hashPassword } from '@/lib/password';
import { hashInvitationToken } from '@/lib/team-invitations';

const TOKEN = 'A'.repeat(43);
const TOKEN_HASH = hashInvitationToken(TOKEN);
const INVITATION_ID = '11111111-1111-4111-8111-111111111111';
const TEAM_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';

const mocks = vi.hoisted(() => ({
  teamInvitation: { findUnique: vi.fn(), updateMany: vi.fn() },
  teamMember: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  user: { findUnique: vi.fn(), create: vi.fn() },
  session: { create: vi.fn() },
  $transaction: vi.fn(),
}));

const auth = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireDashboardOrigin: vi.fn(),
}));
const csrf = vi.hoisted(() => ({ ensureCsrfCookie: vi.fn() }));
const consumeMock = vi.hoisted(() => vi.fn());
const auditMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: mocks }));
vi.mock('@/lib/auth', () => ({
  ...auth,
  SESSION_COOKIE: 'markup.session',
  SESSION_TTL_SECONDS: 7 * 24 * 60 * 60,
}));
vi.mock('@/lib/csrf', () => csrf);
vi.mock('@/lib/rate-limit', () => ({ consume: consumeMock }));
vi.mock('@/lib/audit', () => ({ audit: auditMock }));

import { POST as inspectInvitation } from '@/app/api/invitations/inspect/route';
import { POST as acceptInvitation } from '@/app/api/invitations/accept/route';

function request(path: 'inspect' | 'accept', body: unknown): NextRequest {
  return new NextRequest(`https://markup.ashbi.ca/api/invitations/${path}`, {
    method: 'POST',
    headers: {
      Origin: 'https://markup.ashbi.ca',
      'Content-Type': 'application/json',
      'X-Forwarded-For': '203.0.113.5',
    },
    body: JSON.stringify(body),
  });
}

const activeInvitation = () => ({
  id: INVITATION_ID,
  teamId: TEAM_ID,
  email: 'guest@example.com',
  role: 'guest',
  tokenHash: TOKEN_HASH,
  projectId: PROJECT_ID,
  expiresAt: new Date(Date.now() + 60_000),
  acceptedAt: null,
  revokedAt: null,
  team: {
    id: TEAM_ID,
    name: 'Client Delivery',
    workspace: {
      id: '44444444-4444-4444-8444-444444444444', name: 'Agency',
      brandName: 'Northstar Studio', logoUrl: null, accentColor: '#4f46e5',
      reviewerWelcome: 'Review the latest build with us.',
    },
  },
  project: { id: PROJECT_ID, name: 'Client Site' },
});

beforeEach(() => {
  vi.clearAllMocks();
  auth.requireDashboardOrigin.mockReturnValue(null);
  auth.requireAuth.mockResolvedValue(null);
  csrf.ensureCsrfCookie.mockResolvedValue('csrf-token');
  consumeMock.mockReturnValue({ ok: true });
  mocks.teamInvitation.findUnique.mockResolvedValue(activeInvitation());
  mocks.teamInvitation.updateMany.mockResolvedValue({ count: 1 });
  mocks.teamMember.findFirst.mockResolvedValue(null);
  mocks.teamMember.create.mockImplementation(async ({ data }) => ({ id: 'member-1', ...data }));
  mocks.user.findUnique.mockResolvedValue(null);
  mocks.user.create.mockImplementation(async ({ data }) => ({ id: 'user-new', ...data }));
  mocks.session.create.mockImplementation(async ({ data }) => ({ id: 'session-1', ...data }));
  mocks.$transaction.mockImplementation(async (callback) => callback(mocks));
});

describe('invitation inspection and acceptance', () => {
  it('inspects active invitation metadata without returning the token or hash', async () => {
    const response = await inspectInvitation(request('inspect', { token: TOKEN }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text();
    expect(text).toContain('guest@example.com');
    expect(text).toContain('Client Delivery');
    expect(text).toContain('Client Site');
    expect(text).toContain('Northstar Studio');
    expect(text).toContain('#4f46e5');
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(TOKEN_HASH);
  });

  it('uses the same generic response for expired and unknown invitations', async () => {
    mocks.teamInvitation.findUnique.mockResolvedValueOnce({
      ...activeInvitation(),
      expiresAt: new Date(Date.now() - 1),
    });
    const expired = await inspectInvitation(request('inspect', { token: TOKEN }));
    expect(expired.status).toBe(404);
    expect(await expired.json()).toEqual({ error: 'Invitation unavailable' });

    mocks.teamInvitation.findUnique.mockResolvedValueOnce(null);
    const unknown = await inspectInvitation(request('inspect', { token: TOKEN }));
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: 'Invitation unavailable' });
  });

  it('creates an invite-only account, claims guest scope atomically, and sets a secure session', async () => {
    const response = await acceptInvitation(request('accept', {
      token: TOKEN,
      password: 'Strong client password 2026',
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      accepted: true,
      redirectTo: `/projects/${PROJECT_ID}`,
      user: { id: 'user-new', email: 'guest@example.com' },
    });
    expect(JSON.stringify(body)).not.toContain(TOKEN);

    const userData = mocks.user.create.mock.calls[0][0].data;
    expect(userData.email).toBe('guest@example.com');
    expect(userData.role).toBe('reviewer');
    expect(userData.passwordHash).not.toContain('Strong client password 2026');
    expect(userData.passwordHash).toMatch(/^scrypt\$/);
    expect(mocks.teamMember.create).toHaveBeenCalledWith({
      data: {
        teamId: TEAM_ID,
        userId: 'user-new',
        email: 'guest@example.com',
        role: 'guest',
        projectId: PROJECT_ID,
      },
    });
    expect(mocks.teamInvitation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: INVITATION_ID,
        tokenHash: TOKEN_HASH,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      }),
      data: { acceptedAt: expect.any(Date) },
    }));
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('markup.session=');
    expect(cookie.toLowerCase()).toContain('httponly');
    expect(cookie.toLowerCase()).toContain('samesite=strict');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      actor: 'user-new',
      action: 'team_invitation.accept',
      target: INVITATION_ID,
      metadata: expect.not.objectContaining({ token: TOKEN, tokenHash: TOKEN_HASH }),
    }));
  });

  it('requires an existing account password and performs no claim on failure', async () => {
    mocks.user.findUnique.mockResolvedValue({
      id: 'user-existing',
      email: 'guest@example.com',
      role: 'reviewer',
      passwordHash: hashPassword('Correct existing pass 2026'),
    });
    const response = await acceptInvitation(request('accept', {
      token: TOKEN,
      password: 'Wrong existing pass 2026',
    }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unable to accept invitation' });
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a signed-in account whose email does not match the invitation', async () => {
    auth.requireAuth.mockResolvedValue({
      id: 'other-user', email: 'other@example.com', role: 'reviewer',
    });
    const response = await acceptInvitation(request('accept', { token: TOKEN }));
    expect(response.status).toBe(409);
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });
});
