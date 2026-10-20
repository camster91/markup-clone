# Close the DNS-rebinding gap for outbound webhooks (2026-10-20)

**Status:** implemented on branch `ccr-ff82cc8e-enzsdu`; not yet deployed.
**Source:** the "known limitation" in `src/lib/safe-url.ts`, listed as an
open item after the 2026-10-15 review.

## Problem

Slack, Discord and generic webhook deliveries go to URLs that project admins
enter. `assertSafeOutboundUrl` resolves the hostname and rejects private or
reserved addresses, but then `fetch` resolves the hostname again. A hostile DNS
server with a 0-TTL record can answer the check with a public address and the
connection with an internal one (DNS rebinding).

HTTPS-only already limited the damage: a rebound connection to an internal
service still needs a certificate valid for the attacker's hostname. But the
TCP connection was made, so internal ports could be probed.

## Change

- `src/lib/safe-url.ts`:
  - `guardedLookup` is a socket `lookup` that resolves the hostname and
    refuses (`EADDRBLOCKED`) if any address is blocked. It runs at connect
    time, on the resolution the socket actually uses.
  - `safeFetch(url, init)` is Node's `fetch` with an `undici` `Agent` whose
    `connect.lookup` is `guardedLookup`.
- The Slack, Discord and webhook adapters call `safeFetch` instead of `fetch`.
  `assertSafeOutboundUrl` stays as the pre-flight check, because it gives the
  clear rejection message.
- A refused connection surfaces as a network error, so the delivery queue
  retries it and then dead-letters it, like any unreachable receiver.
- The GitHub adapter only calls the fixed `api.github.com` host and is
  unchanged.

## Dependency

`undici` (7.30.1) moves from a dev-only transitive dependency (via jsdom) to
a runtime dependency; the lockfile entry already existed. It has the same
major version as the undici bundled in Node 24. `next build` standalone output
grew by about 1.5 MB (152,312 KB to 153,832 KB, +1%).

## Verification

- `tests/unit/safe-fetch-rebinding.test.ts` uses real sockets on localhost:
  - a host that resolves to a private address is refused before any TCP
    connection (the server sees 0 connections);
  - with the block list off, the same dispatcher wiring returns 200;
  - `guardedLookup` handles single and `all` lookups.
- The same checks passed under Node 24.22 (bundled undici 7.29.1), the
  production runtime, and under Node 22.
- Adapter and integration suites are unchanged apart from the `safe-url` mock.
