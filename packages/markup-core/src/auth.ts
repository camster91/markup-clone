// @markup/core/auth
//
// Pure (no next/headers, no prisma) authentication primitives. Anything
// that has to touch the request scope — reading the session cookie via
// `cookies()` from next/headers, or hitting the DB for `requireProjectKey`
// — stays in the app's `src/lib/auth.ts`, which re-exports the pure
// pieces from this module.
//
// What lives here:
//   - SESSION_COOKIE / SESSION_TTL_SECONDS — the cookie name + max-age
//     the app's login route writes. Both used by the next/headers-
//     bound helpers in src/lib/auth.ts.
//   - ROLES / Role — the closed set of operator / reviewer roles.
//   - getDashboardHost() — read the configured dashboard host from env.
//   - isDashboardOrigin(req) — pure check: does the request come from
//     the dashboard origin? Mutating methods (POST/PATCH/PUT/DELETE)
//     require a matching Origin header; GET/HEAD/OPTIONS also accept
//     sec-fetch-site: same-origin.
//   - requireDashboardOrigin(req) — same check, but returns the
//     NextResponse 401 for a route handler to bail out with.
//   - generateApiKey() / generateShareToken() — token factories that
//     only need `crypto`, not the request scope.
//
// What stays in src/lib/auth.ts:
//   - requireProjectKey() — uses prisma + NextResponse, so the package
//     can stay prisma-free.
//   - requireAuth() — reads the cookie via `cookies()` (next/headers),
//     so it can't live in a framework-agnostic package.

import { parseHost } from './origin';

export const SESSION_COOKIE = 'markup.session';
// 7 days — matches the Session row's expiresAt (set on issuance).
// 7d = 7 * 24 * 60 * 60 = 604800s.
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
// "operator" | "reviewer" — closed set, enforced at the API + UI
// layer. Stored as a free-form string in the DB so we can add a new
// role in a single edit without a migration.
export const ROLES = ['operator', 'reviewer'] as const;
export type Role = (typeof ROLES)[number];

/**
 * Shared shape of the "next/server" NextResponse JSON helper. We
 * import it from next/server in the root app; the @markup/core
 * package keeps a structural type so it doesn't have to depend on
 * next. Route handlers can pass either the real `NextResponse` or
 * any compatible Response; the runtime check is duck-typed.
 */
export interface AuthErrorResponse {
  status: number;
}

export function getDashboardHost(): string {
  // parseHost handles both bare-hostname and full-URL forms of the env
  // var, and falls back to 'markup.ashbi.ca' when unset. We only need
  // the bare host here — the allow-list compares against `host` (which
  // includes the port, from `new URL(origin).host`), so a different
  // port is correctly rejected even when the underlying hostname matches.
  return parseHost(process.env.DASHBOARD_HOST).host;
}

export function isDashboardOrigin(req: Request): boolean {
  const method = req.method.toUpperCase();
  const mutating =
    method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE';

  const dashboardHost = getDashboardHost();
  const origin = req.headers.get('origin');
  if (origin) {
    // Accept exact match OR a subdomain of the dashboard host
    // (`admin.markup.ashbi.ca` → allowed; `markup.ashbi.ca.evil.com` → not).
    // We do NOT use String.includes() — that accepts e.g. an `evil.com` Origin
    // whose URL contains the dashboard host as a query parameter.
    try {
      const host = new URL(origin).host;
      if (host === dashboardHost || host.endsWith('.' + dashboardHost)) return true;
    } catch {
      // Malformed Origin header — fall through.
    }
  }

  // Mutating methods must carry a matching Origin. Sec-Fetch-Site alone
  // is forgeable on non-browser clients and is not enough CSRF proof
  // for writes. Safe methods may still use same-origin Sec-Fetch-Site
  // (e.g. same-origin <img> / fetch for screenshot bytes).
  if (mutating) return false;

  if (req.headers.get('sec-fetch-site') === 'same-origin') return true;
  return false;
}

/**
 * Return a 401 Response when the request is NOT from the dashboard
 * origin, or null when it is. Route handlers spread this:
 *
 *   const blocked = requireDashboardOrigin(req);
 *   if (blocked) return blocked;
 *
 * The package returns the structural minimum (a plain object with a
 * `status` and a JSON body) so callers using `NextResponse` get a
 * drop-in replacement. We avoid depending on `next/server` here.
 */
export function requireDashboardOrigin(req: Request): { status: number; body: string } | null {
  if (isDashboardOrigin(req)) return null;
  return { status: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
}

export function generateApiKey(): string {
  return 'mk_' + require('crypto').randomBytes(20).toString('hex');
}

/**
 * 32-byte random token, base64url-encoded (no padding).
 *
 * Used for the public /share/[token] view. base64url (not standard base64)
 * keeps the token URL-safe without further escaping. 32 bytes = 256 bits of
 * entropy, which is the same security level we use for the apiKey
 * (40 hex chars = 160 bits, so this is actually stronger). The unique
 * constraint on Project.shareToken backs a uniqueness assumption that holds
 * with 1 - 2^-256 collision probability per issuance.
 */
export function generateShareToken(): string {
  return require('crypto').randomBytes(32).toString('base64url');
}
