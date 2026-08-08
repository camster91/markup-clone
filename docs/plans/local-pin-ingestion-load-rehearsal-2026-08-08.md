# Local pin-ingestion load rehearsal — 2026-08-08

**Status:** complete locally; production untouched
**Parent:** `docs/plans/agency-product-release-2026-08-07.md` release evidence

## Outcome

Replace the historical “no load test” readiness gap with a reproducible,
bounded rehearsal of the real multipart widget ingestion path. The harness must
measure latency and response status under concurrency, fail closed outside a
loopback target, and remove every database row and screenshot it creates.

## Scope

1. Add tested helpers for loopback target enforcement, bounded concurrency,
   percentile summaries, and threshold evaluation.
2. Add a dedicated local fixture seed/cleanup command that refuses any database
   except the disposable Compose database.
3. Exercise authenticated `POST /api/pins` requests with real multipart PNG
   uploads against the production-mode local container.
4. Report request count, concurrency, throughput, p50/p95/p99, status counts,
   and threshold failures in machine-readable JSON plus a concise console summary.
5. Prove cleanup by checking that the fixture project, related rows, and final
   screenshots are removed.

## Safety boundaries

- The runner accepts only `localhost`, `127.0.0.1`, or `[::1]` targets.
- The fixture command verifies the exact local Compose database host/name and
  local dashboard host before any write.
- Production, staging, Git, npm publication, and deployment remain untouched.
- The rehearsal stays below the route's intentional 30-token burst limit; rate
  limiting is already covered separately by deterministic tests.

## Verification

- Strict RED/GREEN unit tests for every reusable harness behavior.
- Targeted harness tests, full Vitest, and warning-free ESLint.
- Successful run against the healthy local production-mode Linux container.
- Direct database and screenshot-volume cleanup verification after the run.

## Completion evidence

- Strict RED/GREEN cycles produced 27 passing harness/fixture tests. The full
  final-tree suite passed 875 tests with 3 intentional skips; standalone ESLint
  completed with no warnings.
- The production-mode local Linux container accepted 24/24 authenticated real
  multipart PNG pin requests at concurrency 6. Measured elapsed time was 419ms,
  throughput 57.28 requests/second, p50 91ms, p95 157ms, and p99 179ms.
- The 1,500ms p95 threshold passed with no 429, 4xx, 5xx, network, or
  application-log failures. The isolated fixture had no notification recipients
  or integrations.
- Cleanup deleted 1 fixture project and 24 screenshot files, then verified zero
  remaining fixture projects, screenshot rows, or captured files. An independent
  PostgreSQL query also returned `projects=0` and `screenshots=0`.
- These numbers prove only the bounded disposable local single-container run.
  They are not production capacity or horizontal-scaling evidence.
