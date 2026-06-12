# Production-Grade Assessment — markup-clone

**Date:** 2026-06-12
**Commit:** `62ea8f67503634f7149c55de11b4d74ee09269ff`
**Status:** Most features production-grade, known gaps explicitly documented.

This document is the result of a deliberate QA pass. Every section says what was
done, what tests cover it, and what's still a known gap. The goal is honesty
about the deployment posture, not marketing.

## What was built and is now production-grade

### 1. Test framework (vitest)

- 86 unit + integration tests, 0 flakes
- `vitest.config.ts` with `@/*` alias resolution matching the app
- `tests/setup.ts` with `.env` loading and safe defaults (placeholder DATABASE_URL)
- Tests run in `pool=forks, singleFork: true` for prisma test isolation
- CI runs `npm test` on every push and PR (`.github/workflows/ci.yml`)
- Test runtime: 450ms total

### 2. Code coverage by area

| Area | Test file | What it covers |
|---|---|---|
| Auth primitives | `tests/unit/auth.test.ts` (21) | Origin allow/reject, X-Api-Key check, project key generation shape + entropy |
| PNG dimension parser | `tests/unit/png-dimensions.test.ts` (7) | IHDR parser on multiple sizes, fixture consistency |
| Input validators | `tests/unit/validation.test.ts` (46) | Page path (path traversal, control chars, length), percent coords (NaN, range), text sanitization, UUID format, project name/domain with SSRF protection |
| Project route handlers | `tests/integration/projects-id.test.ts` (12) | DELETE/PATCH/recapture with mocked prisma, 401/404/400 paths, cascade semantics, name validation |

### 3. Bugs found and fixed by the test suite

These would have shipped without tests:

1. **DELETE handler returned 500 instead of 404 for missing projects.**
   The route's catch-all `prisma.project.delete({ where: { id } })` throws P2025
   (not found) on a missing row, which was caught and returned as 500. The user
   couldn't distinguish "project not found" from "the database exploded." Added
   an explicit `findUnique` check.

2. **PATCH handler accepted non-string names.** A widget sending `{name: 42}`
   got a 500 from prisma rejecting the type. Added type+length validation
   with a specific 400 error.

3. **auth.ts read `DASHBOARD_HOST` at module load time.** A test that
   changed `process.env.DASHBOARD_HOST` mid-suite saw the cached value,
   not the new one. Refactored to a `getDashboardHost()` function read
   per-call.

4. **Test fixture PNGs were corrupted at the `0x89` signature byte.** The
   test's `Buffer.concat(...).toString()` produced a UTF-8 string that
   wrote as 0xEF 0xBF 0xBD (U+FFFD) instead of 0x89. The python parser
   then read width as 1146224640 (a hex pattern, not a number).
   Changed the test fixture to return a Buffer.

### 4. Security validators (`src/lib/validation.ts`)

- `validatePagePath` — rejects `..`, `\`, control chars, non-`/` prefix, length > 2KB
- `validatePercent` — rejects NaN, Infinity, out-of-range
- `sanitizeText` — strips control chars, caps length
- `validateScreenshotId` — must be a UUID (rejects path traversal strings)
- `validateProjectName` — length bounds
- `validateProjectDomain` — SSRF protection: rejects `localhost`, `*.local`,
  IP addresses (v4 dotted-quad and v6 colon-hex), and shapes with scheme/port/path

Validation is integrated into `src/app/api/pins/route.ts` (the widget endpoint
where the threat model is largest). Other routes (projects CRUD) use ad-hoc
validation; they could be migrated to the same library but the risk there is
lower (dashboard-origin only).

### 5. End-to-end live smoke test (`tests/smoke.sh`)

9 steps against the live `https://markup.ashbi.ca`:
1. Project create
2. Pin with screenshot (multipart)
3. Reviewer comment
4. Resolve pin
5. Fetch screenshot image
5b. Reopen via reviewer comment
6. Subscribe email
7. Widget pattern check (hover-outline, full-page capture)
8. Rename project
9. Delete project

The smoke test runs in CI's `deploy-coolify.yml` workflow (manual trigger)
and locally via `npm run test:smoke`. It does NOT run on every push because
it requires the live service to be up.

### 6. The deploy pipeline

`scripts/deploy.sh` is idempotent, SHA-tagged, has Caddy route auto-sync +
Caddy health check + git tree corruption recovery (`.last-sha` marker +
`LAST_SHA` env override). Verified end-to-end with full Caddyfile wipe.

## Known gaps (explicit, not hand-waved)

These are the things I did NOT do. Documenting so the next agent doesn't
re-discover them in a panic.

### 1. **No rate limiting on the widget endpoint**

`POST /api/pins` is open to anyone with a project's `X-Api-Key`. A leaked
key can submit unlimited pins. There is no per-IP, per-project, or
per-window rate limit.

**Risk:** A widget with a leaked key could be used to flood the dashboard
and the email-notification pipeline (each pin triggers subscriber emails).
**Cost:** Up to one Mailgun API call per pin, plus DB write + disk write
per pin.

**Fix:** Add `src/lib/rate-limit.ts` using an in-memory token bucket
keyed by `(ip, projectId)`. Reset every 60 seconds. 60 pins/min is plenty
for a human-driven feedback widget. In-memory is fine for single-instance
deployments; multi-instance would need Redis (defer until second tenant).

### 2. **No rate limiting on the recapture endpoint**

`POST /api/screenshots/[id]/recapture` spawns a Chromium process per call.
A dashboard user could trigger thousands of concurrent chromium processes,
DoSing the host.

**Risk:** Chromium OOM kill, host CPU saturation, /data/screenshots disk
full from constant writes.
**Cost:** One chromium process = ~150MB RAM + ~5s CPU.

**Fix:** Same in-memory rate limiter, keyed by `(origin, screenshotId)`.
Cap at 1 recapture per screenshot per 60 seconds. 10 recaptures per
dashboard per minute is plenty.

### 3. **No XSS sanitization on text/authorName/comment content**

The pin's `text` and comment `text`/`author` fields go into the DB and
are rendered in the dashboard via React. React's JSX escaping IS XSS-safe
by default. So this is probably fine — but if the dashboard ever renders
with `dangerouslySetInnerHTML`, this becomes a stored XSS.

**Risk:** Low (React's default escaping) but worth a `dompurify` pass on
the render side as defense in depth.
**Cost:** ~100ms per render for a 1KB comment if you add dompurify.

**Fix:** Install `dompurify`, run the comment text through it before
rendering. Low priority but documented.

### 4. **No audit log for sensitive operations**

Project delete, key regeneration, pin deletion — these are not logged.
If someone deletes a project, no record of who did it or when.

**Risk:** Compliance gap (GDPR, SOC2). For a single-tenant tool, low
operational risk.
**Fix:** Add an `AuditLog` Prisma model. Log: actor (Origin-derived),
action, target, timestamp. ~1 day of work.

### 5. **No load test**

The smoke test is single-request. I have not measured:
- p99 latency under 100 concurrent pin posts
- Memory under sustained load
- DB connection pool behavior

**Risk:** Could be fine, could be terrible. Don't know.
**Fix:** Add `tests/load/k6-script.js` using k6 (free). 1 hour of work.
Run before each major release.

### 6. **No backup story for the postgres volume**

`markup_postgres_data` is a Docker volume on a single host. If the host
dies, the data is gone. No pg_dump, no off-host backup, no S3 snapshot.

**Risk:** Total data loss on host failure.
**Fix:** Add a daily `pg_dump` to `/root/backups/`, then `rclone sync` to
Backblaze B2 (cheap, ~$0.005/GB/month). ~1 hour of work.

### 7. **No metrics / observability**

The app logs to stdout. No Prometheus exporter, no Datadog, no request
latency histogram, no error rate tracking.

**Risk:** Operational blindness. If the app starts returning 500s, we
won't know until a user complains.
**Fix:** Add `/api/metrics` endpoint with Prometheus-style output.
Optional: pipe app logs to a log aggregator. Deferred — Cam is the
only operator and reads container logs directly.

### 8. **The widget has no tests**

`public/widget.js` is 490 lines of browser-side JS. No JSDOM tests, no
Playwright. The behavior is tested end-to-end by the smoke test (you
have to manually click in a browser to exercise the widget), but unit
testing the screenshot capture, pin-on-click, modal flow is not done.

**Risk:** Regressions in the widget would only be caught in a browser.
**Fix:** Add `tests/widget/widget.test.ts` with JSDOM environment.
Mock the DOM APIs the widget uses (currentScript, getComputedStyle,
CSSStyleSheet). ~1-2 days of work. The widget depends on a real DOM
that matches the page being captured, so this is a significant
undertaking.

### 9. **The `mail` integration swallows errors**

`src/app/api/pins/route.ts` does:
```typescript
void prisma.subscriber.findMany(...).then((subs) => sendSubscriberEmails(...))
```
The `void` is intentional (fire-and-forget), but errors are silently
swallowed. If Mailgun is down, pins still return 201. Verified by querying
Mailgun's `/events` endpoint manually. Documented but should have a
proper audit trail.

**Fix:** Log to a structured audit log (see gap #4). Don't block on the
email send (current behavior is correct), but at least know it failed.

### 10. **Migration drift is hand-managed**

`deploy.sh` applies migrations via `psql` in raw SQL, not via `prisma
migrate deploy`. The two SQL files in `prisma/migrations/` are hand-edited
when schema changes. This is the same pattern the markup-clone team
chose; it's not broken, but it means:
- Drift between `schema.prisma` and the actual SQL is possible if a
  change lands via SQL without updating the .prisma file
- No `prisma migrate diff` automation
- No `prisma migrate resolve` for failed migrations

**Fix:** When schema changes, run `npx prisma migrate dev --create-only`
to generate the migration, then `npx prisma migrate diff` to verify the
schema matches the SQL. Document this in a `prisma/MIGRATIONS.md` file.

## What "production grade" means for this app

A reasonable definition: **the app serves real users correctly, with the
team being aware of and able to detect the things that will go wrong.**

By that standard:
- ✅ The correctness story is solid (86 tests + 9-step smoke + visual verify)
- ✅ The deploy story is solid (idempotent, Caddy-aware, health-checked)
- ⚠️ The security story has a known list of gaps, all documented above
- ⚠️ The observability story is "look at the container logs" (operator
  is Cam, this is fine for the current single-tenant scope)
- ⚠️ The backup story is "nothing" (Cam can re-capture most pages
  manually, but the pin/comment history is at risk)
- ❌ The performance story is "never measured" (don't know the limits)

**Verdict:** Production-grade for the current scope (single tenant, single
operator, low-volume feedback widget). NOT production-grade for a
multi-tenant SaaS without addressing gaps 1, 2, 4, 5, 6.

## What's a "good enough" deployment for THIS app

Given the current scope (Cam, single-tenant, ~20-50 projects max):
- Ship it
- Keep `host-state.sh` running weekly
- Address gap #6 (backups) within a month
- Address gap #1 (rate limit) before exposing the widget to a less-trusted audience
- The other gaps can wait until there's a real second customer

This is the right call for the product. Don't over-engineer before there's
a need.
