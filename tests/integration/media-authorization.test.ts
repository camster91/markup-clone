import { beforeEach, describe, expect, it, vi } from 'vitest';

const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCREENSHOT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ATTACHMENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const mocks = vi.hoisted(() => ({
  screenshot: { findUnique: vi.fn() },
  screenshotVersion: { findMany: vi.fn(), findUnique: vi.fn() },
  attachment: { findUnique: vi.fn() },
  readFile: vi.fn(),
  stat: vi.fn(),
}));

const access = vi.hoisted(() => ({
  assertProjectAccessible: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks }));
vi.mock('@/lib/teams', () => access);
vi.mock('fs/promises', () => ({ readFile: mocks.readFile, stat: mocks.stat }));

import { GET as getScreenshotImage } from '@/app/api/screenshots/[id]/image/route';
import { GET as getScreenshotHistory } from '@/app/api/screenshots/[id]/history/route';
import { GET as getAttachment } from '@/app/api/attachments/[id]/route';
import { createShareAccessValue, shareAccessCookieName } from '@/lib/share-access';

const SHARE_TOKEN = 'valid-share-token';
const SHARE_COOKIE = `${shareAccessCookieName(SHARE_TOKEN)}=${createShareAccessValue(SHARE_TOKEN, null)}`;

beforeEach(() => {
  vi.clearAllMocks();
  access.assertProjectAccessible.mockResolvedValue({
    ok: false,
    status: 403,
    error: 'Not a member of this project team',
  });
  mocks.readFile.mockResolvedValue(Buffer.from('image'));
  mocks.stat.mockResolvedValue({ size: 5 });
  mocks.screenshot.findUnique.mockResolvedValue({
    id: SCREENSHOT_ID,
    storageKey: `${SCREENSHOT_ID}.png`,
    capturedAt: new Date('2026-08-07T12:00:00.000Z'),
    page: { project: {
      id: PROJECT_ID,
      shareToken: SHARE_TOKEN,
      shareExpiresAt: null,
      sharePasswordHash: null,
    } },
  });
  mocks.screenshotVersion.findMany.mockResolvedValue([]);
  mocks.attachment.findUnique.mockResolvedValue({
    id: ATTACHMENT_ID,
    projectId: PROJECT_ID,
    storageKey: `${ATTACHMENT_ID}.png`,
    mimeType: 'image/png',
    size: 5,
    comment: {
      pin: {
        screenshot: {
          page: { project: {
            id: PROJECT_ID,
            shareToken: SHARE_TOKEN,
            shareExpiresAt: null,
            sharePasswordHash: null,
          } },
        },
      },
    },
  });
});

describe('authenticated media authorization', () => {
  it('does not serve a screenshot image based on dashboard origin alone', async () => {
    const response = await getScreenshotImage(
      new Request(`https://markup.ashbi.ca/api/screenshots/${SCREENSHOT_ID}/image`, {
        headers: { origin: 'https://markup.ashbi.ca' },
      }),
      { params: Promise.resolve({ id: SCREENSHOT_ID }) }
    );

    expect(response.status).toBe(404);
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it('does not expose screenshot history based on dashboard origin alone', async () => {
    const response = await getScreenshotHistory(
      new Request(`https://markup.ashbi.ca/api/screenshots/${SCREENSHOT_ID}/history`, {
        headers: { origin: 'https://markup.ashbi.ca' },
      }),
      { params: Promise.resolve({ id: SCREENSHOT_ID }) }
    );

    expect(response.status).toBe(404);
    expect(mocks.screenshotVersion.findMany).not.toHaveBeenCalled();
  });

  it('does not serve an attachment based on dashboard origin alone', async () => {
    const response = await getAttachment(
      new Request(`https://markup.ashbi.ca/api/attachments/${ATTACHMENT_ID}`, {
        headers: { origin: 'https://markup.ashbi.ca' },
      }),
      { params: Promise.resolve({ id: ATTACHMENT_ID }) }
    );

    expect(response.status).toBe(404);
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it.each([
    ['screenshot', async (headers: HeadersInit, query = '') => getScreenshotImage(
      new Request(`https://markup.ashbi.ca/api/screenshots/${SCREENSHOT_ID}/image${query}`, { headers }),
      { params: Promise.resolve({ id: SCREENSHOT_ID }) }
    )],
    ['history', async (headers: HeadersInit, query = '') => getScreenshotHistory(
      new Request(`https://markup.ashbi.ca/api/screenshots/${SCREENSHOT_ID}/history${query}`, { headers }),
      { params: Promise.resolve({ id: SCREENSHOT_ID }) }
    )],
    ['attachment', async (headers: HeadersInit, query = '') => getAttachment(
      new Request(`https://markup.ashbi.ca/api/attachments/${ATTACHMENT_ID}${query}`, { headers }),
      { params: Promise.resolve({ id: ATTACHMENT_ID }) }
    )],
  ])('requires the token-bound cookie for public %s access', async (_name, requestMedia) => {
    const legacyQueryOnly = await requestMedia({}, `?share=${SHARE_TOKEN}`);
    expect(legacyQueryOnly.status).toBe(404);

    const cookieAccess = await requestMedia({ cookie: SHARE_COOKIE });
    expect(cookieAccess.status).toBe(200);
    expect(cookieAccess.headers.get('cache-control')).toMatch(/^private(?:,|$)/);
  });

  it('invalidates the media cookie when the link expires or becomes protected', async () => {
    mocks.screenshot.findUnique.mockResolvedValue({
      id: SCREENSHOT_ID,
      storageKey: `${SCREENSHOT_ID}.png`,
      capturedAt: new Date('2026-08-07T12:00:00.000Z'),
      page: { project: {
        id: PROJECT_ID,
        shareToken: SHARE_TOKEN,
        shareExpiresAt: new Date('2020-01-01T00:00:00.000Z'),
        sharePasswordHash: null,
      } },
    });
    const expired = await getScreenshotImage(
      new Request(`https://markup.ashbi.ca/api/screenshots/${SCREENSHOT_ID}/image`, {
        headers: { cookie: SHARE_COOKIE },
      }),
      { params: Promise.resolve({ id: SCREENSHOT_ID }) }
    );
    expect(expired.status).toBe(404);

    mocks.screenshot.findUnique.mockResolvedValue({
      id: SCREENSHOT_ID,
      storageKey: `${SCREENSHOT_ID}.png`,
      capturedAt: new Date('2026-08-07T12:00:00.000Z'),
      page: { project: {
        id: PROJECT_ID,
        shareToken: SHARE_TOKEN,
        shareExpiresAt: null,
        sharePasswordHash: 'scrypt$new-password',
      } },
    });
    const passwordRotated = await getScreenshotImage(
      new Request(`https://markup.ashbi.ca/api/screenshots/${SCREENSHOT_ID}/image`, {
        headers: { cookie: SHARE_COOKIE },
      }),
      { params: Promise.resolve({ id: SCREENSHOT_ID }) }
    );
    expect(passwordRotated.status).toBe(404);
  });
});
