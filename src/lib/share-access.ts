import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const MAX_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;
const ACCESS_TTL_SECONDS = 7 * 24 * 60 * 60;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export type ShareOptionsResult =
  | { ok: true; expiresAt: Date | null; password: string | null }
  | { ok: false; error: string };

/** Parse administrator-supplied managed-link settings at the API boundary. */
export function parseShareOptions(input: unknown, now = new Date()): ShareOptionsResult {
  if (input === undefined) {
    return { ok: true, expiresAt: null, password: null };
  }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'request body must be an object' };
  }

  const body = input as Record<string, unknown>;
  let expiresAt: Date | null = null;
  if (body.expiresAt !== undefined && body.expiresAt !== null && body.expiresAt !== '') {
    if (typeof body.expiresAt !== 'string') {
      return { ok: false, error: 'expiry must be a valid ISO date' };
    }
    expiresAt = new Date(body.expiresAt);
    if (!Number.isFinite(expiresAt.getTime()) || !/^\d{4}-\d{2}-\d{2}T/.test(body.expiresAt)) {
      return { ok: false, error: 'expiry must be a valid ISO date' };
    }
    const delta = expiresAt.getTime() - now.getTime();
    if (delta <= 0) return { ok: false, error: 'expiry must be in the future' };
    if (delta > MAX_EXPIRY_MS) {
      return { ok: false, error: 'expiry cannot be more than 365 days away' };
    }
  }

  let password: string | null = null;
  if (body.password !== undefined && body.password !== null && body.password !== '') {
    if (typeof body.password !== 'string') {
      return { ok: false, error: 'password must be a string' };
    }
    if (body.password.length < 8 || body.password.length > 128) {
      return { ok: false, error: 'password must be 8 to 128 characters' };
    }
    if (CONTROL_CHARACTERS.test(body.password)) {
      return { ok: false, error: 'password cannot contain control characters' };
    }
    password = body.password;
  }

  return { ok: true, expiresAt, password };
}

/** Cookie names reveal only a short one-way fingerprint, never the bearer token. */
export function shareAccessCookieName(shareToken: string): string {
  const fingerprint = createHash('sha256').update(shareToken).digest('hex').slice(0, 24);
  return `markup.share.${fingerprint}`;
}

/**
 * Bind the cookie to the exact token and password configuration. Rotating either
 * changes the expected value and invalidates every previously issued cookie.
 */
export function createShareAccessValue(
  shareToken: string,
  sharePasswordHash: string | null | undefined
): string {
  const key = sharePasswordHash
    ? `visual-feedback:protected:${sharePasswordHash}`
    : `visual-feedback:public:${shareToken}`;
  return createHmac('sha256', key)
    .update(`share-access-v1:${shareToken}`)
    .digest('base64url');
}

export function isShareAccessCookieValid(
  shareToken: string,
  sharePasswordHash: string | null | undefined,
  supplied: string | null | undefined
): boolean {
  if (!supplied) return false;
  const expected = Buffer.from(createShareAccessValue(shareToken, sharePasswordHash));
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function isShareExpired(expiresAt: Date | null | undefined, now = new Date()): boolean {
  return !!expiresAt && expiresAt.getTime() <= now.getTime();
}

/** Seven-day access at most, shortened to the database expiry when necessary. */
export function shareAccessMaxAge(expiresAt: Date | null | undefined, now = new Date()): number {
  if (!expiresAt) return ACCESS_TTL_SECONDS;
  return Math.max(0, Math.min(
    ACCESS_TTL_SECONDS,
    Math.floor((expiresAt.getTime() - now.getTime()) / 1000)
  ));
}

/** Read the exact token-bound cookie from a plain Web Request. */
export function requestHasShareAccess(
  req: Request,
  shareToken: string,
  sharePasswordHash: string | null | undefined,
  expiresAt: Date | null | undefined,
  now = new Date()
): boolean {
  if (isShareExpired(expiresAt, now)) return false;
  const name = shareAccessCookieName(shareToken);
  const cookie = req.headers.get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  const value = cookie?.slice(name.length + 1);
  return isShareAccessCookieValid(shareToken, sharePasswordHash, value);
}
