# Reliable integration delivery — implementation plan

**Date:** 2026-08-08
**Status:** Completed locally
**Release boundary:** Local implementation and verification only. Production deployment remains approval-gated.

## Outcome

Replace fire-and-forget outbound notifications with a durable, signed, retryable,
and owner-observable delivery system. This is the foundation for GitHub issue
delivery and other agency/developer automation without weakening the existing
Slack, Discord, and generic-webhook security boundaries.

## Product contract

1. Every outbound notification is represented by an immutable
   `visual-feedback.event.v1` envelope with a stable event id, event type,
   occurrence time, project identity, and privacy-bounded data.
2. Pin creation and event enqueue happen in the same database transaction. A
   committed pin cannot silently lose its integration work.
3. Each configured integration receives its own durable delivery row and an
   immutable attempt history.
4. Generic webhooks receive an HMAC-SHA256 signature over the exact request
   body and timestamp. The signing secret is generated server-side, revealed
   once when the integration is created, and redacted from every later read.
5. Network failures, timeouts, rate limits, and retryable receiver responses use
   bounded exponential backoff. Permanent failures and exhausted attempts move
   to a dead-letter state instead of retrying forever.
6. Delivery claims are concurrency-safe and stale claims can be recovered, so
   an immediate worker and the scheduled worker cannot double-send normally.
7. Project administrators can see delivery status and safe error summaries and
   manually retry a dead delivery. Reviewers and public-share visitors cannot
   read integration configuration, secrets, payloads, or delivery logs.
8. Existing Slack and Discord integrations continue to render useful messages;
   generic webhook receivers get the versioned event envelope.

## Data and state model

- `IntegrationEvent`: immutable logical event and serialized v1 payload.
- `IntegrationDelivery`: one event/target pair with a closed state set:
  `PENDING`, `PROCESSING`, `RETRY_SCHEDULED`, `SUCCEEDED`, `DEAD_LETTER`.
- `IntegrationDeliveryAttempt`: append-only result for each bounded attempt.
- `Integration.signingSecret`: nullable for existing and non-generic targets;
  generated for generic webhooks only.
- Database constraints enforce state values, bounded attempt counters, and the
  unique event/target pair. The migration is additive and preserves all current
  integrations.

## Retry and worker contract

- Maximum five delivery attempts.
- Exponential schedule: approximately 1 minute, 5 minutes, 30 minutes, then
  2 hours, while honoring a reasonable receiver `Retry-After` value.
- Retry network/timeout failures and HTTP 408, 409, 425, 429, and 5xx.
- Treat other 4xx responses as permanent failures.
- Apply a bounded outbound request timeout and keep redirect rejection and SSRF
  validation immediately before every fetch.
- A protected internal processor route claims a bounded batch. The VPS cron
  invokes it every minute using a dedicated secret available inside the app
  container; local Docker receives a non-production development value.

## Security and privacy boundaries

- Signing and worker secrets never appear in list APIs, logs, attempt errors,
  audit payloads, or event payloads.
- Operator-defined headers cannot override the system signature, event,
  delivery, timestamp, or content-type headers.
- Event data reuses the existing bounded developer-context and issue DTO rules;
  it excludes project keys, share/session tokens, query strings, raw headers,
  and unbounded receiver bodies.
- Worker authentication uses constant-time comparison and fails closed when the
  server secret is absent.
- Error strings stored or returned to the UI are normalized and length-bounded.

## Implementation sequence (test first)

1. Add failing schema/migration contract tests, then the additive Prisma models
   and constraints.
2. Add failing unit tests for the v1 envelope, signature vectors, protected
   headers, retry classification, and backoff; implement pure helpers.
3. Add failing adapter tests, then teach generic webhooks to send signed exact
   envelopes and Slack/Discord to consume the event projection.
4. Add failing queue/worker tests for atomic enqueue, safe claiming, success,
   retry, dead-letter, stale-lock recovery, and immutable attempts; implement
   the delivery service.
5. Change pin creation from direct dispatch to transactional enqueue under an
   integration regression test.
6. Add the authenticated internal processor route and owner-only delivery-log
   and manual-retry routes under route tests.
7. Add one-time-secret and delivery-activity UI under component tests.
8. Wire the scheduled worker into deployment scripts, local Docker, environment
   documentation, and README under deployment contract tests.
9. Run targeted and full tests, lint, Prisma validation, migration preservation,
   production build, local Docker, and authenticated owner/reviewer responsive
   browser QA. Remove disposable containers and data afterward.

## Non-goals for this slice

- GitHub issue creation itself; it is the next delivery adapter after this
  foundation is verified.
- Kafka, Redis, or another queue broker; PostgreSQL is sufficient for the
  current single-deployment architecture.
- Multi-region active-active delivery.
- Production deployment or changing live integration configuration.

## Completion evidence

- Every changed behavior was driven by a recorded failing regression test.
- Full Vitest passed: 76 files passed, 1 skipped; 640 tests passed, 3 skipped.
- TypeScript, ESLint, Prisma generation/validation, production build, and Docker
  image build all passed locally.
- A fresh local PostgreSQL volume applied all 18 migrations, including the
  delivery migration and its state, counter, error-length, and FK constraints.
- The protected worker returned 401 without credentials and 200 with the local
  secret. A real queued invalid target was claimed, safely dead-lettered,
  unlocked, and recorded as an immutable attempt.
- Authenticated browser QA proved owner activity/retry, the one-time signing
  secret, reviewer redaction, zero console/request failures, and zero horizontal
  overflow at 1280, 375, and 320 px widths.
- Production remained untouched; deployment still requires explicit approval.
