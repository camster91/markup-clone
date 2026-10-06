# Coolify adoption

This configuration is prepared, not deployed. It does not complete the product's
separate authenticated launch/pilot gates.

## Application first, database second

Create a private GitHub application for `camster91/markup-clone`, main branch,
raw Docker Compose at `/deploy/coolify.yml`. Keep auto-deploy and instant deploy
off until the candidate, CI requirements and single-writer cutover pass.

The initial application adoption keeps `markup-postgres` on `markup-net`.
Database adoption remains required by the consolidation plan; do not call this
an entirely Coolify-managed stack until that subsequent migration is verified.
The two phases avoid starting competing PostgreSQL servers on the same bind path.

Preserve the existing runtime values privately in Coolify. In particular, keep
`DATABASE_URL`, `INTEGRATION_ENCRYPTION_KEY` and `DELIVERY_WORKER_SECRET`; changing
the encryption key would make stored integrations unreadable. Do not print them.
Production paths are `/data/screenshots` and `/data/markup-clone/backups`; the
network is `markup-net` and original loopback port is 3030. Missing storage is an
error, not permission to create empty replacement data. Scripts mount from the
deployed repository root. Verify `/opt/app-scripts/recapture.sh` in the candidate.

Use this host-side custom build command, replacing APPLICATION_UUID:

```sh
bash deploy/before-deploy.sh APPLICATION_UUID && docker compose --project-name APPLICATION_UUID build --pull
```

This preserves and verifies a database dump, screenshot archive and preceding
application filesystem before the source build. It does not enforce the separate
host capacity policy: do not queue a release build at or above its critical
threshold without the approved project exception. Initially rehearse the command
manually; configuring it alone is not proof that the guard ran. Restore-test the
backup and coordinate the app-specific worker/prune jobs for a consistent cutover.

## Private candidate

- Use a separate PostgreSQL restore, external candidate network, screenshot copy,
  backup directory and loopback port 13030. Never point a candidate at live data.
- Use fresh disposable credentials. Clear Mailgun/Maton credentials and disable
  stored integration targets/deliveries in the private database before startup.
  Do not start a candidate delivery cron or send notifications for QA.
- Apply migrations only to the isolated database. Main currently has no pending
  schema changes relative to live 81836384; recheck immediately before promotion.
- Verify login, project/image retrieval, widget behavior, private PDF rendering
  and recapture without sending external messages. Verify previous app/runtime
  compatibility against the restored schema before promoting.

## Cutover and jobs

The shared Traefik route already targets loopback 3030. Preserve that port and
origin; do not edit `/opt/traefik/dynamic/routers.yml` or run the legacy deploy
script, which manages shared proxy/authentication and cron state.

Keep exactly one application writer during the cutover. Retain the old image,
container configuration and all storage; stop the old app only after candidate
acceptance, then start the approved main revision on 3030. Recheck trusted HTTPS,
health, persisted files and the deployment's exact source SHA. Health alone does
not prove authentication or database connectivity.

The existing host delivery cron invokes `docker exec markup-clone`; update only
that app-owned target to the verified Coolify container name after cutover. Keep
its protected worker-secret expansion inside the container. Preserve the existing
daily screenshot-prune job and current `markup-postgres` target during phase one.
When adopting PostgreSQL, retarget its app-owned prune invocation explicitly.
Do not install/remove shared proxy guards or change other cron jobs.

## Database adoption and rollback

Live PostgreSQL is 16.14. Its original Docker image record is missing. Current
16.14 registry tags were inspected and did not match the original config digest.
A complete restore into installed PostgreSQL 16.15 preserved all 29 table hashes
and 110 records. The compatible recovery image and exact previous application
filesystem have protected copies, but that is not identical database-image proof.

Keep the original database container until a separate isolated database candidate,
app compatibility and single-writer adoption are verified. Never mount the live
PostgreSQL bind into two running servers. Do not reset passwords, add trust rules,
change shared networks/authentication or delete volumes to resolve a connection
problem. Preserve existing encryption, uploads, historical backups and rollback.

## Auto-deploy acceptance

Merge through existing repository rules after validation; disabled CI/access
settings are a separate authorization gate. Enable a signed main push hook only
after live acceptance. Prove one signed main event, one successful Coolify job,
the corresponding source revision, healthy containers and the original public
origin. Remove redundant app-specific deployment triggers only after that proof.

Local main validation: 971 tests passed, three shell-prerequisite tests skipped;
lint, type check, core/SDK/widget and Next production builds passed. Container
build/runtime, the skipped PostgreSQL-bootstrap tests on Linux, authenticated
candidate QA, migration cutover and main auto-deploy remain unverified.
