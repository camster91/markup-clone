<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AGENTS.md — reading order for any agent touching this repo

If you're an agent (human or AI), start here. Then read in this order
**before writing any code**:

1. **`AGENTS.md`** (this file) — the universal on-ramp.
2. **`CLAUDE.md`** — Claude-specific conventions and hard don'ts.
3. **`README.md`** — current stack, deploy flow, pitfalls M1/M2/M3, env
   vars. The pitfalls section is non-optional reading; the bash
   heredoc comment trap (`<<'EOF'` vs `<<EOF`) bit us once already.
4. **`docs/plans/README.md`** — index of every active plan in the
   repo, with dates and status. Read the **active** plans, not
   `archive/`.
5. **`TASK.md`** — the current task board. Pick from here; don't
   invent work.
6. **`docs/refactor/2026-06-15-refactor-plan.md`** and
   **`docs/refactor/2026-06-17-p1-audit.md`** — the most recent
   structural refactor plan + verification cycle. Lots of items here
   were merged in the F1–F9 / P2.2 work; cross-reference `git log`.
7. **`docs/qa/production-grade-assessment.md`** — production-readiness
   audit. Read before any deploy-affecting change.

## Repo at a glance

- **Project:** Visual Feedback Tool (markup.io clone). Widget →
  `/api/pins` → Postgres → dashboard. Live at `markup.ashbi.ca`.
- **Stack:** Next.js 16 (App Router), Prisma 6 + PostgreSQL,
  Tailwind 4, Mailgun HTTP API, headless Chromium for recapture.
- **Deploy:** `scripts/deploy.sh` to `coolify` VPS (Caddy route
  guard, `markup-net` bridge, pg_hba trust rule). See README §"VPS
  deploy flow".
- **Auth:** `requireProjectKey` (widget) + `requireDashboardSession`
 (dashboard = Origin CSRF + session cookie) in `src/lib/auth.ts`.
 Widget writes need `X-Api-Key` unless the caller also has a live
 dashboard session. Do not reintroduce Origin-only gates on
 dashboard routes — Origin headers are forgeable.
- **Tests:** Vitest, 259+/259+ passing. `npm test` and `npm run lint`
  are the real local gates; CI on this private repo is on the
  spending-limit plan and may show failures that aren't real.

## Hard don'ts

- **Don't trust root `CONSOLIDATION-PLAN.md`.** It's an orphaned FFH
  WordPress plan, unrelated to this repo. Scheduled for deletion; do
  not act on it.
- **Don't open `docs/plans/archive/*` and start building from it.**
  Plans in `archive/` are quarantined for a reason. See
  `docs/plans/archive/README.md`.
- **Don't bypass `validateScreenshotId` on `/api/screenshots/[id]/*`
  routes.** All four handlers MUST call it before any DB or `psql`
  call (audit F3). Without it, a non-UUID id 500s.
- **Don't write bash heredocs with bare `<<EOF`** if the body has
  shell metacharacters in comments. Use `<<'EOF'` (quoted). The
  unquoted form performs substitution on `#` comments, and an
  unbalanced `)` in a comment is a syntax error pointing at the
  wrong line.
- **Don't run `next dev` against the live deploy database.** Use the
  local `docker-compose.yml` postgres.

## If you find something missing from the docs

If you're about to start work and the relevant plan doesn't exist,
write it before writing code. New plans go in `docs/plans/` dated
`YYYY-MM-DD` and indexed from `docs/plans/README.md`. This is how the
docs stay current — agents adding to the repo, not just consuming
it.