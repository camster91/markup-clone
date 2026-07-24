# TASK.md — markup-clone task board

**Last updated:** 2026-07-23 (initial board, parsed from `git log`
on `origin/main` HEAD `118c39e`).

**Format:** each item has a status (`shipped`, `ready`, `blocked`,
`parked`), a one-line description, and the source — git commit SHA
for shipped, source-of-truth for the rest.

**Read order for new agents:**

1. Pick from the `ready` column. Don't invent work.
2. Check the `shipped` column before assuming something isn't done.
   Several features the marketing copy / earlier plans mention are
   already on `main` — confirm before re-implementing.
3. `blocked` items need the listed unblock before they can move.

---

## 🚀 Ready (pick from here)

### Ship the AI-agent integration (README §"Future work")
- **Status:** ready · **Source:** README §"Future work"
- **Description:** "generate-fix flow, GitHub PR creation." This is
  the natural Phase 5 capstone. No code yet. Subsystems needed:
  - LLM client wrapper (probably `src/lib/ai/`).
  - Repo-pipeline integration (use the `repo-pipeline` skill from
    `~/.hermes/skills/repo-pipeline/`).
  - Dashboard UI for "Generate fix" on a pin / comment thread.
  - Audit log entries for `ai.generate-fix.start` / `ai.pr.opened`.
- **Verify before starting:** confirm no in-progress work in
  `src/lib/` for `ai-` or `agent-` named modules. Confirm no draft
  design doc in `docs/`.
- **Risk:** New external dependency (LLM API). Bundle size impact —
  per `CLAUDE.md` "no new dependencies without `npm run build`."

### Per-site sitemap.xml + OG defaults
- **Status:** ready · **Source:** claimed in prior report; not on main
- **Description:** Each project gets `/api/projects/[id]/sitemap.xml`
  + per-route OG image defaults. The widget URL pattern is
  `?project=<id>&page=<id>` so sitemap discovery needs a manifest
  endpoint too.
- **Verify before starting:** `grep -r sitemap src/` should return
  nothing; `grep -r 'og:image' src/` should be empty or stale.
- **Risk:** Per-site means per-project multi-tenant — read
  `src/lib/teams.ts` for the existing scoping pattern before
  duplicating.

### Form webhooks outbound (`/api/projects/[id]/integrations/webhook`)
- **Status:** partially shipped · **Source:** claimed in prior report
- **Description:** Subsystem exists at `src/lib/integrations/`
  (webhook/discord/slack) but only the `Integration` model + types
  in `prisma/schema.prisma`. No UI, no per-form-submit dispatch.
- **Verify before starting:** read `src/lib/integrations/dispatcher.ts`
  to see what's wired vs stub.
- **Risk:** Medium — touches the integrations system that
  `@mentions` and subscriber notifications also depend on.

### Pluggable auth providers
- **Status:** ready · **Source:** README §"Future work" implies auth
  is project-key + dashboard-origin only; no SSO/OAuth.
- **Description:** Add OAuth (Google + GitHub) for the dashboard.
  Sessions are already wired (see `model Session` in `prisma/schema.prisma`).
- **Risk:** Auth changes are high-blast-radius. Per memory: no
  silent auth changes — open a PR, get review.

---

## ✅ Shipped (don't re-implement)

The following were claimed as Phase 5 work in prior reports but are
already on `main`. Cross-reference `git log` to confirm — listed by
the merge commit / PR that landed each:

### F1–F3 (recapture + screenshots)
- Annotation tool selector (arrow/box/freehand) — F3 part 2
- `validateScreenshotId` on recapture + status routes (audit F3)
- Screenshot polling abort on unmount (audit F5)
- Rate-limit on `/api/screenshots/[id]/status` (audit F4)
- Lightweight poll endpoint (width/height/capturedAt) instead of
  full project tree

### F4–F5 (events + SSE)
- SSE endpoint at `/api/events`
- In-memory pub-sub for live pin/comment/recapture updates
- Dashboard hook consumes the SSE stream

### F6 (audit / dashboard polish)
- Audit log surfaced at `/api/audit`
- Real-time relative time format ("Updated X ago")
- Origin parser unification (D5)

### F7 (comments)
- Image attachments (paste from clipboard)
- `@mentions` in comments + email notification
- Comment thread opens the screenshot view scrolled to the new
  comment (`#comment-<id>` URL fragment)
- Comment create rate-limit (audit D8)

### F8 (integrations outbound)
- Slack / Discord / generic webhook outbound integrations
- Per-project integration config
- Validation + dispatch with retry

### F9 (multi-tenant teams)
- Workspace → Team → Member hierarchy (see `model Workspace`,
  `model Team`, `model TeamMember` in `prisma/schema.prisma`)
- `src/lib/teams.ts` for the team scoping helpers

### P2.2 (extracted `@markup/core` package)
- Shared widget primitives extracted into `packages/markup-core`
- Vite build for the widget bundle (`src/widget/`)
- ES module split (was a 496-LOC IIFE; now 5 files)

### Other
- Per-user identity with email + password (see `model User` +
  `model Session` + `src/lib/auth.ts`)
- Public read-only project share links with revoke (`/api/projects/[id]/share`)
- Recapture screenshot version history (`model ScreenshotVersion`)
- PATCH / DELETE 404s on missing records (audit 2026-06-17)

### Production security audit — Critical/High client + media (branch `cursor/production-security-audit-4eb8`)
- **Status:** shipped (this branch) — commit noted below after push
- DashboardPoller delta upsert-by-id (empty delta no longer wipes list)
- Presence GET always full TTL list (dropped `?since=`)
- Removed client-side `audit()` from `useRecaptureStatus`
- Login: cookie-only session token, IP/email rate limit, CSRF cookie
- `dashboardHeaders()` sends CSRF double-submit header
- Screenshot `/image` + `/history` gated (dashboard origin OR `?share=`)
- Home/share pages redact `apiKey` for anonymous / public viewers
- NewProjectForm try/catch/finally around create fetch

---

## 🚧 Blocked

### Tailwind 4.3.3 patch bump
- **Status:** shipped (#22, merged 2026-07-23) — was blocked on
  Dependabot auto-merge, resolved by manual `gh pr merge --squash`
  (CI billing issue on this private repo).

### `/api/comments` validation + auth
- **Status:** shipped (already on `main`) — was reported as #4 P1 on
  GitHub, but the file path in the issue (`src/app/api/comments/`)
  doesn't exist; the actual route is
  `src/app/api/pins/[id]/comments/` and has full auth + validation
  + rate-limit + sanitisation + audit. Issue can be closed as
  already-fixed. (Local-only note: do NOT auto-close on GitHub
  without explicit "publish" go from Cam.)

### FFH `CONSOLIDATION-PLAN.md` at repo root
- **Status:** parked for deletion — orphaned, unrelated to this repo
- **Unblock:** Cam's "delete that file" confirmation.

---

## 🅿️ Parked

Items claimed in prior reports that are NOT on `main` and where the
prior claim couldn't be verified against the actual git history.
Listed here so future agents don't re-discover them and either
(a) re-implement or (b) silently delete them.

### Billing polish (per-site invoicing + Stripe portal)
- No `Billing`, `Invoice`, `Subscription`, or `Plan` model in
  `prisma/schema.prisma`. No Stripe dep in `package.json`. **Not
  shipped.** Listed under `ready` (form webhooks section above) —
  reclassify if anyone wants to claim ownership.

### Media library UI (S3-backed, reusable across sites)
- No `s3`, `media`, `library`, or `bucket` references in `src/`.
  `Attachment` model exists (F7) but is per-comment only. **Not
  shipped as a standalone library.**

### Template gallery (clone-template → new site)
- No `template` model in `prisma/schema.prisma`. Project creation
  flow has no template-from-source path. **Not shipped.**

### Team seats + role permissions
- `model TeamMember` exists with a `role` field but no enforcement
  layer in route handlers. Subsystem partial — UI for managing seats
  and middleware for role checks not wired.

### GitHub export (push generated site to user's repo)
- No `octokit`, `@octokit/`, or `github` dep in `package.json`. No
  GitHub-API code in `src/lib/`. **Not shipped.**

### Generation quality passes (LLM prompt + critic loop)
- No LLM client wrapper. Tied to the "Ship the AI-agent integration"
  item above.

### Analytics integration (Plausible / Fathom)
- No analytics script tag in `src/app/layout.tsx`. No env var for
  `PLAUSIBLE_DOMAIN` or `FATHOM_SITE_ID` in `.env.example`.
  **Not shipped.**

---

## How to add a new item

Append under the right column with a one-line description, a status
sub-bullet, and a source. If the item is `blocked`, name the
unblock. If `parked`, explain why a prior claim couldn't be
verified.

Don't delete items from `shipped` — even if the feature is later
deprecated, the historical record matters for "what was true when"
debugging.