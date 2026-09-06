/**
 * Trusted client IP for rate-limit / audit buckets.
 *
 * Behind Caddy we prefer `X-Real-IP` (set by the reverse proxy to the
 * connecting client). When only `X-Forwarded-For` is present, take the
 * **last** (rightmost) hop — that is the address the immediate proxy
 * appended. Taking the leftmost hop is forgeable by the client.
 */
export function getClientIp(req: {
  headers: { get(name: string): string | null | undefined };
}): string {
  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded
      .split(',')
      .map((hop) => hop.trim())
      .filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1]!;
  }

  return 'unknown';
}
