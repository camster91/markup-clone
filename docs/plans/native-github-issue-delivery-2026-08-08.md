# Native GitHub issue delivery — implementation plan

**Date:** 2026-08-08
**Status:** Completed and verified locally
**Release boundary:** Local implementation and verification only. Connecting a real repository or deploying remains approval-gated.

## Outcome

Let an agency owner connect one explicit GitHub repository to a project so every
new feedback event becomes a durable, developer-ready GitHub issue without
copying text, leaking credentials, or creating routine duplicates during retry.
The adapter reuses `visual-feedback.issue.v1` and the verified Postgres delivery
worker rather than creating a second notification path.

## Product contract

1. `github` becomes a first-class integration kind with an explicit repository
   owner, repository name, optional bounded labels, and a credential supplied by
   an owner/operator.
2. The credential is encrypted with AES-256-GCM under a dedicated server key
   before it reaches the database. API responses, logs, audit records, delivery
   events, browser markup, and errors never contain plaintext or ciphertext.
3. Creation fails closed when credential encryption is unavailable. Existing
   Slack, Discord, and signed webhook targets remain usable without that key.
4. The Test action verifies repository access and issue availability with a
   read-only repository request; it never creates a test issue.
5. Real delivery creates an issue from the deterministic developer handoff,
   including title, Markdown body, labels, exact review URL, technical context,
   and a hidden stable event marker.
6. Before creation, retries inspect recent repository issues for the event
   marker. An existing match is treated as success and its number/URL are
   retained, which recovers the common “GitHub accepted the issue but the
   response was lost” case.
7. Successful deliveries retain only the external issue number and validated
   `github.com` URL. Owners can open the issue from delivery activity; reviewers
   and public-share visitors cannot see repository configuration or delivery
   records.
8. GitHub timeouts, rate limits, and 5xx responses use the existing bounded
   retry schedule. Authentication, repository, issue-disabled, and validation
   failures become safe actionable dead letters.

## Data and configuration

- Add nullable `Integration.credentialCiphertext` for encrypted external
  credentials. Existing rows remain valid.
- Add nullable bounded `IntegrationDelivery.externalId` and `externalUrl` for
  successful external references.
- `github` stored config contains only `{ owner, repo, labels }`; plaintext
  tokens exist only in the request and in-memory delivery attempt.
- `INTEGRATION_ENCRYPTION_KEY` is a 32-byte base64url value. Local Docker gets a
  development-only value; production must supply its own secret.

## GitHub REST contract

- API base is fixed to `https://api.github.com`; operators cannot supply a host.
- Requests use `Accept: application/vnd.github+json`, a fixed User-Agent, and
  the documented REST API version.
- Repository verification uses `GET /repos/{owner}/{repo}`.
- Dedupe inspection uses the newest issues from
  `GET /repos/{owner}/{repo}/issues?state=all&sort=created&direction=desc&per_page=100`.
- Creation uses `POST /repos/{owner}/{repo}/issues` with title, body, and labels.
- Fine-grained tokens need Metadata read plus Issues write for the selected
  repository. GitHub Apps and classic tokens remain compatible when they expose
  the same endpoint permissions.

## Test-first sequence

1. Add failing crypto tests for authenticated encryption, wrong-key/tamper
   rejection, key validation, and non-deterministic ciphertext.
2. Add failing validation/DTO tests for GitHub config, bounded labels, and
   credential redaction; implement the new kind and safe create/list behavior.
3. Add failing adapter tests for repository verification, canonical Markdown,
   stable marker dedupe, create response parsing, timeouts, rate limits, and
   token-free errors; implement the GitHub client without a new dependency.
4. Add failing queue/store/schema tests for credential loading and external
   reference persistence; implement the additive migration and worker changes.
5. Add failing route/component tests for owner creation, repository display,
   password input, safe Test behavior, external issue links, and reviewer denial;
   implement the dashboard experience.
6. Run full automated gates, Prisma validation, production/Docker build, fresh
   migration rehearsal, mocked GitHub adapter/worker proof, and authenticated
   owner/reviewer desktop/mobile/keyboard browser QA.

## Non-goals

- OAuth or a GitHub App installation flow; this slice accepts a repository-
  scoped credential and keeps the data model ready for a later provider account.
- Creating pull requests or generating code fixes.
- Synchronizing GitHub issue state back into feedback pins.
- Connecting production or using a real GitHub credential during local QA.

## Completion evidence required

- Every behavior above has a recorded RED test before implementation.
- Migration preserves all pre-existing integration and delivery rows.
- Automated tests prove credentials never cross any read/error/event boundary.
- Mocked GitHub transport tests prove verify, create, dedupe, retry, response
  validation, credential redaction, and external-reference behavior without
  weakening the production adapter's fixed `api.github.com` boundary.
- Browser QA proves owner usability and reviewer redaction at desktop, 375px,
  and 320px widths with keyboard operation and no console/request failures.
- Production remains untouched until explicit approval.

## Verification evidence

- All test-first behavior was observed failing before implementation, including
  crypto tamper handling, credential-free DTOs, API validation, dedupe, queue
  decryption, external reference persistence, and owner UI behavior.
- The complete suite passes with 667 tests and 3 intentional skips. ESLint,
  TypeScript, Prisma generation, the Next.js production build, and
  `git diff --check` pass; only the pre-existing Vite public-directory and
  Turbopack dynamic-media tracing warnings remain.
- A fresh PostgreSQL volume applied all 19 migrations through
  `20260808063000_add_native_github_delivery`. The production container became
  healthy; the worker rejected an unauthenticated request with 401 and accepted
  its configured secret with an empty successful batch.
- Authenticated browser QA covered owner creation, token clearing, least-
  privilege guidance, safe issue links, keyboard order, and reviewer redaction
  at 1280px, 375px, and 320px. It recorded zero overflow, console errors,
  failed requests, or GitHub API requests.
- Visual inspection found and fixed unreadable mobile repository truncation by
  stacking row actions and wrapping only non-secret destinations.
- No real repository was connected, no GitHub issue was created, and production
  was not changed.
