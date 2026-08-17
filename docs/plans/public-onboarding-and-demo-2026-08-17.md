# Public onboarding and demo — 2026-08-17

## Status

Complete locally and approved for release after a logged-out production dogfood review found that
the product opened on a credential-only sign-in screen with no way for an agency
to evaluate the workflow.

## Outcome

Give prospective web developers and agencies enough public product context to
understand the review workflow, explore it without writing data, and request
access. Preserve the requested protected destination when an existing user
signs in.

## Scope

- Replace the anonymous dashboard shell with a responsive public landing page.
- Add a static, non-mutating demo of pins, threads, status, review rounds, and
  developer context.
- Link the access request to Ashbi's verified public contact page.
- Carry safe internal return paths through the sign-in flow.
- Explain why authentication is required when a protected route redirects.
- Add focused integration/component coverage and responsive browser QA.

## Boundaries

- No self-serve account creation, billing, production data, or demo mutations.
- No AI, MCP, GitHub, repository, or provider integration work.
- No authentication model or database schema change.
- Existing authenticated dashboard behavior and secret redaction must remain
  unchanged.

## Verification

- Anonymous `/` contains product proof, demo, request-access, privacy/support,
  and sign-in paths without querying projects.
- `/demo` is fully usable without a session and performs no API writes.
- Anonymous protected routes redirect with a safe return path; successful login
  navigates only to a validated same-origin path.
- Focused tests, full lint/type/build gates, and 1280px/375px browser QA pass.

## Evidence

- 935 tests passed with three intentional skips across 135 passing suites; the
  previously calendar-bound password-gate fixture now uses a stable future date.
- Next.js production build, TypeScript, ESLint, and `git diff --check` pass.
- Desktop and 375px browser QA found no horizontal overflow or console errors.
- All three 44px demo pins change the visible read-only thread and trigger no
  `/api/` requests.
- `/?next=%2Fworkspaces#sign-in` displays the access explanation and passes the
  validated internal destination to the sign-in form.
