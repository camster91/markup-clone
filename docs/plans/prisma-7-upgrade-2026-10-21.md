# Prisma 6 → 7 upgrade (2026-10-21)

**Status:** implemented on branch `ccr-ff82cc8e-enzsdu`. **Hold: merge after
the 2026-11-06 production deploy**, so the release that carries the
data-loss fixes does not also carry a database-client change.
**Source:** 2026-10-15 review dependency item; Prisma 7.10.1 is the newest
stable release (8.0 is still a release candidate).

## What Prisma 7 changes for this app

- No Rust query engine. The client talks to Postgres through a driver
  adapter (`@prisma/adapter-pg` on `pg`). `new PrismaClient()` without an
  adapter no longer works.
- The datasource `url` is not allowed in `schema.prisma` any more. It already
  lived in `prisma.config.ts`, which the CLI reads.
- The `prisma-client-js` generator still works (deprecated, not removed). It
  is kept so every `@prisma/client` import and the `Prisma` namespace types
  stay unchanged.

## Changes

- `src/lib/prisma.ts` builds the client with `PrismaPg` and a 5 s connect
  timeout. That is Prisma 6's default; pg's default is unlimited.
- `scripts/lib/app-prisma.cjs` does the same for scripts run inside the
  container: `provision-operator.cjs`, the QA seeds and fixtures, and
  `local-load-fixture.mjs`. All seven now use it.
- `prisma/schema.prisma`: `url` removed from the datasource block.
- `next.config.ts`: `serverExternalPackages: ["@prisma/adapter-pg"]`, so the
  adapter and its dependencies ship as packages in the standalone output.
- Dockerfile: comment only. The full `@prisma` copy is also what makes the
  adapter's CommonJS entry available to the scripts.
- Docs: README, AGENTS.md and `.env.example`.

## Verification

Done on 2026-10-21 with images built from this branch (Node 24, Alpine)
against a disposable Postgres 16:

- The migrator image (`prisma migrate deploy`, Prisma 7 CLI) applied all 29
  migrations.
- The app image booted and `/api/health` returned ok.
- `provision-operator.cjs` created an operator through `docker exec`.
- Sign-in, `/api/auth/me`, project create, project list, and project delete
  (cascading pins, comments and attachments) all worked through the HTTP API,
  with no errors in the app log.
- In the container, through the script helper:
  - an interactive `$transaction` with the conditional `updateMany` claim
    used by the comments route returned count 1;
  - a throwing transaction rolled back;
  - `DateTime` fields come back as `Date`;
  - unique violations still surface as `P2002`.
- Unit and integration suite, lint, typecheck and `next build` all pass.

Standalone output dropped from about 153.8 MB to 80.9 MB, because the query
engine binary is gone.

## Rollback

Revert the merge commit and redeploy. There are no schema or migration
changes, so the database needs nothing.
