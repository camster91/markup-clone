// Integration tests for @-mention handling in POST /api/pins/[id]/comments.
//
// Covers:
//   1. parseMentions() pure-function behavior (regex, case-insensitive,
//      dedup, +/. supported in local part).
//   2. The POST route extracts mentions, looks up Users case-insensitively,
//      sends a mention email per matched user, ignores unknown emails,
//      dedupes duplicates, and writes an audit log row.
//
// Mocking strategy mirrors comments-rate-limit.test.ts: hoist a single
// `mocks` object, vi.mock the prisma + email modules BEFORE the route
// import so the route reads from the mock.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _resetBucket } from '@/lib/rate-limit';

const mocks = vi.hoisted(() => ({
  comment: { create: vi.fn() },
  pin: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  user: { findMany: vi.fn() },
  project: {
    findUnique: vi.fn().mockResolvedValue({
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      teamId: null,
    }),
  },
  audit: vi.fn(),
  sendProjectMemberNotification: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    comment: mocks.comment,
    pin: mocks.pin,
    user: mocks.user,
    project: mocks.project,
  },
}));

vi.mock('@/lib/audit', () => ({
  audit: mocks.audit,
}));

vi.mock('@/lib/project-notification-delivery', () => ({
  sendProjectMemberNotification: mocks.sendProjectMemberNotification,
}));

// Import after the mocks so the route picks them up.
import { POST } from '../../src/app/api/pins/[id]/comments/route';
import { parseMentions } from '@/lib/mentions';

const PIN_A = '11111111-1111-1111-1111-111111111111';
const SCREENSHOT_A = '22222222-2222-2222-2222-222222222222';
const PROJECT_A = '33333333-3333-3333-3333-333333333333';
const ORIGIN = 'https://markup.ashbi.ca';
const KEY = `comments:origin:${ORIGIN}:${PIN_A}`;
const CSRF_TOKEN = 'test-csrf-token';

function makeReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://markup.ashbi.ca/api/pins/${PIN_A}/comments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      origin: ORIGIN,
      'X-CSRF-Token': CSRF_TOKEN,
      cookie: `markup.csrf=${CSRF_TOKEN}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const params = () => ({ params: Promise.resolve({ id: PIN_A }) });

// Standard happy-path DB mocks. Tests override per case.
function setupStandardMocks(opts: {
  commentRow?: any;
  pinStatus?: string;
  mentionedUsers?: { id?: string; email: string }[];
} = {}) {
  mocks.comment.create.mockResolvedValue(
    opts.commentRow ?? { id: 'c-1', text: 'hi', author: 'Reviewer', authorRole: 'reviewer', createdAt: new Date('2026-06-14T15:00:00.000Z') }
  );
  // The route does two pin.findUnique calls: first to fetch pinMeta
  // (projectId + screenshotId + project name), then again to read
  // status for the reopen-on-reply path. We use mockImplementation so
  // each call returns the right shape based on the `select` projection.
  mocks.pin.findUnique.mockImplementation((args: any) => {
    if (args?.select?.screenshot) {
      // The pinMeta lookup.
      return Promise.resolve({
        screenshot: {
          id: SCREENSHOT_A,
          page: { projectId: PROJECT_A, project: { name: 'Acme' } },
        },
      });
    }
    // The status lookup for the reopen-on-reply branch.
    return Promise.resolve({ status: opts.pinStatus ?? 'OPEN' });
  });
    mocks.project.findUnique.mockResolvedValue({
      id: PROJECT_A,
      teamId: null,
    });
  mocks.pin.update.mockResolvedValue({ id: PIN_A, status: 'OPEN' });
  mocks.user.findMany.mockResolvedValue((opts.mentionedUsers ?? []).map((user, index) => ({
    id: user.id ?? `mentioned-${index + 1}`,
    email: user.email,
  })));
  mocks.audit.mockClear();
  mocks.sendProjectMemberNotification.mockClear();
  mocks.sendProjectMemberNotification.mockResolvedValue(undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Provide a default fetch stub so the mention email path (which
  // makes a Mailgun call) doesn't blow up if a test forgets to mock
  // it. The route is fire-and-forget so this is just safety.
  mocks.fetch.mockResolvedValue({ ok: true, status: 200, text: async () => '' });
  global.fetch = mocks.fetch as any;
});

afterEach(() => {
  _resetBucket(KEY);
  vi.useRealTimers();
});

// ─── parseMentions (pure) ───────────────────────────────────────────────────

describe('parseMentions', () => {
  it('extracts a single @email from text', () => {
    expect(parseMentions('hi @alice@example.com thanks'))
      .toEqual(['alice@example.com']);
  });

  it('extracts multiple distinct mentions in order of appearance', () => {
    expect(parseMentions('@alice@example.com and @bob@example.com and @carol@example.com'))
      .toEqual(['alice@example.com', 'bob@example.com', 'carol@example.com']);
  });

  it('is case-insensitive (alice@EXAMPLE.com matches Alice@example.com)', () => {
    expect(parseMentions('@alice@EXAMPLE.com @Alice@example.com'))
      .toEqual(['alice@example.com']);
  });

  it('dedupes duplicate mentions (same email twice → one entry)', () => {
    expect(parseMentions('@a@b.co @a@b.co @a@b.co'))
      .toEqual(['a@b.co']);
  });

  it('handles dotted local parts (user.name@example.com)', () => {
    expect(parseMentions('ping @user.name@example.com'))
      .toEqual(['user.name@example.com']);
  });

  it('handles plus-tagged local parts (user+tag@example.com)', () => {
    expect(parseMentions('ping @user+tag@example.com'))
      .toEqual(['user+tag@example.com']);
  });

  it('handles underscores and hyphens in the local part', () => {
    expect(parseMentions('@a_b-c@x.co @a_b.c@x.co'))
      .toEqual(['a_b-c@x.co', 'a_b.c@x.co']);
  });

  it('returns an empty array when there are no @-mentions', () => {
    expect(parseMentions('nothing here')).toEqual([]);
  });

  it('returns an empty array for an empty string', () => {
    expect(parseMentions('')).toEqual([]);
  });

  it('does NOT match an @ with no email after it', () => {
    expect(parseMentions('hi @username how are you')).toEqual([]);
  });

  it('does NOT match emails without the leading @', () => {
    expect(parseMentions('contact alice@example.com please')).toEqual([]);
  });

  it('does NOT match addresses missing a TLD', () => {
    // "a@b" has no TLD — should NOT be a mention.
    expect(parseMentions('ping @a@b')).toEqual([]);
  });
});

// ─── POST /api/pins/[id]/comments — @-mention dispatch ─────────────────────

describe('POST /api/pins/[id]/comments — @-mention dispatch', () => {
  it('extracts the @email in the comment text and looks up matching users', async () => {
    setupStandardMocks({
      mentionedUsers: [{ email: 'alice@example.com' }],
    });

    const res = await POST(
      makeReq({ text: 'hi @alice@example.com', author: 'Reviewer', authorRole: 'reviewer' }),
      params()
    );
    expect(res.status).toBe(201);

    // The route should have queried the User table with the lowercased,
    // case-insensitive `in` filter for the parsed mention.
    expect(mocks.user.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.user.findMany).toHaveBeenCalledWith({
      where: { email: { in: ['alice@example.com'], mode: 'insensitive' } },
      select: { id: true, email: true },
    });
  });

  it('queues one preference-aware mention event for the matched project users', async () => {
    setupStandardMocks({
      mentionedUsers: [
        { email: 'alice@example.com' },
        { email: 'bob@example.com' },
      ],
    });

    const res = await POST(
      makeReq({ text: '@alice@example.com and @bob@example.com take a look' }),
      params()
    );
    expect(res.status).toBe(201);

    expect(mocks.sendProjectMemberNotification).toHaveBeenCalledWith({
      projectId: PROJECT_A,
      pinId: PIN_A,
      event: 'mention',
      title: 'You were mentioned',
      message: 'Reviewer mentioned you: @alice@example.com and @bob@example.com take a look',
      actorUserId: '00000000-0000-4000-8000-000000000001',
      targetUserIds: ['mentioned-1', 'mentioned-2'],
    });
  });

  it('silently ignores unrecognized emails (no User match → no email)', async () => {
    setupStandardMocks({ mentionedUsers: [] });

    const res = await POST(
      makeReq({ text: 'hi @stranger@nowhere.io' }),
      params()
    );
    expect(res.status).toBe(201);

    expect(mocks.user.findMany).toHaveBeenCalled();
    expect(mocks.sendProjectMemberNotification.mock.calls.filter(([arg]) => arg.event === 'mention')).toHaveLength(0);
    // No matched users ⇒ no audit row.
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('dedupes duplicate mentions of the same email (one email sent)', async () => {
    setupStandardMocks({
      mentionedUsers: [{ email: 'alice@example.com' }],
    });

    const res = await POST(
      makeReq({ text: '@alice@example.com @ALICE@example.com @Alice@Example.com hi' }),
      params()
    );
    expect(res.status).toBe(201);

    // The User lookup is given the deduplicated list (just "alice@example.com").
    expect(mocks.user.findMany).toHaveBeenCalledWith({
      where: { email: { in: ['alice@example.com'], mode: 'insensitive' } },
      select: { id: true, email: true },
    });
    const mentionCalls = mocks.sendProjectMemberNotification.mock.calls.filter(([arg]) => arg.event === 'mention');
    expect(mentionCalls).toHaveLength(1);
    expect(mentionCalls[0][0].targetUserIds).toEqual(['mentioned-1']);
  });

  it('writes a comment.mention audit log row with the list of notified emails', async () => {
    setupStandardMocks({
      mentionedUsers: [
        { email: 'alice@example.com' },
        { email: 'bob@example.com' },
      ],
    });

    const res = await POST(
      makeReq({ text: '@alice@example.com and @bob@example.com', author: 'Reviewer' }),
      params()
    );
    expect(res.status).toBe(201);

    expect(mocks.audit).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledWith({
      actor: 'Reviewer',
      action: 'comment.mention',
      target: 'c-1',
      metadata: {
        pinId: PIN_A,
        emails: expect.arrayContaining(['alice@example.com', 'bob@example.com']),
      },
    });
  });

  it('does not block the response on the email dispatch (fire-and-forget)', async () => {
    // Make the project notification slow; the POST must still return
    // 201 quickly because the dispatch is `void`-prefixed (not awaited).
    setupStandardMocks({ mentionedUsers: [{ email: 'alice@example.com' }] });
    mocks.sendProjectMemberNotification.mockImplementation(async () => {
      // 200ms of "network". If the route awaited this, the test would
      // take ~200ms. We just assert the call happened, not its timing.
      await new Promise(r => setTimeout(r, 50));
    });

    const t0 = Date.now();
    const res = await POST(
      makeReq({ text: '@alice@example.com' }),
      params()
    );
    const elapsed = Date.now() - t0;
    expect(res.status).toBe(201);
    // Loose upper bound: if the route awaited the 50ms timer, this
    // would be ≥ 50ms. The fire-and-forget path returns in a few ms.
    // We give 40ms to absorb slow CI scheduling — still below the
    // 50ms the awaited path would take.
    expect(elapsed).toBeLessThan(40);
    // The mock was called even though the response didn't wait.
    expect(mocks.sendProjectMemberNotification).toHaveBeenCalledTimes(2);
  });

  it('queues a reply event but no mention event when the comment has no mentions', async () => {
    setupStandardMocks();
    const res = await POST(makeReq({ text: 'plain old comment' }), params());
    expect(res.status).toBe(201);
    expect(mocks.user.findMany).not.toHaveBeenCalled();
    expect(mocks.sendProjectMemberNotification).toHaveBeenCalledTimes(1);
    expect(mocks.sendProjectMemberNotification).toHaveBeenCalledWith({
      projectId: PROJECT_A,
      pinId: PIN_A,
      event: 'new-comment',
      title: 'New thread reply',
      message: 'Reviewer replied: plain old comment',
      actorUserId: '00000000-0000-4000-8000-000000000001',
    });
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('queues the implicit reopen as a status change when replying to resolved feedback', async () => {
    setupStandardMocks({ pinStatus: 'RESOLVED' });
    const res = await POST(makeReq({ text: 'This still needs work', author: 'Reviewer' }), params());
    expect(res.status).toBe(201);
    expect(mocks.pin.update).toHaveBeenCalledWith({ where: { id: PIN_A }, data: { status: 'OPEN' } });
    expect(mocks.sendProjectMemberNotification).toHaveBeenCalledWith({
      projectId: PROJECT_A,
      pinId: PIN_A,
      event: 'status-change',
      title: 'Feedback reopened',
      message: 'Reviewer reopened feedback by replying.',
      actorUserId: '00000000-0000-4000-8000-000000000001',
    });
  });

  it('still returns 201 when the User lookup itself throws (defense in depth)', async () => {
    setupStandardMocks();
    // Force a DB error in the user lookup; the route must not let the
    // whole POST 500 — the comment is already written.
    mocks.user.findMany.mockRejectedValue(new Error('db down'));

    const res = await POST(
      makeReq({ text: '@alice@example.com' }),
      params()
    );
    expect(res.status).toBe(201);
    // The comment is still in the response, even though mention dispatch
    // failed.
    const body = await res.json();
    expect(body.data.id).toBe('c-1');
    expect(mocks.sendProjectMemberNotification.mock.calls.filter(([arg]) => arg.event === 'mention')).toHaveLength(0);
  });

  it('handles case where mention is case-mismatched against a stored User', async () => {
    // alice@EXAMPLE.com in the comment; User row is stored as
    // Alice@example.com. The route's `mode: 'insensitive'` query
    // matches the User; the email is sent to whatever case the DB
    // returned (case-insensitive ⇒ the original User.email is the
    // authoritative form, which is what the test mocks).
    setupStandardMocks({
      mentionedUsers: [{ email: 'Alice@example.com' }],
    });
    const res = await POST(
      makeReq({ text: 'ping @alice@EXAMPLE.com' }),
      params()
    );
    expect(res.status).toBe(201);
    const mentionCall = mocks.sendProjectMemberNotification.mock.calls.find(([arg]) => arg.event === 'mention');
    expect(mentionCall?.[0].targetUserIds).toEqual(['mentioned-1']);
  });
});
