# Production Security & Performance Audit — 2026-07-24

**Commit baseline:** `9f82cd1` (pre-fix branch)  
**Branch:** `cursor/production-security-audit-3b24`  
**Scope:** Full `src/app/api/**`, `src/lib/**`, `src/components/**`, share/SSR pages.

This supersedes the gap list in `docs/qa/production-grade-assessment.md`
(§1–2 rate limits have since landed; Origin-only auth had not).

---

## Executive summary

The dashboard’s primary gate was `requireDashboardOrigin` — a forgeable
`Origin` / `Sec-Fetch-Site` header check with **no session**. Combined with
`requireProjectKey` short-circuiting on the same Origin check, any HTTP
client could list projects (including live `apiKey` / `shareToken`), mutate
legacy projects, register SSRF webhooks, and spawn Chromium recaptures.

Critical and High items below are patched on this branch. Medium items are
documented for follow-up.

---

## Critical

| ID | Issue | Fix |
|----|--------|-----|
| C1 | **Forgeable Origin = full dashboard API access** (no session) | New `requireDashboardSession()` = Origin + `requireAuth()`. Applied to all dashboard API routes. |
| C2 | **`requireProjectKey` Origin bypass** skipped API key with forged Origin | Origin bypass now requires a live session; otherwise X-Api-Key is mandatory. |
| C3 | **Login returned `sessionToken` in JSON** (defeats HttpOnly) | Body is `{ user }` only; token only in Set-Cookie. |
| C4 | **SSR `/` leaked `apiKey` / project tree to anonymous users** | `page.tsx` skips the project query when `getCallerUser()` is null. |

## High

| ID | Issue | Fix |
|----|--------|-----|
| H1 | Unauthenticated `/api/screenshots/[id]/image` + no UUID validation | `validateScreenshotId`; auth = dashboard Origin **or** `?share=` matching project token; `Cache-Control: private`. |
| H2 | Integration webhook SSRF (RFC1918 / link-local / localhost) | `assertSafeOutboundUrl()` in `src/lib/ssrf.ts`, wired into Slack/Discord/webhook validators. |
| H3 | Project-scoped writes without team membership checks | Shared `assertProjectAccessible()` on subscribers / share / integrations (+ existing DELETE/PATCH). |
| H4 | SVG attachment → stored XSS when opened as document | Reject `image/svg+xml` on upload (415); CSP + `Content-Disposition: attachment` defense on GET. |
| H5 | No login rate limit (credential stuffing) | Per-email + per-IP token buckets on `POST /api/auth/login`. |
| H6 | Unpaginated project tree included `elementHTML` (≤50KB/pin) | Omit `elementHTML` from `/api/projects` + home SSR serialization. |
| H7 | Poll loops without AbortController / form fetches without try/finally | `DashboardPoller`, `useRecaptureStatus`, `NewProjectForm` patched. |
| H8 | Comment `author` / `authorRole` unsanitized | `sanitizeText` + closed role allowlist on comment create. |

## Medium (deferred)

| ID | Issue | Notes |
|----|--------|-------|
| M1 | DNS rebinding on webhook fetch (hostname → private IP at resolve time) | Needs undici/custom dispatcher; validate-time host block is partial. |
| M2 | Unpaginated full project `findMany` (structure still deep) | Dropped heavy `elementHTML`; true pagination / per-project detail fetch still needed. |
| M3 | Triple SSE EventSource per project detail | Collapse to one subscription. |
| M4 | Silent poll catch → no offline UX (partially mitigated) | Poller now surfaces offline banner; AuthGate still maps network fail → login. |
| M5 | Rate-limit gaps on CRUD / workspaces / attachments | Login + existing pin/comment/recapture limits only. |
| M6 | Missing `audit()` on pin status / attachment create | Compliance gap. |
| M7 | Integration GET returns raw webhook URLs in `configJson` | Redact secrets in list responses. |
| M8 | `Sec-Fetch-Site: same-origin` alone still satisfies Origin check | Acceptable **with** session cookie (SameSite=Strict); do not re-open Origin-only routes. |
| M9 | Screenshot image still Origin-only (not session) for `<img>` | Required for browser subresource loads; UUID + share token bound the risk. |
| M10 | `x-forwarded-for` spoofable rate-limit keys | Trust proxy hop only behind known Caddy. |

---

## Error handling notes

- API route `catch` blocks generally return generic 500 strings (good).
- Integration `lastError` may still store upstream webhook body snippets (intentional ops signal; treat as Medium if exposed broadly).
- No `dangerouslySetInnerHTML` in React surfaces.

## Performance notes

- `public/` has no large media assets.
- Residual cost: 5s full-tree poll + presence + SSE; see M2/M3.

---

## Verification

```bash
npm test
npm run lint
```

Integration tests must mock `next/headers` cookies + `prisma.session.findUnique`
(see `tests/helpers/dashboard-auth.ts`).
