# Managed public review links — 2026-08-08

**Status:** complete locally; production untouched
**Parent:** `docs/plans/markup-parity-and-agency-advantage-2026-08-07.md` sharing capability
**Release boundary:** migration, Git, npm, and production remain approval-gated

## Outcome

Give agencies a deliberate client-sharing surface instead of a permanent bearer
URL: an administrator may set an expiry and optional password, rotate or revoke
the link, and know that screenshot and attachment requests do not repeat the
share token in query strings.

## Security contract

- Share creation remains owner/operator-only, session-authenticated, CSRF
  protected, audited, and token-rotating.
- Expiry is optional, future-only, and bounded to 365 days. Expired links are
  indistinguishable from missing or revoked links.
- Passwords are optional, 8–128 characters, hashed with the existing scrypt
  helper, never returned, selected into a client DTO, or written to audit data.
- Opening a valid link establishes an HttpOnly, SameSite=Strict, Secure-in-
  production cookie bound to that exact share token and password hash. Rotation,
  password replacement, expiry, or revocation invalidates it automatically.
- Password attempts are rate-limited by client IP and token fingerprint and use
  the same response for incorrect passwords.
- Public media and history routes require the token-bound cookie. They no longer
  accept `?share=` as sufficient authorization, and comparisons are constant-time.
- The public review route emits `Referrer-Policy: no-referrer` through Next
  metadata and never serializes the share token or password hash to client code.

## User experience

- The share control offers optional expiry and password fields before creating
  or rotating a link.
- The active state clearly identifies password protection and the expiry date.
- A protected review shows a branded, keyboard-usable password form with
  specific expired/missing links kept behind the same not-found response.
- Existing `/share/<token>` bookmarks bootstrap through the cookie-opening route;
  newly generated URLs use that route directly.

## Verification

- RED/GREEN unit and integration coverage for validation, hashing/redaction,
  expiry, rotation/revocation, password unlock, rate limiting, cookie binding,
  media denial, metadata, and responsive UI states.
- Prisma validation, migration contract/clean database application, full Vitest,
  lint, warning-free production builds, and dependency audit.
- Desktop/mobile/keyboard browser QA for unprotected, protected, wrong-password,
  unlocked, expired, rotated, and revoked journeys with no unexpected console or
  request errors.

## Completion evidence

- Added additive migration 25 and applied the complete 25-migration chain to a
  fresh disposable PostgreSQL database; the database was removed after the drill.
- Current final-tree Vitest passed 848 tests with 3 intentional skips. Prisma validation,
  ESLint, the widget/package/Next production build, and the production dependency
  audit passed; the audit found zero vulnerabilities.
- Authenticated Chromium verified creation, optional expiry/password protection,
  wrong-password handling, unlock, token-bound HttpOnly/SameSite=Strict cookies,
  rotation, revocation, responsive 1280/320/375px layouts, keyboard focus, branded
  client review, and zero console or unexpected request errors.
- Public media is cookie-gated with private/no-store cache policy and `Vary:
  Cookie`; query-only share tokens are rejected. Password hashes, share tokens,
  and agency-only data remain outside client DTOs and URLs.
