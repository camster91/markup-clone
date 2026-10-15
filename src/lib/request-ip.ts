/**
 * Trusted client IP for rate-limit / audit buckets.
 *
 * Every per-IP throttle (login brute force, pin/annotation spam,
 * invitation probing, share-link opens) keys on this value, so it
 * must not be something the client can choose.
 *
 * ─── Proxy model ──────────────────────────────────────────────────────────
 * A reverse proxy APPENDS the address of the peer it accepted the
 * connection from to `X-Forwarded-For` (Caddy may instead replace the
 * header outright for untrusted peers; either way the right-most entry
 * is the one it wrote). Anything to the left of the entries our own
 * proxies wrote is client-supplied and forgeable.
 *
 * `TRUSTED_PROXY_HOPS` (default 1) is the number of reverse proxies
 * in front of the app that append to `X-Forwarded-For`. The client IP
 * is the entry that the outermost trusted proxy appended, i.e. the
 * N-th entry from the right. Single Caddy or single Traefik → 1.
 * Cloudflare → Traefik → app → 2.
 *
 * `X-Real-IP` is IGNORED unless `TRUST_X_REAL_IP=true`. A bare Caddy
 * `reverse_proxy` (what scripts/deploy.sh and markup-caddy-guard.sh
 * write today) passes a client-supplied `X-Real-IP` through untouched,
 * so trusting it unconditionally let an attacker rotate the header and
 * get a fresh rate-limit bucket on every request. Only set the opt-in
 * when the edge proxy is known to OVERWRITE the header (Traefik does;
 * Caddy needs `header_up X-Real-IP {remote_host}`).
 *
 * See docs/rate-limit-limitations.md and .env.example.
 */

type HeaderSource = {
  headers: { get(name: string): string | null | undefined };
};

type IpEnv = Record<string, string | undefined>;

const DEFAULT_TRUSTED_PROXY_HOPS = 1;
const MAX_TRUSTED_PROXY_HOPS = 10;

// Loose IPv4 / IPv6 shape check — rejects garbage (and anything long
// enough to bloat a rate-limit key) without needing `node:net`, so the
// helper stays usable from any runtime.
const IP_SHAPE = /^[0-9a-fA-F:.]{2,45}$/;

function looksLikeIp(value: string): boolean {
  return IP_SHAPE.test(value) && (value.includes('.') || value.includes(':'));
}

/** Parse `TRUSTED_PROXY_HOPS`; invalid / out-of-range values fall back to 1. */
export function trustedProxyHops(env: IpEnv = process.env): number {
  const raw = env.TRUSTED_PROXY_HOPS?.trim();
  if (!raw) return DEFAULT_TRUSTED_PROXY_HOPS;
  if (!/^\d+$/.test(raw)) return DEFAULT_TRUSTED_PROXY_HOPS;
  const n = Number(raw);
  if (n < 1 || n > MAX_TRUSTED_PROXY_HOPS) return DEFAULT_TRUSTED_PROXY_HOPS;
  return n;
}

function trustXRealIp(env: IpEnv): boolean {
  const raw = env.TRUST_X_REAL_IP?.trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

export function getClientIp(req: HeaderSource, env: IpEnv = process.env): string {
  if (trustXRealIp(env)) {
    const realIp = req.headers.get('x-real-ip')?.trim();
    if (realIp && looksLikeIp(realIp)) return realIp;
  }

  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded
      .split(',')
      .map((hop) => hop.trim())
      .filter(Boolean);
    if (hops.length > 0) {
      // N-th from the right. If the chain is shorter than the configured
      // hop count every entry was written by a trusted proxy, so the
      // left-most one is the best available answer.
      const index = Math.max(0, hops.length - trustedProxyHops(env));
      const candidate = hops[index]!;
      if (looksLikeIp(candidate)) return candidate;
    }
  }

  return 'unknown';
}
