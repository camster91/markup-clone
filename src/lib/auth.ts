import { NextResponse } from 'next/server';
import { prisma } from './prisma';
import { timingSafeEqual } from 'crypto';
import { parseHost } from './origin';

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
