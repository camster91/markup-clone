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

**All Critical, High, and Medium items below are patched on this branch.**
Accepted residual risks are called out under Medium (M9).

---

## Critical — fixed

| ID | Issue | Fix |
|----|--------|-----|
| C1 | **Forgeable Origin = full dashboard API access** (no session) | `requireDashboardSession()` = Origin + `requireAuth()`. |
| C2 | **`requireProjectKey` Origin bypass** | Origin bypass requires a live session; otherwise X-Api-Key. |
| C3 | **Login returned `sessionToken` in JSON** | Body is `{ user }` only; token only in Set-Cookie. |
| C4 | **SSR `/` leaked `apiKey` / project tree to anonymous users** | `page.tsx` skips the project query when no session. |

## High — fixed

| ID | Issue | Fix |
|----|--------|-----|
| H1 | Unauthenticated screenshot image + no UUID validation | `validateScreenshotId`; Origin **or** `?share=`; private cache. |
| H2 | Integration webhook SSRF (hostname literals) | `assertSafeOutboundUrl()` at registration. |
| H3 | Project-scoped writes without team membership | `assertProjectAccessible()` on project mutations. |
| H4 | SVG attachment → stored XSS | Reject SVG on upload; CSP + disposition on GET. |
| H5 | No login rate limit | Per-email + per-IP buckets. |
| H6 | Project list included `elementHTML` | Omitted from list payloads. |
| H7 | Poll loops / forms without abort or try/finally | AbortController + try/finally. |
| H8 | Comment `author` / `authorRole` unsanitized | `sanitizeText` + role allowlist. |

## Medium — fixed

| ID | Issue | Fix |
|----|--------|-----|
| M1 | DNS rebinding on webhook fetch | `safeOutboundFetch()` resolves DNS and rejects private/loopback addresses before `fetch`. |
| M2 | Unpaginated deep project trees on home poll | `?view=summary` (pins as `{id,status}` only); detail uses `?id=<uuid>` single-project full tree. |
| M3 | Triple SSE EventSource per project detail | `LiveEventsProvider` — one EventSource; children use `useProjectLiveEvents`. |
| M4 | AuthGate treated network failure as logout | New `'offline'` state + Retry (not LoginForm). |
| M5 | Rate-limit gaps on dashboard writes | `consume()` on projects/share/subscribers/integrations/pins/attachments/annotations/workspaces/teams/members/presence writes. |
| M6 | Missing `audit()` on pin status / attachment create | `pin.update` + `attachment.create` audit actions. |
| M7 | Integration GET returned raw webhook URLs | `redactConfigJson()` masks URLs/headers in list responses. |
| M8 | `Sec-Fetch-Site` alone on mutating methods | POST/PATCH/PUT/DELETE require matching `Origin`; GET/HEAD keep Sec-Fetch-Site fallback for `<img>`/SSE. |
| M10 | Spoofable `x-forwarded-for` rate-limit keys | `getClientIp()` prefers `X-Real-IP`, else rightmost XFF hop (Caddy-trusted). |

### Accepted residual (M9)

| ID | Issue | Why accepted |
|----|--------|--------------|
| M9 | Screenshot `<img>` uses Origin / share-token, not session | Browser subresource loads cannot send session-gated custom headers; UUID secrecy + share token + private Cache-Control bound the risk. |

**Residual TOCTOU on M1:** DNS is checked then `fetch` may re-resolve; closing that fully needs IP-pinned TLS (breaks Slack/Discord certs). Validate-time + resolve-time checks cover practical rebinding.

---

## Verification

```bash
npm test   # 486+/486+
npm run lint
```

Integration tests mock `next/headers` cookies + `prisma.session.findUnique`
(see `tests/helpers/dashboard-auth.ts`).
