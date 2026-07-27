# Plans — index

This directory is the **landing zone for project plans**. Anything that
informs "what to build next" lives here, in version control, so any
agent that clones the repo lands on the current truth rather than
guessing from chat history.

## Layout

| Path | Purpose | Status |
|---|---|---|
| `archive/` | Superseded dev plans. Quarantined so they can't poison the next agent. **Read the warning in `archive/README.md` before opening anything here.** | active |
| `<name>-<YYYY-MM-DD>.md` | Active plans, dated. Newest first. | active |

## Current plans

- `docs/qa/2026-07-24-production-security-audit.md` — **Current**
  production security / reliability audit. Critical + High items
  patched on `cursor/production-security-audit-4eb8`. Read before
  any auth, integrations, or screenshot-serving change.
- `docs/refactor/2026-06-15-refactor-plan.md` — R0.x structural work,
  P0/P1/P2 prioritized. Most P0 items merged; P1 partially merged in
  the 2026-06-16/17 P1-wave audit cycle. See the R0 audit comment in
  `README.md` for what landed. R1.2 (CSRF) landed in the 2026-07-24
  security audit.
- `docs/refactor/2026-06-17-p1-audit.md` — Verification of the 4 fix
  cards from 2026-06-16 plus a P1-wave regression sweep. Read for
  context before touching the validators in `src/lib/validation.ts`.
- `docs/qa/production-grade-assessment.md` — Earlier (2026-06-12)
  production-readiness assessment. Superseded for auth/SSRF/CSRF by
  the 2026-07-24 audit; still useful for historical gap notes.
- `docs/rate-limit-limitations.md` — In-process rate-limit caveats.
  Read before scaling horizontally.

## Pending planning

The project lacks a current (post-July 2026) plan for Phase 5 work —
billing polish, per-site sitemap/OG, analytics, form webhooks, media
library, template gallery, team seats, GitHub export, generation
quality. A new plan should be filed here as `phase-5-YYYY-MM-DD.md`
before any of those features are started.

## Don't

- Don't open the root `CONSOLIDATION-PLAN.md` — it's an orphaned FFH
  WordPress consolidation plan, unrelated to this repo. It is scheduled
  for deletion; do not act on it.
- Don't trust any plan dated before 2026-06-15 without re-validating
  against `git log --oneline` — much of the F1–F9 / P2.2 work has
  changed what was assumed.