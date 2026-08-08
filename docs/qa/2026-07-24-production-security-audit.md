# Production Security & Reliability Audit — markup-clone

**Date:** 2026-07-24  
**Branch:** `cursor/production-security-audit-4eb8`  
**Auditor role:** Senior Security Engineer + Lead Developer  
**Scope:** Full app (`src/`, `packages/markup-core/`, API routes, dashboard client, integrations)  
**Gates:** `npm test` → **441/441 passing**; Critical + High items patched in this cycle.

This supersedes gaps called out in `docs/qa/production-grade-assessment.md` (2026-06-12) where they overlap. Medium items remain open unless noted.

---

## Executive verdict

Before this patch set, dashboard APIs treated a forgeable `Origin` / `Sec-Fetch-Site` header as authentication. That was a **full API takeover** on the public host (list projects, exfiltrate `apiKey` / `shareToken` / webhook URLs, delete data, spawn Chromium). Critical and High findings below are **fixed on this branch**. Remaining Medium items are documented for the next hardening pass.

---

## Critical (patched)

| ID | Finding | Fix |
|---|---|---|
| C1 | **Forgeable Origin = dashboard auth.** Almost every privileged route used only `requireDashboardOrigin`. Any HTTP client could set `Origin: https://<DASHBOARD_HOST>` (or bare `Sec-Fetch-Site: same-origin`) and take over the API, including plaintext `apiKey` / `shareToken`. | Added `requireDashboardAuth` (Origin **+** session). Wired across dashboard routes. Hardened `isDashboardOrigin` so a wrong Origin no longer falls through to `sec-fetch-site`; bare `sec-fetch-site` also requires matching `Host`. `requireProjectKey` no longer skips the API key on Origin alone — needs a session **or** a valid key. |
| C2 | **Webhook SSRF.** Integration URL validation only checked `http(s)://`. Server `fetch` could hit IMDS / RFC1918 / loopback; redirects followed by default. | `src/lib/safe-url.ts`: https-only shape checks + DNS resolve + private-IP deny. Validators + webhook/slack/discord adapters call it; `redirect: 'error'`. |
| C3 | **Delta poll wiped the home list.** `DashboardPoller` did `setProjects(data)` on `?since=` responses; a quiet window returned `[]` and blanked the UI. | Merge/upsert by project `id`; empty delta leaves state unchanged. |
| C4 | **Rate-limit Map never cleaned.** Routes call `consume()` directly; cleanup only started inside unused `createRateLimiter()`. | `ensureCleanup()` runs at the start of every `consume()`. |

---

## High (patched)

| ID | Finding | Fix |
|---|---|---|
| H1 | Cross-tenant IDOR: most project-scoped routes lacked `assertProjectAccessible`. | Helper exported from `src/lib/teams.ts`; applied to subscribers, share, integrations, pins, comments, etc. |
| H2 | Integrations GET returned live webhook secrets in `configJson`. | List responses redact URL path/token segments and header values. |
| H3 | Workspace / team admin was Origin-only. | `requireDashboardAuth` (+ CSRF on writes) on all `/api/workspaces/**`. |
| H4 | Screenshot `/image` + `/history` were UUID-only (no auth). | Require dashboard Origin **or** matching `?share=` project token; `validateScreenshotId` on image route. |
| H5 | Attachments accepted `image/svg+xml` → stored XSS on app origin. | Allowlist `png|jpeg|gif|webp` only; explicit SVG reject. |
| H6 | `validateProjectDomain` bypasses (hex/octal IPs, embedded quads / nip.io). | Reject hex/octal dotted forms and hostnames that embed a dotted-quad. |
| H7 | Login returned plaintext `sessionToken` in JSON (XSS-readable despite HttpOnly cookie). | Cookie-only session; body is `{ user }` only. Login rate-limited; CSRF cookie issued on success. |
| H8 | Planned CSRF (R1.2) was missing (`csrf-constants` existed; no `csrf.ts`, routes unchecked). | Implemented double-submit CSRF; wired on dashboard writes; `dashboardHeaders()` sends the header. |
| H9 | Presence GET `?since=` replaced the online list (missed heartbeats dropped users). | Full TTL list fetch (no delta replace). |
| H10 | Client `useRecaptureStatus` imported Prisma-backed `audit()` (broken + wrong layer). | Removed client audit calls; server recapture route remains source of truth. |
| H11 | `NewProjectForm` lacked try/catch (offline left loading stuck). | try/catch/finally + visible error. |
| H12 | Home RSC / share page could serialize `apiKey` for anonymous / share viewers. | Home omits keys when unauthenticated; share `select` excludes `apiKey`. |
| H13 | Comment `author` / `authorRole` unsanitized. | `sanitizeText` + role allowlist. |
| H14 | Presence POST trusted client `userId`. | Identity taken from session. |

---

## Medium (documented, not all patched this cycle)

| ID | Finding | Suggested fix |
|---|---|---|
| M1 | Home/list still loads full nested trees (`elementHTML` ≤50KB/pin) for cards that only need counts. | List endpoint with `_count` / aggregate selects; detail keeps deep include. |
| M2 | SSE + presence fan-out: one EventSource / heartbeat per `ScreenshotView` and per home card. | Project-level single stream; pass events down. |
| M3 | Attachment claim IDOR on comment create (connect any existing attachment id). | Only bind orphans (`commentId IS NULL`) owned by same project. |
| M4 | Share token in query string (`?share=`) leaks via Referer / history. | Prefer cookie or short-lived signed URLs; `Referrer-Policy: no-referrer` on share. |
| M5 | Team / `ROLES` stored but not enforced on destructive ops. | Gate delete/rotate/integrations to `owner` / `operator`. |
| M6 | Some dashboard mutations still lack user-visible offline banners (polls stay silent). | `pollError` after N failures. |
| M7 | Integration `lastError` can store up to 200 chars of upstream body. | Store status codes only; raw detail in server logs. |
| M8 | Pin screenshot MIME/magic not fully enforced (size capped only). | Require PNG signature / `image/png`. |
| M9 | Share-token compare not constant-time (attachments). | `timingSafeEqual` like API keys. |
| M10 | `/api/audit` is global (now session-gated) but not role-scoped. | Restrict to `operator`; filter by team. |

---

## Patched code map (this branch)

| Area | Paths |
|---|---|
| Auth / CSRF | `packages/markup-core/src/auth.ts`, `src/lib/auth.ts`, `src/lib/csrf.ts`, `src/lib/client-origin.ts` |
| SSRF | `src/lib/safe-url.ts`, `src/lib/integrations/{validate,webhook,slack,discord}.ts` |
| Domain / rate-limit | `packages/markup-core/src/validation.ts`, `packages/markup-core/src/rate-limit.ts` |
| API gates | `src/app/api/projects/**`, `pins/**`, `workspaces/**`, `attachments`, `annotations`, `audit`, `presence`, `events`, `screenshots/**` |
| Client | `DashboardPoller.tsx`, `usePresence.ts`, `useRecaptureStatus.ts`, `NewProjectForm.tsx`, `page.tsx`, `share/[token]/page.tsx` |
| Login | `src/app/api/auth/login/route.ts` |

---

## Verification

```bash
npm test   # 441/441
npm run lint
```

---

## 2026-08-08 managed-share follow-up

- **M4 closed locally:** generated links enter through `/share/<token>/open`, then
  use a token-bound HttpOnly cookie. Shared media rejects query-only tokens, the
  public route emits `Referrer-Policy: no-referrer`, and client media URLs contain
  no share credential.
- **M9 closed locally:** share-cookie verification uses constant-time comparison;
  media authorization is also bound to expiry and password-hash state so rotation,
  password replacement, expiry, or revocation invalidates prior access.
- Shared image/attachment responses use private caching with `Vary: Cookie`, while
  history uses private no-store, preventing authenticated responses from entering a
  shared proxy cache.
- **M2 closed locally:** the overview no longer heartbeats into every visible
  project. A focused project owns one presence heartbeat/list poll and one SSE
  stream regardless of screenshot count; authenticated browser QA measured the
  transport counts over a full cadence.
- **M1 closed locally:** the home RSC and `/api/projects` now select only scoped
  project-card scalars, then use one parameterized aggregate over the authorized
  project IDs for page, screenshot, total-pin, and open-pin counts. No nested
  page/screenshot/pin trees are hydrated for the overview.

## Residual risk / deploy notes

1. **Session is now mandatory for dashboard APIs.** Operators must log in before poller / mutations work. Ensure at least one `User` row exists in each environment before deploy.
2. **CSRF cookie** is issued on login; client fetches must use `dashboardHeaders()` (now includes `X-CSRF-Token`).
3. **Webhook https-only** may break operators who pointed integrations at plain `http://` receivers — they must move to HTTPS.
4. Medium items M1 and M2 are closed locally. Horizontal realtime fan-out still
   needs shared pub/sub before more than one application replica is introduced.
