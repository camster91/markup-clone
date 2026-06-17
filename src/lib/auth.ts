import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from './prisma';
import { timingSafeEqual } from 'crypto';
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

function getDashboardHost(): string {
  // parseHost handles both bare-hostname and full-URL forms of the env
  // var, and falls back to 'markup.ashbi.ca' when unset. We only need
  // the bare host here — the allow-list compares against `host` (which
  // includes the port, from `new URL(origin).host`), so a different
  // port is correctly rejected even when the underlying hostname matches.
  return parseHost(process.env.DASHBOARD_HOST).host;
}

export function isDashboardOrigin(req: Request): boolean {
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
      // Malformed Origin header — fall through to sec-fetch-site.
    }
  }
  if (req.headers.get('sec-fetch-site') === 'same-origin') return true;
  return false;
}

export function requireDashboardOrigin(req: Request): NextResponse | null {
  if (isDashboardOrigin(req)) return null;
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function requireProjectKey(req: Request, projectId: string): Promise<NextResponse | null> {
  if (isDashboardOrigin(req)) return null;

  const provided = req.headers.get('x-api-key');
  if (!provided) return NextResponse.json({ error: 'Missing X-Api-Key' }, { status: 401 });

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { apiKey: true },
  });
  if (!project || !project.apiKey) {
    return NextResponse.json({ error: 'No API key for project' }, { status: 403 });
  }
  // Constant-time comparison: keys are 40 hex chars (160 bits) so a timing
  // leak is academic on the network, but the cost of the safer check is nil
  // and the protection is one-directional (we want every project key in
  // the DB to be equally easy/hard to reject). Short-circuit on length to
  // keep the steady-state cost the same.
  const a = Buffer.from(provided);
  const b = Buffer.from(project.apiKey);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
  }
  return null;
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

/**
 * Resolve the current user from the session cookie, if any.
 *
 * Reads the `markup.session` cookie, looks up the matching Session
 * row, and returns the associated User. Returns null when:
 *   - the cookie is missing or unparseable
 *   - the cookie's token does not match any row (logged out / cleared)
 *   - the session has expired (expiresAt < now)
 *
 * Used by:
 *   - /api/auth/me (returns the user, or 401)
 *   - /api/auth/logout (clears the session row)
 *   - F10+ dashboard routes that need a real user id (presence,
 *     audit, project ownership, etc.) — they'll stack this on top
 *     of the existing requireDashboardOrigin gate.
 *
 * Not behind requireDashboardOrigin on purpose: the login route
 * (POST /api/auth/login) needs to set a session for a brand-new
 * caller who may not yet be on the dashboard origin, and the logout
 * route is idempotent (clearing a missing session is a no-op).
 */
export interface SessionUser {
  id: string;
  email: string;
  role: string;
}

export async function requireAuth(): Promise<SessionUser | null> {
  // `cookies()` is async in Next.js 15+; await it. If the read itself
  // throws (e.g. outside a request scope) we treat the same as "no
  // session" — the caller decides whether to surface a 401 or fall
  // back to a dashboard-origin gate.
  let token: string | undefined;
  try {
    const store = await cookies();
    token = store.get(SESSION_COOKIE)?.value;
  } catch {
    return null;
  }
  if (!token) return null;

  // Lookup + expiry check in a single query. Prisma's `findUnique` on
  // a unique column is O(1) on the index, so this is fast on the
  // hot path. The `include` pulls the user in the same round-trip
  // (no N+1).
  const row = await prisma.session.findUnique({
    where: { token },
    include: { user: { select: { id: true, email: true, role: true } } },
  });
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;
  return {
    id: row.user.id,
    email: row.user.email,
    role: row.user.role,
  };
}
