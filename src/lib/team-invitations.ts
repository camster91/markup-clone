import { createHash, randomBytes } from 'node:crypto';

type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function generateInvitationToken(): string {
  return randomBytes(32).toString('base64url');
}

export function validateInvitationToken(value: unknown): ValidationResult<string> {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    return { ok: false, error: 'Invalid invitation' };
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length !== 32 || decoded.toString('base64url') !== value) {
    return { ok: false, error: 'Invalid invitation' };
  }
  return { ok: true, value };
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function buildInvitationUrl(dashboardHost: string, token: string): string {
  const parsed = new URL(dashboardHost);
  parsed.pathname = '/invite';
  parsed.search = '';
  parsed.hash = token;
  return parsed.toString();
}

export function validateInvitationPassword(value: unknown): ValidationResult<string> {
  if (typeof value !== 'string') {
    return { ok: false, error: 'Password must be a string' };
  }
  if (value.length < 12 || value.length > 128) {
    return { ok: false, error: 'Password must be between 12 and 128 characters' };
  }
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value) || value.includes('\0')) {
    return { ok: false, error: 'Password must include letters and numbers' };
  }
  return { ok: true, value };
}
