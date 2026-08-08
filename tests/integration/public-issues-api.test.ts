import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const PROJECT_ID = '30000000-0000-4000-8000-000000000001';
const PIN_ID = '60000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000003';
const TAG_ID = '70000000-0000-4000-8000-000000000001';
const ROUND_ID = '80000000-0000-4000-8000-000000000001';

const state = vi.hoisted(() => ({ authOk: true }));
const mocks = vi.hoisted(() => ({ pin: { findMany: vi.fn(), findFirst: vi.fn() } }));
vi.mock('@/lib/prisma', () => ({ prisma: mocks }));
vi.mock('@/lib/developer-api-auth', () => ({
  authenticateDeveloperApi: vi.fn(async () => state.authOk
    ? { ok: true, tokenId: 'token-1', projectId: PROJECT_ID, scope: 'issues:read' }
    : { ok: false, status: 401, code: 'AUTH_INVALID', error: 'Invalid developer API token' }),
}));

import { GET } from '@/app/api/v1/projects/[id]/issues/route';

function request(query = '') {
  return new NextRequest(`https://markup.example/api/v1/projects/${PROJECT_ID}/issues${query}`, {
    headers: { Authorization: `Bearer mkv1_${'A'.repeat(43)}` },
  });
}

function row(id = PIN_ID) {
  return {
    id, xPercent: 25, yPercent: 40, status: 'OPEN', priority: 'HIGH',
    assigneeId: USER_ID, reviewRoundId: ROUND_ID, createdAt: new Date('2026-08-08T01:00:00.000Z'),
    pageUrl: 'https://acme.example/pricing?private=1', viewportWidth: 1280, viewportHeight: 720,
    devicePixelRatio: 2, userAgent: 'Mozilla/5.0 Chrome/140.0.0.0', platform: 'Windows',
    selectorCandidatesJson: '["#pricing-cta"]', elementXPath: '#pricing-cta',
    elementHTML: '<button id="pricing-cta">Buy</button>',
    assignee: { id: USER_ID, email: 'developer@example.test' },
    tags: [{ tag: { id: TAG_ID, name: 'Bug', key: 'bug' } }],
    reviewRound: { id: ROUND_ID, number: 2, name: 'Final QA' },
    comments: [{
      id: 'comment-1', author: 'Client', authorRole: 'client', text: 'CTA is misaligned',
      createdAt: new Date('2026-08-08T01:01:00.000Z'),
      attachments: [{ kind: 'image', mimeType: 'image/png', size: 1200 }],
    }],
    screenshot: {
      id: '90000000-0000-4000-8000-000000000001', width: 1280, height: 720,
      capturedAt: new Date('2026-08-08T00:59:00.000Z'),
      page: { path: '/pricing', project: { id: PROJECT_ID, name: 'Acme Site', domain: 'acme.example' } },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.authOk = true;
  mocks.pin.findMany.mockResolvedValue([row()]);
  mocks.pin.findFirst.mockResolvedValue({ id: PIN_ID });
});

describe('GET /api/v1/projects/[id]/issues', () => {
  it('returns a versioned deterministic issue envelope with no-store security headers', async () => {
    const response = await GET(request(), { params: Promise.resolve({ id: PROJECT_ID }) });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(body).toMatchObject({
      apiVersion: 'v1',
      data: [{ schema: 'visual-feedback.issue.v1', pin: { id: PIN_ID }, title: 'CTA is misaligned' }],
      pagination: { limit: 50, nextCursor: null },
    });
    expect(body.data[0].page.url).toBe('https://acme.example/pricing');
    expect(body.data[0].reviewUrl).toBe(`https://markup.ashbi.ca/projects/${PROJECT_ID}?pin=${PIN_ID}`);
  });

  it('applies bounded filters and a project-owned cursor', async () => {
    const query = `?limit=25&status=OPEN&priority=HIGH&assigneeId=${USER_ID}&tagId=${TAG_ID}&reviewRoundId=${ROUND_ID}&cursor=${PIN_ID}`;
    const response = await GET(request(query), { params: Promise.resolve({ id: PROJECT_ID }) });
    expect(response.status).toBe(200);
    expect(mocks.pin.findFirst).toHaveBeenCalledWith({
      where: { id: PIN_ID, screenshot: { page: { projectId: PROJECT_ID } } }, select: { id: true },
    });
    expect(mocks.pin.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: 'OPEN', priority: 'HIGH', assigneeId: USER_ID, reviewRoundId: ROUND_ID,
        tags: { some: { tagId: TAG_ID } }, screenshot: { page: { projectId: PROJECT_ID } },
      }),
      cursor: { id: PIN_ID }, skip: 1, take: 26,
    }));
  });

  it('rejects invalid filters before querying issues', async () => {
    const response = await GET(request('?limit=500&status=DELETED'), { params: Promise.resolve({ id: PROJECT_ID }) });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('INVALID_QUERY');
    expect(mocks.pin.findMany).not.toHaveBeenCalled();
  });

  it('returns uniform structured authentication errors', async () => {
    state.authOk = false;
    const response = await GET(request(), { params: Promise.resolve({ id: PROJECT_ID }) });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: 'AUTH_INVALID', message: 'Invalid developer API token' },
    });
    expect(mocks.pin.findMany).not.toHaveBeenCalled();
  });

  it('uses one extra row to produce a stable next cursor', async () => {
    mocks.pin.findMany.mockResolvedValue(Array.from({ length: 3 }, (_, index) => row(
      `60000000-0000-4000-8000-00000000000${index + 1}`,
    )));
    const response = await GET(request('?limit=2'), { params: Promise.resolve({ id: PROJECT_ID }) });
    const body = await response.json();
    expect(body.data).toHaveLength(2);
    expect(body.pagination.nextCursor).toBe('60000000-0000-4000-8000-000000000002');
  });
});
