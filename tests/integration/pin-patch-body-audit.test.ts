// PATCH /api/pins/[id]: malformed JSON is a 400 (it was an uncaught 500),
// and a status-only change is audited like every other dashboard write
// (only the internal-metadata path used to call audit()).

import { describe, it, expect, beforeEach, vi } from 'vitest';

const PIN_ID = '77777777-7777-4777-8777-777777777777';
const PROJECT_ID = '88888888-8888-4888-8888-888888888888';
const CSRF = 'pin-patch-csrf';

const mocks = vi.hoisted(() => ({
  // The caller belongs to no team, so it may open the unscoped project.
  teamMember: { findFirst: vi.fn(async () => null) },
  pin: { findUnique: vi.fn(), update: vi.fn() },
  project: { findUnique: vi.fn() },
  audit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks }));
vi.mock('@/lib/audit', () => ({ audit: mocks.audit }));
vi.mock('@/lib/project-notification-delivery', () => ({
  sendProjectMemberNotification: vi.fn(async () => undefined),
}));

import { PATCH } from '../../src/app/api/pins/[id]/route';

function patchReq(body: string): Request {
  return new Request(`https://markup.ashbi.ca/api/pins/${PIN_ID}`, {
    method: 'PATCH',
    headers: {
      origin: 'https://markup.ashbi.ca',
      'Content-Type': 'application/json',
      'X-CSRF-Token': CSRF,
      cookie: `markup.csrf=${CSRF}`,
    },
    body,
  });
}
const params = { params: Promise.resolve({ id: PIN_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pin.findUnique.mockResolvedValue({
    status: 'OPEN',
    assigneeId: null,
    screenshot: { page: { projectId: PROJECT_ID } },
  });
  mocks.project.findUnique.mockResolvedValue({ id: PROJECT_ID, teamId: null });
  mocks.pin.update.mockResolvedValue({ id: PIN_ID, status: 'RESOLVED' });
});

describe('PATCH /api/pins/[id]', () => {
  it('returns 400 for a malformed JSON body without writing', async () => {
    const res = await PATCH(patchReq('{not json'), params);
    expect(res.status).toBe(400);
    expect(mocks.pin.update).not.toHaveBeenCalled();
  });

  it('audits a status-only change against the caller', async () => {
    const res = await PATCH(patchReq(JSON.stringify({ status: 'RESOLVED' })), params);
    expect(res.status).toBe(200);
    expect(mocks.audit).toHaveBeenCalledWith({
      actor: 'integration-test@example.com',
      action: 'pin.update',
      target: PIN_ID,
      metadata: { projectId: PROJECT_ID, fields: ['status'] },
    });
  });
});
