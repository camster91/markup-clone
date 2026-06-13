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
