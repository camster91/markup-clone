import { createHash, randomBytes } from 'node:crypto';

export const DEVELOPER_API_SCOPE = 'issues:read' as const;
export const DEVELOPER_TOKEN_PREFIX = 'mkv1_' as const;
export const DEVELOPER_TOKEN_NAME_MAX = 80;
export const DEVELOPER_TOKEN_MAX_LIFETIME_DAYS = 366;

type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function hashDeveloperToken(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function createDeveloperTokenSecret(): {
  secret: string;
  tokenHash: string;
  prefix: typeof DEVELOPER_TOKEN_PREFIX;
  lastFour: string;
} {
  const secret = `${DEVELOPER_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return {
    secret,
    tokenHash: hashDeveloperToken(secret),
    prefix: DEVELOPER_TOKEN_PREFIX,
    lastFour: secret.slice(-4),
  };
}

export function parseBearerToken(header: string | null): ValidationResult<string> {
  if (!header) return { ok: false, error: 'Bearer token required' };
  const match = /^Bearer ([^\s]+)$/.exec(header);
  if (!match) return { ok: false, error: 'Authorization must use Bearer token' };
  return { ok: true, value: match[1] };
}

export function validateDeveloperTokenName(input: unknown): ValidationResult<string> {
  if (typeof input !== 'string') return { ok: false, error: 'name must be a string' };
  const value = input.trim();
  if (!value) return { ok: false, error: 'name is required' };
  if (value.length > DEVELOPER_TOKEN_NAME_MAX) {
    return { ok: false, error: `name must be ${DEVELOPER_TOKEN_NAME_MAX} characters or fewer` };
  }
  if (/\0|[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    return { ok: false, error: 'name contains invalid control characters' };
  }
  return { ok: true, value };
}

export function validateDeveloperTokenExpiry(
  input: unknown,
  now = new Date(),
): ValidationResult<Date | null> {
  if (input === null || input === undefined || input === '') return { ok: true, value: null };
  if (typeof input !== 'string') return { ok: false, error: 'expiresAt must be an ISO date-time or null' };
  const value = new Date(input);
  if (!Number.isFinite(value.getTime()) || value.toISOString() !== input) {
    return { ok: false, error: 'expiresAt must be a canonical ISO date-time' };
  }
  if (value.getTime() <= now.getTime()) return { ok: false, error: 'expiresAt must be in the future' };
  const maximum = now.getTime() + DEVELOPER_TOKEN_MAX_LIFETIME_DAYS * 24 * 60 * 60 * 1000;
  if (value.getTime() > maximum) {
    return { ok: false, error: `expiresAt must be within ${DEVELOPER_TOKEN_MAX_LIFETIME_DAYS} days` };
  }
  return { ok: true, value };
}

export function isDeveloperTokenShape(value: string): boolean {
  return /^mkv1_[A-Za-z0-9_-]{43}$/.test(value);
}
