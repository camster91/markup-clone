# deploy.sh: build before migrating, password auth before trust (2026-10-21)

**Status:** implemented on branch `ccr-ff82cc8e-enzsdu`; dry-run on a stand-in
host (see Verification). Not yet used for a production deploy.
**Source:** 2026-10-15 review items "deploy ordering" and "pg_hba trust".
CLAUDE.md requires a full `cleanup-caddy-orphans.sh && deploy.sh` dry-run on a
non-prod host before any `deploy.sh` change; this plan records that run.

## Problems

1. **Migrations ran before the image build.** If the build then failed (npm
   or network trouble, a broken commit), the live database was already
   migrated while the old container kept running on a schema it was not
   built for.
2. **Every host got a passwordless trust rule.** `deploy.sh` added
   `host all all <markup-net subnet> trust` to `pg_hba.conf` unconditionally.
   Any container attached to `markup-net` could connect to Postgres as any
   role without a password, even when the password in `.env` was correct.
3. **The postgres "restart" never ran.** After adding the rule the script
   called `pg_ctl ... restart` through `docker exec` as root. `pg_ctl` refuses
   to run as root, so only the preceding SIGHUP (a reload, which is all
   `pg_hba.conf` needs) ever took effect.

## Change

- **Build before migrations.** Step 2 is now the image build and step 3 the
  migrations. A failed build calls `fail` before the database is touched. The
  rollback-image and edge preflights still run before both.
- **Probe password auth before any trust rule.** A throwaway `$PG_IMAGE`
  container on `markup-net` runs `psql "$DATABASE_URL" -c 'SELECT 1'`, with
  `DATABASE_URL` passed via `--env-file`, never argv.
  - If the probe succeeds, no trust rule is added.
  - If it fails, the old subnet trust rule is added as before and applied with
    SIGHUP. The broken restart is removed.
- **Existing hosts are unchanged:** a trust line already in `pg_hba.conf` is
  left in place. Removing it from production is a separate, manual step after
  confirming password auth works there.

## Verification (stand-in host)

The sandbox acted as the stand-in host: its Docker daemon, `/root/markup-clone`
as a Git checkout, `/data/...` directories, and an `.env` with test secrets.
Two adaptations applied only to the sandbox, not to the script:

- `CURL_BIN` pointed the final public-HTTPS probe at the loopback health
  endpoint, because there is no public DNS or TLS.
- A `docker build` wrapper added this sandbox's egress-proxy CA and host
  networking.

Runs, each `bash scripts/cleanup-caddy-orphans.sh && bash scripts/deploy.sh`:

1. Baseline: `main` at `9f965e6`, first install on an empty host.
2. New script, upgrade over run 1.
3. New script, a commit with a new migration and a build that fails: the
   deploy stops at the build, the migration is not applied, and the old
   container keeps serving.
4. New script, fresh host: password auth works, so no trust line is added.
5. New script, `.env` password drifted from the database: the probe fails,
   the trust rule is added with a reload, and the app is healthy.

Results are recorded below once the runs complete.
