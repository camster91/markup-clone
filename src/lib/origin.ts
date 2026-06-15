// Unified host/origin parser.
//
// Single source of truth for translating a DASHBOARD_HOST-style env var
// (which can be set in two equivalent forms — bare hostname or full URL)
// into a { host, origin } pair the rest of the app can consume without
// re-parsing.
//
// The default fallback is `markup.ashbi.ca` (apex https). This matches
// the literal that src/lib/auth.ts and src/lib/client-origin.ts used to
// hard-code; existing single-host deploys behave identically.

const DEFAULT_HOST = 'markup.ashbi.ca';
const DEFAULT_ORIGIN = `https://${DEFAULT_HOST}`;

export interface OriginInfo {
  /** Bare hostname, port stripped. Safe for host-equality comparisons. */
  host: string;
  /** Scheme + host (+ port, if any). Safe for Origin/Referer headers. */
  origin: string;
}

/**
 * Parse a DASHBOARD_HOST-style value into a { host, origin } pair.
 *
 * Accepts three forms:
 *   - undefined / null / ''  → default { markup.ashbi.ca, https://... }
 *   - 'host.example'        → { host: 'host.example', origin: 'https://host.example' }
 *   - 'https://host[:p][/p]' → parsed via `new URL(...)`; host strips any port
 *
 * Throws on a non-empty value that has a scheme but is otherwise an
 * invalid URL (e.g. 'https://[bad') — callers can wrap in try/catch if
 * they want a softer fallback. A bare hostname is always safe.
 */
export function parseHost(value: string | undefined | null): OriginInfo {
  if (value === undefined || value === null || value === '') {
    return { host: DEFAULT_HOST, origin: DEFAULT_ORIGIN };
  }

  // Bare hostname (no scheme). The simplest check: no `://` and no
  // leading `//`. The check is intentionally narrow — any `://` means
  // the user gave us a URL and we should parse it as one.
  if (!value.includes('://') && !value.startsWith('//')) {
    return { host: value, origin: `https://${value}` };
  }

  // Full URL: parse with the URL constructor. `hostname` excludes the
  // port (unlike `host`); that's what we want for host-equality checks.
  const url = new URL(value);
  return { host: url.hostname, origin: url.origin };
}
