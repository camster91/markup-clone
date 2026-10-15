# Rate limiter — per-process limitation

The rate limiter in `src/lib/rate-limit.ts` holds its token buckets in a
module-level `Map` that lives entirely in the Node.js process's memory — there
is no cross-process sharing, no Redis, no database. For the current deploy
(`next start` behind PM2 with a single instance) this is fine: every request
hits the same buckets and the throttles behave as configured. If the service
is ever scaled horizontally (multiple Node workers, multiple containers, or a
serverless runtime), each instance would maintain its own buckets and the
effective rate limit per key would balloon to roughly `N × maxTokens`, which
defeats the throttle. The migration path is to back the buckets with a shared
store — the natural choice given the rest of the stack is a Postgres table
holding `(key, tokens, last_refill)` and using a row-level lock (e.g.
`SELECT … FOR UPDATE`) inside `consume()` for atomic refill+decrement;
Redis `INCR` + `EXPIRE` is the lighter alternative if Redis is already in
the stack. The `consume(key, opts)` signature is the only seam that would
need to change, so callers (`/api/pins` and `/api/screenshots/.../recapture`)
stay the same. Until then, do not horizontally scale this service without
first swapping the implementation.

## Client IP (proxy headers)

Per-IP buckets key on `getClientIp()` in `src/lib/request-ip.ts`. The
value is taken from proxy headers, so it is only as trustworthy as the
proxy configuration:

- **`X-Forwarded-For` (default path).** Each reverse proxy appends the
  address of the peer it accepted the connection from. The app reads the
  `TRUSTED_PROXY_HOPS`-th entry from the right (default `1`). Entries to
  the left of that are client-supplied and ignored. Single Caddy or single
  Coolify/Traefik → `1`; a CDN in front of Traefik → `2`.
- **`X-Real-IP` (opt-in).** Ignored unless `TRUST_X_REAL_IP=true`. The bare
  Caddy `reverse_proxy` route written by `scripts/deploy.sh` /
  `scripts/markup-caddy-guard.sh` forwards a client-supplied `X-Real-IP`
  untouched; trusting it let a client rotate the header to get a fresh
  bucket per request (defeating login brute-force limits). Traefik
  overwrites `X-Real-Ip`, so the opt-in is safe there; Caddy would need
  `header_up X-Real-IP {remote_host}` first.
- A selected entry that does not look like an IP falls back to the shared
  `unknown` bucket.

## Store bounds

The in-memory store is bounded so unauthenticated callers cannot grow it
without limit between the 5-minute stale sweeps:

- Keys longer than `MAX_KEY_LENGTH` (256) are folded to a readable prefix
  plus a SHA-256 digest of the full key, so distinct long keys never share
  a bucket. The login route also rejects emails over 254 chars before
  building `login:email:<email>`.
- At most `MAX_BUCKETS` (50,000) buckets are held. A new key at capacity
  first triggers a stale sweep, then evicts the least-recently-used
  bucket. Evicting resets that bucket to full, so a client able to mint
  50k fresh keys faster than its own throttled bucket refills could reset
  it — the accepted trade-off for bounded memory until the store moves to
  a shared backend.
