# Attachment claim race and stale row pruning (2026-10-18)

**Status:** implemented on branch `ccr-ff82cc8e-enzsdu`; not yet deployed.
**Source:** 2026-10-15 repo review follow-ups.

## 1. Double submit could move an attachment to another comment

`POST /api/pins/[id]/comments` checked that the attachments were unbound, then
created the comment with Prisma `connect`. Two requests with the same
`attachmentIds` (a double click) both passed the check. The second `connect`
silently moved the files to the second comment, and the first comment could
be left empty, since an attachment-only comment has no text.

**Change:** when there are attachments, the comment is created inside an
interactive transaction. The attachments are then claimed with
`updateMany ... WHERE commentId IS NULL AND projectId = <pin's project>`. If
fewer rows are claimed than requested, the transaction rolls back and the
request returns 409. Under READ COMMITTED, Postgres re-checks the `WHERE`
after the other transaction commits, so the loser claims 0 rows. I checked
this with two concurrent sessions on Postgres 16. Comments without
attachments keep the single `create`.

## 2. Sessions and presence rows were never deleted

Nothing removed expired `Session` rows or old `Presence` rows, so both tables
grew forever.

**Change:** the nightly prune (`scripts/prune-screenshots.sh`, 03:00 UTC)
also deletes:

- `Session` rows past `expiresAt`. They can never authenticate again.
- `Presence` rows not seen for a day. `GET /api/presence` never returns rows
  older than its 60-second window.

Both run only when it is not a dry run. Both statements ran against a
Postgres 16 database with every migration applied.

## Tests

- `tests/integration/attachment-ownership.test.ts`: the claim is conditional
  and runs in the transaction; a lost race returns 409.
- `tests/unit/prune-screenshots-retention.test.ts`: the two new DELETEs.
