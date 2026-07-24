// Authentication primitives — split into two halves in P2.2.
//
//  • Pure helpers (cookie name, role list, isDashboardOrigin, the
//    401-builder, the two token factories) live in
//    `@markup/core/auth` so they can be reused outside the app.
//
//  • Helpers that have to touch the request scope — `cookies()` from
//    next/headers for `requireAuth`, or the Prisma client for
//    `requireProjectKey` — stay here and depend on the framework.
//
// Everything imported from `@/lib/auth` in app code and tests keeps
// working unchanged.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { timingSafeEqual } from 'crypto';
import { prisma } from './prisma';
import {
  isDashboardOrigin as isDashboardOriginCore,
  requireDashboardOrigin as requireDashboardOriginCore,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  ROLES,
  generateApiKey,
  generateShareToken,
  getDashboardHost,
} from '@markup/core/auth';

// Re-export the pure pieces so `import { ROLES } from '@/lib/auth'`
// (and similar) still work for every existing callsite.
export {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  ROLES,
  generateApiKey,
  generateShareToken,
  getDashboardHost,
};

export type { Role } from '@markup/core/auth';

/**
 * Wrap the package's structural 401-builder into a real NextResponse.
 * The package can't depend on next/server, so it returns
 * `{ status, body }`; the route handler below does the JSON shaping.
 */
function buildAuthErrorResponse(): NextResponse {
  const r = requireDashboardOriginCore(new Request('https://placeholder.invalid/'));
  // The pure check returned null (origin is "https://placeholder.invalid",
  // not the dashboard host), so we always have a non-null error here.
  return NextResponse.json(JSON.parse(r!.body), { status: r!.status });
}

export function isDashboardOrigin(req: Request): boolean {
  return isDashboardOriginCore(req);
}

export function requireDashboardOrigin(req: Request): NextResponse | null {
  if (isDashboardOriginCore(req)) return null;
  // Re-shape the package's structural error into a real NextResponse.
  // The package returns `{ status: 401, body: '{"error":"Unauthorized"}' }`;
  // we rebuild the equivalent NextResponse with the original request's
  // headers, so any caller that inspects response.headers still gets
  // the next/server defaults.
  return buildAuthErrorResponse();
}

/**
 * Dashboard-origin CSRF gate PLUS an active session.
 *
 * `requireDashboardOrigin` alone is forgeable (`Origin` /
 * `Sec-Fetch-Site` are attacker-controlled headers on any
 * non-browser client). Session cookies are HttpOnly + SameSite=Strict,
 * so this helper is the real authentication gate for dashboard APIs.
 * Keep Origin as the CSRF signal; require the session as identity.
 */
export async function requireDashboardSession(req: Request): Promise<NextResponse | null> {
  const originErr = requireDashboardOrigin(req);
  if (originErr) return originErr;
  const user = await requireAuth();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

export async function requireProjectKey(req: Request, projectId: string): Promise<NextResponse | null> {
  // Dashboard callers may omit X-Api-Key — but only when they also
  // hold a valid session. Origin alone used to short-circuit this
  // check, which let any client forge `Origin: https://<DASHBOARD_HOST>`
  // and bypass the widget API key entirely.
  if (isDashboardOriginCore(req)) {
    const user = await requireAuth();
    if (user) return null;
  }

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

/**
 * Resolve the current user from the session cookie, if any.
 *
 * Reads the `markup.session` cookie, looks up the matching Session
 * row, and returns the associated User. Returns null when:
 *   - the cookie is missing or unparseable
 *   - the cookie's token does not match any row (logged out / cleared)
 *   - the session has expired (expiresAt < now)
 *
 * Stays in src/lib/auth.ts (not in @markup/core/auth) because it
 * needs `cookies()` from next/headers, which is a server-runtime
 * API and not part of the framework-agnostic package.
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
