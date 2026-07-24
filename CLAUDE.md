@AGENTS.md

# Claude-specific notes

This file is intentionally short — Claude already follows the universal
on-ramp in `AGENTS.md`. Add only the **Claude-specific** conventions
and hard don'ts below.

## Conventions

- Use `requireProjectKey(req)` for widget-originated requests and
  `requireDashboardOrigin(req)` for dashboard-originated requests.
  Do not introduce new auth helpers — both exist in `src/lib/auth.ts`
  and both are battle-tested.
- Validate all UUID params with `validateScreenshotId` /
  `validateProjectId` / `validatePinId` from `src/lib/validation.ts`.
  Never `parseInt(req.params.id)` and trust the result — every route
  that takes an id has a validator for a reason.
- Sanitize free-text input with `validatePinText` from
  `src/lib/validation.ts` (length cap, trim, null-byte rejection).
  Do not roll a new sanitiser inline.
- The `audit()` call in `src/lib/audit.ts` is mandatory on every
  dashboard-origin write. Skipping it breaks the `/api/audit` log
  the operator relies on for triage.
- Rate-limit before the DB write, after the auth check. Bucket key
  format: `<endpoint>:origin:<host>:<id>`. See `src/lib/rate-limit.ts`.

## Hard don'ts

- **No new dependencies** without first checking the bundle size
  impact via `npm run build`. The deploy image is hand-tuned for
  size; introducing a 200KB transitive dep will break the build.
- **No `any` casts on Prisma query results.** Use `Prisma.<Model>GetX`
  payload types or `select: { field: true }` to narrow.
- **No silent catch-and-continue.** `src/app/api/pins/[id]/comments/route.ts`
  uses silent catch in the mention dispatch on purpose (it's a
  best-effort enhancement) — that's the only approved site. Every
  other catch block must log and re-throw or surface the error.
- **No changes to `scripts/deploy.sh` without running the full
  `scripts/cleanup-caddy-orphans.sh && bash scripts/deploy.sh`
  dry-run on a non-prod host first.** The script mutates the host
  filesystem; mistakes are not local-only.

## When you finish a task

Update `TASK.md` — move the item from `in-progress` to `done` and
note the commit SHA. The board is the source of truth for "what
shipped."