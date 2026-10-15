// DELETE /api/pins/[id] must delete only that pin.
//
// It used to delete the pin's whole Screenshot first. Uploaded images, PDF
// pages and dashboard-pinned captures share one Screenshot across many
// pins, so removing one pin wiped the page image plus every sibling pin and
// comment (Pin CASCADEs from Screenshot), then 500'd when the follow-up
// pin.delete found nothing left.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const PIN_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const CSRF_TOKEN = 'pin-delete-csrf';

const mocks = vi.hoisted(() => ({
  pin: {
    findUnique: vi.fn(),
    deleteMany: vi.fn(),
    delete: vi.fn(),
  },
  screenshot: { findUnique: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
  project: { findUnique: vi.fn() },
  audit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks }));
vi.mock('@/lib/audit', () => ({ audit: mocks.audit }));

import { DELETE } from '../../src/app/api/pins/[id]/route';

function deleteReq(): Request {
  return new Request(`https://markup.ashbi.ca/api/pins/${PIN_ID}`, {
    method: 'DELETE',
    headers: {
      origin: 'https://markup.ashbi.ca',
      'X-CSRF-Token': CSRF_TOKEN,
      cookie: `markup.csrf=${CSRF_TOKEN}`,
    },
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
  mocks.pin.deleteMany.mockResolvedValue({ count: 1 });
});

describe('DELETE /api/pins/[id] scope', () => {
  it('deletes only the pin and leaves the shared screenshot alone', async () => {
    const res = await DELETE(deleteReq(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true, pin: 1 });

    expect(mocks.pin.deleteMany).toHaveBeenCalledWith({ where: { id: PIN_ID } });
    expect(mocks.screenshot.delete).not.toHaveBeenCalled();
    expect(mocks.screenshot.deleteMany).not.toHaveBeenCalled();
  });

  it('audits the delete against the calling user', async () => {
    await DELETE(deleteReq(), params);
    expect(mocks.audit).toHaveBeenCalledWith({
      actor: 'integration-test@example.com',
      action: 'pin.delete',
      target: PIN_ID,
      metadata: { projectId: PROJECT_ID },
    });
  });

  it('returns 404 when the pin disappears before the delete', async () => {
    mocks.pin.deleteMany.mockResolvedValue({ count: 0 });
    const res = await DELETE(deleteReq(), params);
    expect(res.status).toBe(404);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
