# P0 — feedback data loss and cross-team access (2026-10-15)

**Status:** implemented on branch `ccr-ff82cc8e-enzsdu`; not yet deployed.
**Source:** whole-repo review of `main` @ `10df531` on 2026-10-15.
**Blocks:** L1 authenticated QA and the L3 client pilot. Real client feedback
must not be deletable by a cron job or a single pin delete, and one team must
not be able to read or write another team's project.

## Defects

1. **Nightly prune erased feedback.** `scripts/prune-screenshots.sh` deleted
   every `Screenshot` with `capturedAt` older than 90 days. `Pin`, `Comment`,
   `Annotation` and comment attachments cascade from `Screenshot`, so feedback
   on any page not recaptured for 90 days was erased. Uploaded images and PDF
   pages are never recaptured, so their pins always went. `deploy.sh` installs
   the cron on every healthy deploy.
2. **Prune deleted live images.** The survivor query passed `-F''`, which bash
   collapses to `-F`; psql took `-c` as the separator, read empty stdin, and
   returned nothing. The empty survivor list disabled the "still referenced"
   filter, so every file older than 90 days was deleted, including images of
   screenshots that were kept. A failed query also continued without the filter.
3. **Deleting one pin deleted its whole screenshot.** `DELETE /api/pins/[id]`
   deleted the pin's `Screenshot` (and file) first. Uploaded images, PDF pages
   and dashboard-pinned captures share one screenshot, so every sibling pin and
   comment was erased, then the request 500'd.
4. **Cross-team pin/annotation writes.** `requireProjectKey` accepted any
   session plus a dashboard Origin for any `projectId` without a membership
   check.
5. **Cross-team live feed.** `GET /api/events` checked only for a session, so
   any signed-in user could stream another team's comments.

Verified against a disposable Postgres 16 with all migrations applied: the
original script removed a pinned screenshot, an upload, a PDF page and the
client comment, and deleted every old file including the kept screenshot's
image.

## Changes

- Prune deletes a `Screenshot` only when it has no pins, belongs to a website
  page (`reviewAssetId IS NULL`) and is not an upload (`path NOT LIKE
  '/uploads/%'`). The survivor query drops `-F''`, runs in dry-run mode too,
  and file deletion fails closed (exit 1) when it can't be read.
- Pin delete removes only the pin (`deleteMany` → 404 on a race) and audits
  the caller's email. Unpinned widget captures age out through the prune.
- `requireProjectKey` grants the session path only when
  `assertProjectAccessible(projectId)` passes; otherwise it falls through to
  the widget API key. `teams` is imported lazily to avoid a module cycle.
- `GET /api/events` calls `assertProjectAccessible` before subscribing.
- README regains the operations/cron and integration-delivery section that
  `tests/unit/integration-delivery-runtime.test.ts` checks.

## Tests

- `tests/unit/prune-screenshots-retention.test.ts` (runs the real script with
  a fake `docker`)
- `tests/integration/pin-delete-scope.test.ts`
- `tests/unit/require-project-key-membership.test.ts`
- `tests/integration/events-project-access.test.ts`

11 of these 14 cases fail on `main` and pass on the branch.

## Release note

Ship before **2026-11-06**, the earliest date production data from the
2026-08-08 release could pass the 90-day window. After deploy, run
`DRY_RUN=1 bash scripts/prune-screenshots.sh` on the host and confirm no
pinned, uploaded or PDF screenshot appears in its output. Approval is needed
before any production change.

## Follow-ups (not in this change)

The rest of the 2026-10-15 review: remaining by-id routes without project
scoping, the `X-Real-IP` rate-limit bypass, the IPv6 SSRF regex, widget
annotation tools, recapture IFS bug, missing schema indexes, deploy ordering,
CI gates, and dependency advisories (`next`, `sharp`).
