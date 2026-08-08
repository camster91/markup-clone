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

  // Annotation payloads. The pathJson blob is small (a few hundred
  // coords at most for a freehand scribble); 16KB is enough headroom
  // for a 500-point freehand and 1000-point polyline cases.
  ANNOTATION_PATH_MAX: 16_000,

  // Team / workspace display names. Same cap as PROJECT_NAME_MAX so
  // a workspace rename can't smuggle in a giant string and balloon
  // the dashboard HTML.
  WORKSPACE_NAME_MAX: 200,
  BRAND_NAME_MAX: 120,
  BRAND_LOGO_URL_MAX: 2_048,
  REVIEWER_WELCOME_MAX: 280,
  TEAM_NAME_MAX: 200,
  TEAM_MEMBER_EMAIL_MAX: 320,
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
  // Hex / octal dotted forms that bypass the decimal \d{1,3} check:
  //   0x7f.0.0.1   0xA9.0xFE.0xA9.0xFE   0177.0.0.1
  // Chromium / libc will happily resolve these to loopback / IMDS.
  if (/(?:^|\.)0x[0-9a-f]+/i.test(lower)) {
    return { ok: false, error: 'domain must not be a hex-encoded IP address' };
  }
  if (/(?:^|\.)0[0-7]{3,}(?:\.|$)/.test(lower)) {
    return { ok: false, error: 'domain must not be an octal-encoded IP address' };
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
  // Reject rebinding / wildcard DNS helpers that map public names onto
  // private IPs (e.g. 169.254.169.254.nip.io). Any hostname whose labels
  // are themselves a dotted-quad is treated as an IP smuggle.
  const labels = lower.split('.');
  for (let i = 0; i + 3 < labels.length; i++) {
    const candidate = labels.slice(i, i + 4).join('.');
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(candidate)) {
      return { ok: false, error: 'domain must not embed an IP address' };
    }
  }
  return { ok: true, value: lower };
}

/** Alias used by CLAUDE.md / route docs — same UUID check as pins. */
export function validateProjectId(id: unknown): ValidationResult<string> {
  return validateUuidParam(id, 'projectId');
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

/** Closed set of annotation kinds. We keep the value a string at the DB
 *  level (free-form text column) so adding a new kind doesn't require a
 *  Prisma migration; the API layer enforces membership in this set. */
export const ANNOTATION_KINDS = ['arrow', 'box', 'freehand'] as const;
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];

/** Validates an annotation `kind`. Closed set, case-sensitive. */
export function validateAnnotationKind(value: unknown): ValidationResult<AnnotationKind> {
  if (typeof value !== 'string') return { ok: false, error: 'kind must be a string' };
  if (!(ANNOTATION_KINDS as readonly string[]).includes(value)) {
    return { ok: false, error: `kind must be one of: ${ANNOTATION_KINDS.join(', ')}` };
  }
  return { ok: true, value: value as AnnotationKind };
}

// Closed set of TeamMember.role. Free-form string at the DB level
// (so we can add a new role in a single edit without a migration);
// the API + UI enforce membership in this set.
export const TEAM_ROLES = ['owner', 'contributor', 'client', 'guest'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export function validateTeamRole(value: unknown): ValidationResult<TeamRole> {
  if (typeof value !== 'string') return { ok: false, error: 'role must be a string' };
  if (!(TEAM_ROLES as readonly string[]).includes(value)) {
    return { ok: false, error: `role must be one of: ${TEAM_ROLES.join(', ')}` };
  }
  return { ok: true, value: value as TeamRole };
}

/** Validates a workspace / team display name. Same shape as the
 *  project-name validator (1-200 chars, no null bytes). The closed
 *  set is "any printable string" — we don't reject bidi / zero-width
 *  for the same i18n reasons documented on validateProjectName. */
export function validateWorkspaceName(value: unknown): ValidationResult<string> {
  if (typeof value !== 'string') return { ok: false, error: 'name must be a string' };
  if (value.length === 0) return { ok: false, error: 'name must not be empty' };
  if (value.length > LIMITS.WORKSPACE_NAME_MAX) {
    return { ok: false, error: `name must be ≤${LIMITS.WORKSPACE_NAME_MAX} chars` };
  }
  if (value.includes('\x00')) return { ok: false, error: 'name must not contain null bytes' };
  return { ok: true, value };
}

function optionalTrimmedString(
  value: unknown,
  field: string,
  max: number,
): ValidationResult<string | null> {
  if (value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: `${field} must be a string or null` };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > max) return { ok: false, error: `${field} must be ≤${max} chars` };
  if (trimmed.includes('\0')) return { ok: false, error: `${field} contains invalid characters` };
  return { ok: true, value: trimmed };
}

export function validateBrandName(value: unknown): ValidationResult<string | null> {
  return optionalTrimmedString(value, 'brandName', LIMITS.BRAND_NAME_MAX);
}

export function validateReviewerWelcome(value: unknown): ValidationResult<string | null> {
  return optionalTrimmedString(value, 'reviewerWelcome', LIMITS.REVIEWER_WELCOME_MAX);
}

export function validateBrandAccentColor(value: unknown): ValidationResult<string | null> {
  const normalized = optionalTrimmedString(value, 'accentColor', 7);
  if (!normalized.ok || normalized.value === null) return normalized;
  const color = normalized.value.toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(color)) {
    return { ok: false, error: 'accentColor must be a six-digit hex color' };
  }
  return { ok: true, value: color };
}

export function validateBrandLogoUrl(value: unknown): ValidationResult<string | null> {
  const normalized = optionalTrimmedString(value, 'logoUrl', LIMITS.BRAND_LOGO_URL_MAX);
  if (!normalized.ok || normalized.value === null) return normalized;
  let url: URL;
  try {
    url = new URL(normalized.value);
  } catch {
    return { ok: false, error: 'logoUrl must be a valid HTTPS URL' };
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    return { ok: false, error: 'logoUrl must be a public HTTPS URL without credentials' };
  }
  if (/\.(?:svg|svgz|xml)$/i.test(url.pathname)) {
    return { ok: false, error: 'logoUrl must use a raster image format' };
  }
  return { ok: true, value: url.toString() };
}

/** Validates a team name. Identical shape to the workspace validator;
 *  separate symbol so the error message reads naturally at the call
 *  site ("team name must be a string", not "workspace name must be
 *  a string"). */
export function validateTeamName(value: unknown): ValidationResult<string> {
  if (typeof value !== 'string') return { ok: false, error: 'name must be a string' };
  if (value.length === 0) return { ok: false, error: 'name must not be empty' };
  if (value.length > LIMITS.TEAM_NAME_MAX) {
    return { ok: false, error: `name must be ≤${LIMITS.TEAM_NAME_MAX} chars` };
  }
  if (value.includes('\x00')) return { ok: false, error: 'name must not contain null bytes' };
  return { ok: true, value };
}

/** Validates a TeamMember email at invite time. Same shape as the
 *  subscriber-email validator (case-normalised to lowercase) — the
 *  invite flow stores the lowercased form on the row so the same
 *  email always resolves to the same row. */
export function validateTeamMemberEmail(value: unknown): ValidationResult<string> {
  const res = validateEmail(value);
  if (!res.ok) return res;
  return { ok: true, value: res.value.toLowerCase() };
}

/** Validates the workspaceId / teamId URL param. Same UUID regex as
 *  validateScreenshotId / validatePinId — Prisma's @default(uuid())
 *  is the source of truth, so every project / workspace / team id
 *  is a UUID. Rejecting early avoids hitting the DB with a
 *  parse-error path that would otherwise surface as a 500. */
export function validateUuidParam(value: unknown, fieldName: string): ValidationResult<string> {
  if (typeof value !== 'string') return { ok: false, error: `${fieldName} must be a string` };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return { ok: false, error: `${fieldName} must be a UUID` };
  }
  return { ok: true, value };
}

/** Validates an annotation path blob. The shape is opaque to the DB (we
 *  store a JSON string) but it MUST be:
 *   - a JSON array
 *   - of at least 2 points (an arrow / box needs 2; a freehand needs ≥2)
 *   - each point is a [x, y] pair of finite non-negative numbers
 *   - the serialized form fits in LIMITS.ANNOTATION_PATH_MAX bytes
 *
 *  The function returns the canonical re-serialized JSON string so the
 *  caller stores a normalized form (whitespace removed, key order
 *  stable). The dashboard re-parses the same string and trusts it; the
 *  widget also re-parses its own submission, so the round-trip is the
 *  test surface.
 *
 *  Coordinate bounds: the widget converts viewport-px to image-px by
 *  scaling against (screenshot.width / window.innerWidth). Image natural
 *  width is bounded by MAX_SCREENSHOT_BYTES * 8 (rough sanity: a
 *  8MB PNG is at most ~100k pixels wide); we cap individual coords at
 *  100_000 which covers any reasonable screenshot. The dashboard then
 *  re-projects to a 0-100 percentage based on the screenshot's natural
 *  size. */
export function validateAnnotationPath(
  raw: unknown
): ValidationResult<{ json: string; points: number[][] }> {
  if (typeof raw !== 'string') return { ok: false, error: 'pathJson must be a string' };
  if (raw.length === 0) return { ok: false, error: 'pathJson must not be empty' };
  if (raw.length > LIMITS.ANNOTATION_PATH_MAX) {
    return { ok: false, error: `pathJson must be ≤${LIMITS.ANNOTATION_PATH_MAX} chars` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'pathJson must be valid JSON' };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: 'pathJson must be a JSON array' };
  }
  if (parsed.length < 2) {
    return { ok: false, error: 'pathJson must have at least 2 points' };
  }
  const out: number[][] = [];
  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i];
    if (!Array.isArray(p) || p.length !== 2) {
      return { ok: false, error: `pathJson[${i}] must be a [x, y] pair` };
    }
    const x = Number(p[0]);
    const y = Number(p[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { ok: false, error: `pathJson[${i}] coords must be finite numbers` };
    }
    if (x < 0 || y < 0) {
      return { ok: false, error: `pathJson[${i}] coords must be non-negative` };
    }
    if (x > 100_000 || y > 100_000) {
      return { ok: false, error: `pathJson[${i}] coords out of range` };
    }
    out.push([x, y]);
  }
  return { ok: true, value: { json: JSON.stringify(out), points: out } };
}
