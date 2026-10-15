// GET /api/events must check project access, not just a session.
//
// The SSE stream carries comment text, author names and attachment URLs.
// With only requireDashboardAuth, any signed-in user could subscribe to any
// projectId and read another team's live feedback.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const PROJECT_ID = '33333333-3333-4333-8333-333333333333';

const mocks = vi.hoisted(() => ({
  assertProjectAccessible: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));

vi.mock('@/lib/teams', () => ({
  assertProjectAccessible: mocks.assertProjectAccessible,
}));
vi.mock('@/lib/events', () => ({ subscribe: mocks.subscribe }));

import { GET } from '../../src/app/api/events/route';

function eventsReq(projectId: string): Request {
  return new Request(`https://markup.ashbi.ca/api/events?projectId=${projectId}`, {
    headers: { origin: 'https://markup.ashbi.ca' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/events project access', () => {
  it('rejects a signed-in user who is not a member of the project team', async () => {
    mocks.assertProjectAccessible.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Not a member of this project's team",
    });
    const res = await GET(eventsReq(PROJECT_ID));
    expect(res.status).toBe(403);
    expect(mocks.assertProjectAccessible).toHaveBeenCalledWith(PROJECT_ID);
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown project without subscribing', async () => {
    mocks.assertProjectAccessible.mockResolvedValue({
      ok: false,
      status: 404,
      error: 'Project not found',
    });
    const res = await GET(eventsReq(PROJECT_ID));
    expect(res.status).toBe(404);
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it('opens the stream for a caller with project access', async () => {
    mocks.assertProjectAccessible.mockResolvedValue({ ok: true, projectId: PROJECT_ID });
    const res = await GET(eventsReq(PROJECT_ID));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    expect(mocks.subscribe).toHaveBeenCalledWith(PROJECT_ID, expect.any(Function));
    await res.body?.cancel();
  });
});
