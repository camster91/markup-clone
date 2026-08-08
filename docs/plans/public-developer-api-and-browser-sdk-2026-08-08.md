# Public developer API and browser SDK — 2026-08-08

**Status:** complete locally; production and npm untouched
**Parent:** `docs/plans/markup-parity-and-agency-advantage-2026-08-07.md` slice 10
**Production:** untouched; token issuance and deployment remain approval-gated

## Outcome

Give agencies a documented, versioned integration boundary without declaring the
existing dashboard routes or the public website widget key to be a general API.

The release has two deliberately separate credentials and surfaces:

- the existing browser-visible project key may only submit website feedback;
- new hash-only developer tokens may read structured issues through `/api/v1`.

This avoids the critical mistake of letting any visitor who can inspect a client
site's widget key read the project's feedback or internal developer context.

## Public API v1

1. Add `ProjectApiToken` with project relation, display name, SHA-256 token hash,
   non-secret prefix/last-four display fields, closed `issues:read` scope, optional
   expiry, revocation, creator identity, and timestamps. Persist no plaintext token.
2. Add owner/contributor/operator dashboard endpoints to create, list, and revoke
   tokens. Plaintext is returned once on creation; list/audit/errors never include it.
3. Add bearer-token authentication independent of dashboard Origin/session and the
   browser widget key. Apply bounded rate limiting and constant-time hash comparison
   through an indexed token-hash lookup.
4. Add `GET /api/v1/projects/[id]/issues` with stable cursor pagination, status,
   priority, tag, assignee, and review-round filters. Return the existing deterministic
   `visual-feedback.issue.v1` handoff payload inside a versioned response envelope.
5. Return explicit machine-readable errors and security headers. Do not enable broad
   browser CORS; v1 is a server-to-server API.
6. Add a checked-in OpenAPI 3.1 document and developer guide covering authentication,
   pagination, scopes, error codes, rotation/revocation, and examples.

## Browser SDK 1.0

1. Add a publishable (but not automatically published) `@ashbi/markup-sdk` package
   with TypeScript declarations and no runtime dependencies.
2. Provide a typed loader with `mount`, `startFeedback`, `stopFeedback`, `destroy`,
   `getState`, and `on/off` lifecycle events. Validate HTTPS hosts outside localhost,
   project identifiers, and key shape before loading.
3. Formalize the existing IIFE's supported global methods and emit stable
   `ready`, `modechange`, `submitted`, and `error` events. Preserve script-tag
   auto-boot compatibility.
4. Document script-tag and package usage, CSP directives, self-hosted asset behavior,
   teardown for SPAs, and the boundary between the browser key and developer token.

## Dashboard experience

- Add a compact owner/contributor developer-access panel on the site detail page.
- Token creation requires a name and optional expiry. The secret is shown once with
  clear copy/revoke guidance.
- Client/guest/public views receive no token metadata or controls.

## Verification

- Strict RED/GREEN tests for schema/migration, token validation/auth, scope/expiry/
  revocation, bounded pagination/filtering, secret redaction, SDK loader/lifecycle,
  event delivery, CSP documentation, and role-safe UI.
- Full Vitest, TypeScript, lint, Prisma validate, package builds, Next production
  build, Docker production build, fresh migration, and legacy-data rehearsal.
- Authenticated browser QA for token create/copy-once/revoke, client redaction, SDK
  mount/start/stop/destroy, desktop/mobile layout, and zero console/network errors.

## Out of scope

- Write/update APIs, OAuth apps, workspace-wide tokens, user impersonation, or CORS.
- Publishing to npm, issuing a real production token, or changing production.
- Compatibility promises beyond v1 and SDK 1.x without a future deprecation policy.

## Completion evidence

- Hash-only `mkv1_` developer tokens, owner/contributor management, expiry,
  revocation, audit events, bounded authentication, and safe one-time display.
- Versioned read-only issue API, project-owned cursor pagination and filters,
  machine-readable errors, security headers, OpenAPI 3.1, and developer guide.
- Dependency-free typed SDK plus an explicit widget global lifecycle with stable
  ready/mode/submitted/error events and SPA cleanup.
- Clean production-style Docker install applied all 23 migrations; a separate
  upgrade rehearsal preserved existing user/workspace/team/project rows and
  proved both new foreign keys.
- Authenticated Chromium QA passed token create/dismiss/revoke, client redaction,
  v1 API access, SDK lifecycle/events/cleanup, and 1280/375/320px layouts with
  zero console or request failures. Visual review corrected the mobile token row.
- Final repository gates: Prisma schema valid, 105 test files with 765 passing
  tests and 3 intentional skips, lint, TypeScript, package builds, Next production
  build, and production container health. Existing file-tracing/build warnings
  remain documented release work rather than new failures.
