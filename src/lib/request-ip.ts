// Trusted client IP extraction for rate-limit keys.
//
// Behind Caddy, `X-Real-Ip` is set to the connecting client and
// `X-Forwarded-For` is appended (client-prepended junk is ignored
// when we take the rightmost hop). Prefer X-Real-Ip; fall back to
// the last X-Forwarded-For hop; else `'unknown'`.

/**
 * Return the client IP we trust for rate limiting / audit.
 */
export function getClientIp(req: Request): string {
  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const hops = xff.split(',').map((h) => h.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1]!;
  }

  return 'unknown';
}
