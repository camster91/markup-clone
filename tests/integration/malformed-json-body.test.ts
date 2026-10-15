// Malformed JSON bodies must be a 400, never a 500.
//
// Every dashboard write handler below used to call `await req.json()`
// inside its generic try/catch, so a truncated or non-JSON body surfaced
// as "Failed to …" with status 500. Each handler now parses the body in
// its own try/catch and answers 400 before any DB write. A valid-JSON
// body that is not an object (`null`, an array, a number) is also a 400
// because every handler destructures fields from it.
//
// Access helpers are stubbed to "allowed" so the request reaches the
// body parse; the prisma stub records writes so the test can prove none
// happened.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '33333333-3333-4333-8333-333333333333';
const MEMBER_ID = '44444444-4444-4444-8444-444444444444';
const ROUND_ID = '55555555-5555-4555-8555-555555555555';
const PIN_ID = '66666666-6666-4666-8666-666666666666';
const CSRF_TOKEN = 'malformed-json-csrf';

const writes = vi.hoisted(() => ({ calls: [] as string[] }));

const prismaStub = vi.hoisted(() => {
  const WRITE_METHODS = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);
  const reads: Record<string, Record<string, unknown>> = {
    reviewRound: { findFirst: { id: '55555555-5555-4555-8555-555555555555', status: 'ACTIVE' } },
    project: { findUnique: { activeReviewRoundId: '55555555-5555-4555-8555-555555555555', teamId: null } },
    pin: {
      findUnique: { status: 'OPEN', screenshot: { page: { projectId: '11111111-1111-4111-8111-111111111111' } } },
    },
  };
  return new Proxy({}, {
    get(_target, model: string) {
      return new Proxy({}, {
        get(_t, method: string) {
          return async () => {
            if (WRITE_METHODS.has(method)) {
              writes.calls.push(`${model}.${method}`);
              return {};
            }
            return reads[model]?.[method] ?? null;
          };
        },
      });
    },
  });
});

vi.mock('@/lib/prisma', () => ({ prisma: prismaStub }));
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }));
vi.mock('@/lib/events', () => ({ emit: vi.fn() }));
vi.mock('@/lib/project-notification-delivery', () => ({ sendProjectMemberNotification: vi.fn() }));

vi.mock('@/lib/teams', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/teams')>();
  const caller = { id: 'op-1', email: 'op@example.com', role: 'operator' };
  const projectOk = {
    ok: true as const,
    projectId: '11111111-1111-4111-8111-111111111111',
    teamId: null,
    caller,
    membershipRole: 'operator' as const,
  };
  return {
    ...actual,
    assertOperator: vi.fn(async () => ({ ok: true as const, caller })),
    assertProjectAccessible: vi.fn(async () => projectOk),
    assertProjectAdmin: vi.fn(async () => projectOk),
    assertProjectCreateAdmin: vi.fn(async (teamId: string | null) => ({
      ok: true as const, teamId, caller, membershipRole: 'operator' as const,
    })),
    assertTeamRole: vi.fn(async (workspaceId: string, teamId: string) => ({
      ok: true as const,
      teamId,
      workspaceId,
      caller,
      membershipRole: 'owner' as const,
      membershipProjectId: null,
    })),
  };
});

import { POST as createProject } from '@/app/api/projects/route';
import { PATCH as patchProject } from '@/app/api/projects/[id]/route';
import { POST as addSubscriber } from '@/app/api/projects/[id]/subscribers/route';
import { POST as createIntegration } from '@/app/api/projects/[id]/integrations/route';
import { POST as testIntegration } from '@/app/api/projects/[id]/integrations/test/route';
import { PATCH as patchNotificationPreferences } from '@/app/api/projects/[id]/notification-preferences/route';
import { POST as createReviewRound } from '@/app/api/projects/[id]/review-rounds/route';
import { PATCH as patchReviewRound } from '@/app/api/projects/[id]/review-rounds/[roundId]/route';
import { POST as signOff } from '@/app/api/projects/[id]/review-rounds/[roundId]/sign-offs/route';
import { POST as createWorkspace } from '@/app/api/workspaces/route';
import { PATCH as patchWorkspace } from '@/app/api/workspaces/[id]/route';
import { POST as createTeam } from '@/app/api/workspaces/[id]/teams/route';
import { PATCH as patchTeam } from '@/app/api/workspaces/[id]/teams/[teamId]/route';
import { PATCH as patchMember } from '@/app/api/workspaces/[id]/teams/[teamId]/members/[memberId]/route';
import { POST as createComment } from '@/app/api/pins/[id]/comments/route';

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

const cases: Array<{ name: string; method: string; handler: Handler; params: Record<string, string> }> = [
  { name: 'POST /api/projects', method: 'POST', handler: createProject as unknown as Handler, params: {} },
  { name: 'PATCH /api/projects/[id]', method: 'PATCH', handler: patchProject as unknown as Handler, params: { id: PROJECT_ID } },
  { name: 'POST /api/projects/[id]/subscribers', method: 'POST', handler: addSubscriber as unknown as Handler, params: { id: PROJECT_ID } },
  { name: 'POST /api/projects/[id]/integrations', method: 'POST', handler: createIntegration as unknown as Handler, params: { id: PROJECT_ID } },
  { name: 'POST /api/projects/[id]/integrations/test', method: 'POST', handler: testIntegration as unknown as Handler, params: { id: PROJECT_ID } },
  { name: 'PATCH /api/projects/[id]/notification-preferences', method: 'PATCH', handler: patchNotificationPreferences as unknown as Handler, params: { id: PROJECT_ID } },
  { name: 'POST /api/projects/[id]/review-rounds', method: 'POST', handler: createReviewRound as unknown as Handler, params: { id: PROJECT_ID } },
  { name: 'PATCH /api/projects/[id]/review-rounds/[roundId]', method: 'PATCH', handler: patchReviewRound as unknown as Handler, params: { id: PROJECT_ID, roundId: ROUND_ID } },
  { name: 'POST /api/projects/[id]/review-rounds/[roundId]/sign-offs', method: 'POST', handler: signOff as unknown as Handler, params: { id: PROJECT_ID, roundId: ROUND_ID } },
  { name: 'POST /api/workspaces', method: 'POST', handler: createWorkspace as unknown as Handler, params: {} },
  { name: 'PATCH /api/workspaces/[id]', method: 'PATCH', handler: patchWorkspace as unknown as Handler, params: { id: WORKSPACE_ID } },
  { name: 'POST /api/workspaces/[id]/teams', method: 'POST', handler: createTeam as unknown as Handler, params: { id: WORKSPACE_ID } },
  { name: 'PATCH /api/workspaces/[id]/teams/[teamId]', method: 'PATCH', handler: patchTeam as unknown as Handler, params: { id: WORKSPACE_ID, teamId: TEAM_ID } },
  { name: 'PATCH /api/workspaces/[id]/teams/[teamId]/members/[memberId]', method: 'PATCH', handler: patchMember as unknown as Handler, params: { id: WORKSPACE_ID, teamId: TEAM_ID, memberId: MEMBER_ID } },
  { name: 'POST /api/pins/[id]/comments', method: 'POST', handler: createComment as unknown as Handler, params: { id: PIN_ID } },
];

function request(method: string, body: string): Request {
  return new Request('https://markup.ashbi.ca/api/test', {
    method,
    headers: {
      origin: 'https://markup.ashbi.ca',
      'Content-Type': 'application/json',
      'X-CSRF-Token': CSRF_TOKEN,
      cookie: `markup.csrf=${CSRF_TOKEN}`,
    },
    body,
  });
}

beforeEach(() => {
  writes.calls = [];
});

describe('dashboard write handlers reject malformed JSON with 400', () => {
  it.each(cases)('$name: truncated JSON → 400 invalid JSON body, no DB write', async ({ method, handler, params }) => {
    const res = await handler(request(method, '{"name": '), { params: Promise.resolve(params) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid JSON body');
    expect(writes.calls).toEqual([]);
  });

  it.each(cases)('$name: JSON null → 400, no DB write', async ({ method, handler, params }) => {
    const res = await handler(request(method, 'null'), { params: Promise.resolve(params) });
    expect(res.status).toBe(400);
    expect(writes.calls).toEqual([]);
  });

  it.each(cases)('$name: JSON array → 400, no DB write', async ({ method, handler, params }) => {
    const res = await handler(request(method, '[]'), { params: Promise.resolve(params) });
    expect(res.status).toBe(400);
    expect(writes.calls).toEqual([]);
  });
});
