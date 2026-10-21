# deploy.sh: build before migrating, password auth before trust (2026-10-21)

**Status:** implemented on branch `ccr-ff82cc8e-enzsdu`; dry-run passed on a
stand-in host (see Verification). Not yet used for a production deploy.
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
   `pg_hba.conf` needs) ever took effect. The baseline dry-run logged
   `pg_ctl: cannot be run as root`.

Found during the dry-run:

4. **The database password was printed on first installs.** The
   create-postgres branch called `if ! read_pg_password; then`, which runs
   the helper bare, so the password went to the deploy's stdout (the
   operator's SSH terminal). It was then also passed in argv as
   `-e POSTGRES_PASSWORD=<pw>`.
5. **An image counted as a container.** `docker inspect "$APP_CONTAINER"`
   also matches an image named `markup-clone`. A host with images but no
   container was therefore treated as an upgrade, and the deploy failed the
   rollback preflight.

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
- **Password handling:** read once into a variable and passed to `docker run`
  through its environment (`-e POSTGRES_PASSWORD` with no value), so it is
  no longer printed and no longer in argv.
- **Container checks** use `docker inspect --type container`.
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

| # | Script | Scenario | Result |
|---|--------|----------|--------|
| 1 | `main` @ `9f965e6` | First install, empty host | DEPLOY OK; added the subnet **trust** rule although the password was correct; `pg_ctl: cannot be run as root`; **printed the DB password** |
| 2 | new | Upgrade over run 1 | DEPLOY OK; build ran before the migration check; rollback and edge preflights passed |
| 3 | new | Commit adding a migration plus a failing build | **FAIL at build**; migration not recorded, table not created; old container still healthy |
| 3b | old (`9f965e6`) | Same commit | Applied the migration, **then** failed the build (the defect) |
| 4 | new | Fresh host (containers, network and data removed) | DEPLOY OK; "login over markup-net works; no trust rule added"; no trust line in `pg_hba.conf`; password absent from all output; operator created through the app's DB login |
| 5 | new | DB role password changed so `.env` no longer matches | Probe failed; trust rule added and reloaded with SIGHUP (postgres restart count 0); DEPLOY OK; operator created after the drift |

Note: `deploy.sh` runs `git pull` itself, and bash keeps executing the
version it started with. A `deploy.sh` change therefore takes effect on the
deploy **after** the one that pulls it in. Run 2 was repeated for that reason.
