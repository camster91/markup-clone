// POST /api/pins/[id]/comments — author identity and body hygiene.
//
// - authorRole is derived from the caller's session, never the body: a
//   guest who sends authorRole: 'operator' is stored as 'reviewer'; only a
//   global operator gets 'operator'.
// - author (display name) is the free-text "Your name" field; when it is
//   missing it falls back to the caller's email rather than 'Reviewer'.
// - The stored / broadcast text is the trimmed value from
//   validatePinText, not the raw body string.
// - Malformed JSON is a 400, not a 500.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PIN_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const ORIGIN = 'https://markup.ashbi.ca';
const CSRF_TOKEN = 'comment-author-role-csrf';

const mocks = vi.hoisted(() => ({
  comment: { create: vi.fn(), findUniqueOrThrow: vi.fn() },
  pin: { findUnique: vi.fn(), update: vi.fn() },
  user: { findMany: vi.fn() },
  attachment: { findMany: vi.fn(), updateMany: vi.fn() },
  assertProjectAccessible: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const prisma = { comment: mocks.comment, pin: mocks.pin, user: mocks.user, attachment: mocks.attachment };
  // Attachment claims run in an interactive transaction against the same mocks.
  return { prisma: { ...prisma, $transaction: (fn: (tx: typeof prisma) => unknown) => fn(prisma) } };
});
vi.mock('@/lib/teams', () => ({ assertProjectAccessible: mocks.assertProjectAccessible }));
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }));
vi.mock('@/lib/events', () => ({ emit: mocks.emit }));
vi.mock('@/lib/project-notification-delivery', () => ({ sendProjectMemberNotification: vi.fn() }));

import { POST } from '@/app/api/pins/[id]/comments/route';
import { _resetBucket } from '@/lib/rate-limit';

function makeReq(body: string): Request {
  return new Request(`https://markup.ashbi.ca/api/pins/${PIN_ID}/comments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      origin: ORIGIN,
      'X-CSRF-Token': CSRF_TOKEN,
      cookie: `markup.csrf=${CSRF_TOKEN}`,
    },
    body,
  });
}

const params = () => ({ params: Promise.resolve({ id: PIN_ID }) });

function grantAccess(role: string, membershipRole: string) {
  mocks.assertProjectAccessible.mockResolvedValue({
    ok: true,
    projectId: PROJECT_ID,
    teamId: 'team-1',
    caller: { id: 'user-1', email: `${membershipRole}@example.com`, role },
    membershipRole,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pin.findUnique.mockImplementation(async (args: { select?: { screenshot?: unknown } }) => (
    args?.select?.screenshot
      ? { screenshot: { page: { projectId: PROJECT_ID } } }
      : { status: 'OPEN' }
  ));
  mocks.comment.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'comment-1',
    text: data.text,
    author: data.author,
    authorRole: data.authorRole,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    attachments: [],
  }));
  mocks.comment.findUniqueOrThrow.mockImplementation(async () => mocks.comment.create.mock.results[0].value);
  mocks.attachment.updateMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => ({
    count: where.id.in.length,
  }));
  mocks.user.findMany.mockResolvedValue([]);
  grantAccess('reviewer', 'guest');
});

afterEach(() => {
  _resetBucket(`comments:origin:${ORIGIN}:${PIN_ID}`);
});

describe('POST /api/pins/[id]/comments — author role', () => {
  it('ignores a client-supplied authorRole: a guest claiming "operator" is stored as reviewer', async () => {
    const res = await POST(makeReq(JSON.stringify({ text: 'hello', author: 'Guest', authorRole: 'operator' })), params());
    expect(res.status).toBe(201);
    expect(mocks.comment.create.mock.calls[0][0].data.authorRole).toBe('reviewer');
  });

  it('a global operator is stored as operator even when the client sends reviewer', async () => {
    grantAccess('operator', 'operator');
    const res = await POST(makeReq(JSON.stringify({ text: 'hello', author: 'Ops', authorRole: 'reviewer' })), params());
    expect(res.status).toBe(201);
    expect(mocks.comment.create.mock.calls[0][0].data.authorRole).toBe('operator');
  });

  it('keeps the sanitized display name and falls back to the caller email when absent', async () => {
    await POST(makeReq(JSON.stringify({ text: 'hello', author: 'Pat' })), params());
    expect(mocks.comment.create.mock.calls[0][0].data.author).toBe('Pat');

    _resetBucket(`comments:origin:${ORIGIN}:${PIN_ID}`);
    await POST(makeReq(JSON.stringify({ text: 'hello' })), params());
    expect(mocks.comment.create.mock.calls[1][0].data.author).toBe('guest@example.com');
  });
});

describe('POST /api/pins/[id]/comments — body hygiene', () => {
  it('stores and broadcasts the trimmed text, not the raw body string', async () => {
    const res = await POST(makeReq(JSON.stringify({ text: '   needs work  \n' })), params());
    expect(res.status).toBe(201);
    expect(mocks.comment.create.mock.calls[0][0].data.text).toBe('needs work');
    const event = mocks.emit.mock.calls[0][0];
    expect(event.payload.comment.text).toBe('needs work');
  });

  it('stores an empty string for a whitespace-only caption on an attachment-only reply', async () => {
    const attachmentId = '44444444-4444-4444-8444-444444444444';
    mocks.attachment.findMany.mockResolvedValue([{ id: attachmentId }]);
    const res = await POST(makeReq(JSON.stringify({ text: '   ', attachmentIds: [attachmentId] })), params());
    expect(res.status).toBe(201);
    expect(mocks.comment.create.mock.calls[0][0].data.text).toBe('');
  });

  it('returns 400 (not 500) for a malformed JSON body', async () => {
    const res = await POST(makeReq('{"text": '), params());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid JSON body' });
    expect(mocks.comment.create).not.toHaveBeenCalled();
  });
});
