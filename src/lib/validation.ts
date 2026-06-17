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

  // Subscriber emails
  // RFC 5321 caps email local-part at 64 chars and domain at 255 chars;
  // 320 is the conservative whole-address cap. The audit log records the
  // email, so this also caps the line length we write to disk.
  EMAIL_MAX: 320,

  // Pin text (client feedback). Smaller than the generic TEXT_MAX because
  // a pin comment is a short reply, not a long-form review.
  PIN_TEXT_MAX: 2_000,
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

/** Validates the Pin ID (a UUID). The Pin model is `@default(uuid())` per
 *  the Prisma schema, so the same UUID regex as `validateScreenshotId`
 *  applies. Rejecting early avoids hitting the DB with a parse-error
 *  path that would otherwise surface as a generic 500. */
export function validatePinId(id: unknown): ValidationResult<string> {
  if (typeof id !== 'string') return { ok: false, error: 'pinId must be a string' };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return { ok: false, error: 'pinId must be a UUID' };
  }
  return { ok: true, value: id };
}

/** Validates a project name (used in the dashboard lifecycle).
 *
 *  Unicode / bidi-override policy: ACCEPT-AND-RENDER-SAFELY.
 *
 *  We intentionally do NOT reject Unicode bidi override characters (e.g. U+202E
 *  RIGHT-TO-LEFT OVERRIDE) or zero-width / format characters (U+200B ZERO WIDTH
 *  SPACE, U+FEFF BOM, etc.) in project names. The trade-off:
 *
 *  - XSS: React escapes string children by default. A bidi override in a name
 *    renders as that codepoint, not as markup. There is no XSS vector here.
 *  - Layout/spoofing: bidi overrides can visually reorder the *end* of a
 *    string in screenshots and dashboards (e.g. "evil\u202Egpj.exe" rendering
 *    as "evil.exe.jpg"). This is a real but low-severity UX issue, mitigated
 *    in practice by the dashboard showing the project domain alongside the
 *    name, and by the name being visible to its author in the create form.
 *  - Internationalization: rejecting zero-width / joiner / bidi marks would
 *    block legitimate names in Arabic, Hebrew, and many South / Southeast
 *    Asian scripts that rely on these codepoints for correct rendering.
 *
 *  Defense-in-depth: we still reject U+0000 (null byte) at the
 *  `validatePagePath` / DB-layer boundary for free-form text fields. Null
 *  bytes truncate C strings and have historically broken log aggregators
 *  and a few ORMs; bidi / zero-width chars do not. We also reject U+0000
 *  here so a project name with a stray null never reaches the DB / filesystem.
 *  See `validation.test.ts` for the explicit accept / reject tests. */
export function validateProjectName(name: string): ValidationResult<string> {
  if (typeof name !== 'string') return { ok: false, error: 'name must be a string' };
  if (name.length === 0) return { ok: false, error: 'name must not be empty' };
  if (name.length > LIMITS.PROJECT_NAME_MAX) return { ok: false, error: `name must be ≤${LIMITS.PROJECT_NAME_MAX} chars` };
  // Defense-in-depth: reject U+0000 (null byte). Bidi / zero-width chars
  // are still accepted (see policy comment above).
  if (name.includes('\x00')) return { ok: false, error: 'name must not contain null bytes' };
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
  const lower = domain.toLowerCase();

  // SSRF protection: reject obviously internal/loopback hostnames.
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local')) {
    return { ok: false, error: 'domain must not be a local/loopback hostname' };
  }
  // SSRF protection: reject known cloud-metadata and internal-cluster
  // hostnames. Chromium on the recapture path will happily connect to
  // these and render the response, leaking instance credentials or
  // service tokens. Deny by suffix.
  if (
    lower.endsWith('.internal') ||
    lower.endsWith('.lan') ||
    lower.endsWith('.intranet') ||
    lower.endsWith('.corp') ||
    lower.endsWith('.private') ||
    lower === 'metadata.google.internal' ||
    lower.endsWith('.metadata.google.internal') ||
    lower === 'metadata.azure.com' ||
    lower.endsWith('.metadata.azure.com') ||
    lower.endsWith('.svc.cluster.local')
  ) {
    return { ok: false, error: 'domain must not be an internal/cluster hostname' };
  }
  // SSRF protection: reject IP addresses (v4 dotted-quad, decimal-encoded
  // v4, or v6 colon-hex). The hostname regex above passes for digit-only
  // segments (e.g. "127" "0" "1"), but a v4 address like "127.0.0.1" is
  // technically valid as a hostname on some systems. Also reject the
  // decimal form (e.g. 2130706433 = 127.0.0.1) and link-local
  // 169.254.0.0/16 (AWS/GCP IMDS at 169.254.169.254).
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(lower)) {
    return { ok: false, error: 'domain must not be an IP address' };
  }
  // Decimal-encoded IPv4: a single label that is a 32-bit unsigned int.
  if (/^\d+$/.test(lower)) {
    const n = Number(lower);
    if (n >= 0 && n <= 0xffffffff) {
      return { ok: false, error: 'domain must not be a numeric (decimal-encoded) IP address' };
    }
  }
  // v6 has colons which are not in our allowed character set, so it's already
  // rejected by the shape check. Belt and suspenders for safety.
  if (lower.includes(':')) {
    return { ok: false, error: 'domain must not be an IP address' };
  }
  return { ok: true, value: lower };
}

// Conservative RFC 5322 subset for the local part. We deliberately reject
// quoted strings ("foo bar"), comments, IP-literal domains, etc. —
// subscribers are real email addresses entered by humans, not arbitrary
// RFC 5322 edge cases. The dot-atom shape below is what the vast majority
// of real addresses use, and it also rejects leading/trailing dots and
// consecutive dots (the two most common typos / abuse patterns).
//
//   local  ::= dot-atom      // letters/digits/_%+- separated by single dots
//   domain ::= label(.label)* // DNS labels (letters/digits/-) with a TLD
//
// The TLD is required to be ≥2 alpha chars (rejects the "alice@host.1"
// numeric-TLD case which some lenient validators accept).
const EMAIL_RE = /^[A-Za-z0-9_%+-]+(?:\.[A-Za-z0-9_%+-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

/** Validates an email address. Conservative: rejects spaces, quoted
 *  local parts, IP-literal domains, and any input that doesn't fit the
 *  common `local@domain.tld` shape. Returns the address unchanged —
 *  callers that need case-normalization should use `validateSubscriberEmail`. */
export function validateEmail(value: unknown): ValidationResult<string> {
  if (typeof value !== 'string') return { ok: false, error: 'email must be a string' };
  if (value.length === 0) return { ok: false, error: 'email must not be empty' };
  if (value.length > LIMITS.EMAIL_MAX) {
    return { ok: false, error: `email must be ≤${LIMITS.EMAIL_MAX} chars` };
  }
  if (!EMAIL_RE.test(value)) {
    return { ok: false, error: 'email must be a valid address (local@domain.tld)' };
  }
  return { ok: true, value };
}

/** Validates a subscriber email address: same as `validateEmail`, but
 *  case-normalized to lowercase. Subscribers are looked up by email, so
 *  `Alice@Example.com` and `alice@example.com` must collapse to the same
 *  row — do the normalization here so the route doesn't have to remember. */
export function validateSubscriberEmail(value: unknown): ValidationResult<string> {
  const res = validateEmail(value);
  if (!res.ok) return res;
  return { ok: true, value: res.value.toLowerCase() };
}

/** Validates the free-form text of a pin comment. The widget captures
 *  whatever the user types, and we store it as-is (the dashboard escapes
 *  on render). Constraints:
 *   - 1-2000 chars after trimming leading/trailing whitespace
 *   - no null bytes (U+0000) — they truncate C strings and have broken
 *     log aggregators and a few ORMs in the past
 *
 *  Other control characters (newlines, tabs) are accepted as-is so users
 *  can write multi-line feedback. The trim happens here so callers don't
 *  have to remember to `.trim()` before checking length. */
export function validatePinText(value: unknown): ValidationResult<string> {
  if (typeof value !== 'string') return { ok: false, error: 'text must be a string' };
  // Reject null bytes BEFORE trimming — `trim()` doesn't touch \x00, but
  // doing it first keeps the intent explicit and the order of error
  // messages predictable for tests.
  if (value.includes('\x00')) return { ok: false, error: 'text must not contain null bytes' };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: false, error: 'text must not be empty' };
  if (trimmed.length > LIMITS.PIN_TEXT_MAX) {
    return { ok: false, error: `text must be ≤${LIMITS.PIN_TEXT_MAX} chars` };
  }
  return { ok: true, value: trimmed };
}
