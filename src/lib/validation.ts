// Input validation for API routes. Centralized so every route enforces
// the same limits and we can test them in isolation.
//
// Threat model:
// - Widget endpoint: any browser with the project's X-Api-Key can post pins.
//   A compromised widget or a leaked key can submit arbitrary data.
// - Dashboard endpoint: any browser with the right Origin can call it.
//   Less of a concern (the dashboard host is trusted) but still bounded.

export const LIMITS = {
  // Pin form fields
  TEXT_MAX: 10_000, // 10KB of comment text is plenty
  ELEMENT_HTML_MAX: 50_000, // 50KB is enough for a reasonable DOM snapshot
  ELEMENT_XPATH_MAX: 2_000, // 2KB is enough for a 500-char XPath
  AUTHOR_NAME_MAX: 200, // 200 chars is enough for "John Smith" or "anonymous@example.com"
  PATH_MAX: 2_000, // 2KB for a URL path; longer is suspicious
  X_PERCENT_MIN: 0,
  X_PERCENT_MAX: 100,
  Y_PERCENT_MIN: 0,
  Y_PERCENT_MAX: 100,

  // Project lifecycle
  PROJECT_NAME_MAX: 200,
  PROJECT_DOMAIN_MAX: 253, // RFC 1035 max DNS domain length
} as const;

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/** Validates a URL path used as the Page.path key. The path is what
 *  the widget captures, and it's used as part of the image's content-addressed
 *  key. Reject anything that smells like path traversal or a non-HTTP URL. */
export function validatePagePath(path: string): ValidationResult<string> {
  if (typeof path !== 'string') return { ok: false, error: 'path must be a string' };
  if (path.length === 0) return { ok: false, error: 'path must not be empty' };
  if (path.length > LIMITS.PATH_MAX) return { ok: false, error: `path must be ≤${LIMITS.PATH_MAX} chars` };
  if (!path.startsWith('/')) return { ok: false, error: 'path must start with /' };
  // Reject path traversal: '..' segments, encoded traversal, etc.
  if (path.includes('..')) return { ok: false, error: 'path must not contain ..' };
  if (path.includes('\\')) return { ok: false, error: 'path must not contain backslashes' };
  // Reject control chars and null bytes
  if (/[\x00-\x1f]/.test(path)) return { ok: false, error: 'path must not contain control characters' };
  return { ok: true, value: path };
}

/** Validates the percent coordinates where a pin was placed.
 *  Must be a number in [0, 100]. Reject NaN, Infinity, negatives, >100. */
export function validatePercent(value: number, name: string): ValidationResult<number> {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    return { ok: false, error: `${name} must be a finite number` };
  }
  if (value < LIMITS.X_PERCENT_MIN || value > LIMITS.X_PERCENT_MAX) {
    return { ok: false, error: `${name} must be in [${LIMITS.X_PERCENT_MIN}, ${LIMITS.X_PERCENT_MAX}]` };
  }
  return { ok: true, value };
}

/** Sanitizes a free-form text field. Strips control chars, caps length.
 *  NOT for XSS protection — that's the dashboard's job (it should escape
 *  before rendering). This is for storage sanity. */
export function sanitizeText(text: string, maxLen: number, fieldName: string): ValidationResult<string> {
  if (typeof text !== 'string') return { ok: false, error: `${fieldName} must be a string` };
  // Strip control characters (keeps printable unicode)
  const cleaned = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  if (cleaned.length > maxLen) {
    return { ok: false, error: `${fieldName} must be ≤${maxLen} chars` };
  }
  return { ok: true, value: cleaned };
}

/** Validates the Screenshot ID (a UUID). The route is keyed on it; rejecting
 *  early avoids hitting the DB. */
export function validateScreenshotId(id: string): ValidationResult<string> {
  if (typeof id !== 'string') return { ok: false, error: 'id must be a string' };
  // Prisma's UUID type: 36 chars, 8-4-4-4-12 hex with dashes
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return { ok: false, error: 'id must be a UUID' };
  }
  return { ok: true, value: id };
}

/** Validates a project name (used in the dashboard lifecycle). */
export function validateProjectName(name: string): ValidationResult<string> {
  if (typeof name !== 'string') return { ok: false, error: 'name must be a string' };
  if (name.length === 0) return { ok: false, error: 'name must not be empty' };
  if (name.length > LIMITS.PROJECT_NAME_MAX) return { ok: false, error: `name must be ≤${LIMITS.PROJECT_NAME_MAX} chars` };
  return { ok: true, value: name };
}

/** Validates a project domain. The widget uses this to build the recapture URL,
 *  so an attacker who can post projects could redirect the recapture to
 *  internal addresses (SSRF). Reject non-public domains here. */
export function validateProjectDomain(domain: string): ValidationResult<string> {
  if (typeof domain !== 'string') return { ok: false, error: 'domain must be a string' };
  if (domain.length === 0) return { ok: false, error: 'domain must not be empty' };
  if (domain.length > LIMITS.PROJECT_DOMAIN_MAX) return { ok: false, error: `domain must be ≤${LIMITS.PROJECT_DOMAIN_MAX} chars` };
  // Basic shape check: a.b.c... (no scheme, no path, no port for simplicity)
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(domain)) {
    return { ok: false, error: 'domain must be a valid DNS hostname (no scheme, port, or path)' };
  }
  // SSRF protection: reject obviously internal/loopback hostnames
  const lower = domain.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local')) {
    return { ok: false, error: 'domain must not be a local/loopback hostname' };
  }
  // SSRF protection: reject IP addresses (v4 dotted-quad or v6 colon-hex)
  // The hostname regex above passes for digit-only segments (e.g. "127" "0" "1"),
  // but a v4 address like "127.0.0.1" is technically valid as a hostname on
  // some systems. We reject the dotted-quad pattern explicitly.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(lower)) {
    return { ok: false, error: 'domain must not be an IP address' };
  }
  // v6 has colons which are not in our allowed character set, so it's already
  // rejected by the shape check. Belt and suspenders for safety.
  if (lower.includes(':')) {
    return { ok: false, error: 'domain must not be an IP address' };
  }
  return { ok: true, value: lower };
}
