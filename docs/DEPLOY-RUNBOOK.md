# Deploy Runbook — "I just deployed and it broke"

Incident-response doc. If you're here, the deploy is on fire and you need to fix it in 5 minutes, not read essays. The README's [Known pitfalls](../README.md#known-pitfalls) and [Troubleshooting](../README.md#troubleshooting) sections are the *root-cause* write-ups (use those when starting fresh or doing a postmortem); this runbook is the *on-call* doc with copy-pasteable fixes.

> **Current edge (verified 2026-08-08): Traefik owns ports 80/443.** Do not run
> the legacy Caddy cleanup or restart commands on this host; host-visible Caddy
> processes belong to unrelated Docker applications. Start with
> `bash /root/markup-clone/scripts/edge-proxy-preflight.sh verify`. Caddy sections
> below are retained only for a host explicitly detected as `caddy`.

## Pre-deploy checklist

Run through these before kicking off a deploy. Each takes <10s.

1. **Traefik is the public listener.** `ssh coolify 'ss -ltnp | grep -E ":(80|443).*traefik"'`
   must show both public ports. `systemctl status caddy` is not an ingress check on
   this VPS; the Caddy unit is intentionally masked.
2. **The active Traefik route and trusted certificate pass.** Run
   `ssh coolify 'bash /root/markup-clone/scripts/edge-proxy-preflight.sh verify'`.
   This validates `/opt/traefik/dynamic/routers.yml`, loopback port 3030, the
   public health payload, hostname, expiry, issuer chain, and OS trust. Never add
   `-k` or `--insecure` to turn a certificate failure green.
3. **`.env` on the VPS has a non-empty `DATABASE_URL` entry.** Check presence
   without printing its value:
   `ssh coolify 'grep -q "^DATABASE_URL=." /root/markup-clone/.env && echo "database URL present"'`.
   `deploy.sh` extracts the PostgreSQL password from that URL when it must
   recreate the database container; production does not require a duplicate
   standalone `POSTGRES_PASSWORD` entry. Never print the matching line into a
   terminal or chat transcript.
4. **The `markup-net` Docker bridge exists and has a known subnet.** `ssh coolify 'docker network inspect markup-net -f "{{range .IPAM.Config}}{{.Subnet}}{{end}}"'` — must return a CIDR, not empty.
5. **Local `npm run lint && npm test` are clean.** Require zero lint warnings
   and use the exact test count from the release evidence; do not rely on the
   historical counts elsewhere in this runbook.
6. **The active router maps Markup to loopback port 3030.** Confirm the `markup`
   router and service in `/opt/traefik/dynamic/routers.yml`; the edge preflight in
   item 2 checks both. Do not inspect `/data/coolify/proxy` for this route—the live
   Traefik container does not mount that directory.
7. **The new screenshot status endpoint `/api/screenshots/[id]/status` is reachable from the dashboard origin.** `ssh coolify 'curl -sI -H "Origin: https://markup.ashbi.ca" http://127.0.0.1:3030/api/screenshots/00000000-0000-0000-0000-000000000000/status'` — expect a `200` (the zero UUID resolves to a 404 payload but the origin check passes) or a `404` from the route, **never** a `405 Method Not Allowed` or a `Connection refused`. This route is what `ScreenshotView` polls every second during a recapture (commits `bd5c4ac` + `7ce5dba` + `d131d5f`); if it's missing the dashboard's "regenerating screenshot" spinner never resolves.
8. **No uncommitted changes in the repo** that would change deploy behavior.
   `git status` must be clean; `deploy.sh` now enforces tracked and untracked
   cleanliness before assigning the source-SHA image tag.
9. **The host checkout can authenticate to Git and fast-forward.** Run
   `git -C /root/markup-clone ls-remote origin HEAD` read-only before the release
   window. `deploy.sh` requires the checkout, pull, commit resolution, and clean
   tree to succeed. Tarballs and legacy `.last-sha` markers are not accepted as
   release provenance.
10. **The running application has an immutable rollback image.**
   `bash /root/markup-clone/scripts/rollback-image-preflight.sh` must succeed
   before migrations or replacement. It verifies that the container uses
   `markup-clone:<40-character-sha>`, that the image is still local, and that
   the tag still resolves to the exact running image ID. The deploy records the
   result in `/data/markup-clone/rollback-image.env` with mode `0600`.
   After exact release approval and before `deploy.sh`, run
   `bash /root/markup-clone/scripts/retain-rollback-image.sh`. It creates a
   stopped, labelled, network-disabled container referencing that exact image.
   This is required because the shared host runs
   `docker image prune -af --filter "until=24h"`; [Docker removes images not
   referenced by any container](https://docs.docker.com/reference/cli/docker/image/prune/)
   even when they retain a source-SHA tag. Verify
   `docker inspect markup-clone-rollback-retainer` resolves to the same image ID
   recorded by the preflight. A missing, mismatched, or unowned retainer is a
   release stop.
11. **The public artifact matches the release checkout.** From the exact local
   release commit, run `npm run verify:public-release`. It verifies trusted
   HTTPS, health, security headers, anonymous page redirection plus API denial,
   and the deployed `widget.js` SHA-256 without making a production write.

If any item fails, fix it *before* you start — these are the failure modes below.

The 2026-08-08 read-only preflight found one release stop condition: production
`scripts/prune-screenshots.sh` has byte-for-byte identical content to Git but is
mode `0755` while the checked-in mode is `0644`. The host therefore appears dirty.
Choose and approve one of these before deployment: commit the executable bit as
intentional, or restore the host mode to the committed value. Do not bypass the
clean-tree guard.

That preflight also found a self-signed `CN=markup.ashbi.ca` certificate. This is
resolved release history, not a current stop condition: a normal trusted client
verified the public route on 2026-08-28, which served a Let's Encrypt `YR1`
certificate for `markup.ashbi.ca` valid from 2026-08-08 through 2026-11-06. Run
`edge-proxy-preflight.sh verify` again immediately before every deployment; live
host evidence, not this historical note, governs the release decision.

A read-only recovery inventory found a known-good certificate/key pair at
`/opt/traefik/certs/.bak.20260723_192747/markup.ashbi.ca.{crt,key}`. The pair
matches, the key is mode `0600`, the SAN is exactly `markup.ashbi.ca`, the issuer
is Let's Encrypt `YE1`, and it is valid through 2026-09-13. Its SHA-256
fingerprint is
`92:11:C0:FD:B9:1D:45:23:F3:96:0A:81:8A:ED:0C:E1:E4:FB:28:1B:45:4E:A4:ED:4A:59:56:24:76:8B:EC:6B`.
The inactive `/data/coolify/proxy/acme.json` also contains a different valid
Markup certificate through 2026-09-03; do not edit Traefik's active ACME JSON by
hand when the verified file-pair rollback is available.

The recovery sequence below is retained only for a future recurrence. For an
approved TLS repair window:

1. Back up the active Markup certificate/key, `tls.yml`, and active ACME JSON.
2. Atomically restore the verified archived pair to the active certificate paths
   and confirm Traefik's file watcher serves the expected fingerprint with normal
   certificate verification.
3. Preserve that restored pair as the immediate rollback while removing only the
   two Markup static-certificate lines from `tls.yml`. The already-loaded
   `markup@file` router is enabled with `certResolver: letsencrypt`, and its
   `markup@file` service is enabled at `http://127.0.0.1:3030`.
4. Confirm the active `/opt/traefik/acme.json` gains `markup.ashbi.ca`, the public
   certificate is trusted, and `edge-proxy-preflight.sh verify` passes. If ACME
   issuance fails, restore the static `tls.yml` binding to the known-good pair.

Pending migrations run through `scripts/apply-migration.sh` with
`psql --single-transaction -v ON_ERROR_STOP=1`. The Prisma history marker is
streamed after the migration SQL in that same transaction, so the schema and
history both commit or both roll back. Never filter or suppress migration errors
to keep a release moving.

## Release recovery drills

Production execution requires Cameron's explicit approval. The commands below
were exercised against the disposable local Compose stack on 2026-08-08; they
are not evidence that a production backup or rollback has been performed.

### Backup drill

The app image pins PostgreSQL 16 client tools to match the server. The script
creates a private custom-format dump, verifies its table of contents, and writes
a SHA-256 sidecar before reporting success.

```bash
docker compose exec -T app bash /opt/app-scripts/backup-postgres.sh
docker compose exec -T app sh -c 'ls -l /data/backups && pg_restore --list /data/backups/markup-YYYYMMDDTHHMMSSZ.dump | head'
```

On the VPS, use `docker exec markup-clone` for the first command. Copy both the
`.dump` and `.dump.sha256` files off-host; a same-host backup is only a recovery
convenience, not disaster recovery.

### Restore drill

First prove the guard refuses a non-empty database. Then stop every writer,
name the exact target database, and explicitly opt into replacement. Never run
this against production while the app container is accepting traffic.

```bash
docker compose run --rm --no-deps -T \
  -e RESTORE_CONFIRM_DATABASE=markup_db \
  app bash /opt/app-scripts/restore-postgres.sh /data/backups/markup-YYYYMMDDTHHMMSSZ.dump
# Expect exit 4: target is non-empty and remains unchanged.

docker compose stop app
docker compose run --rm --no-deps -T \
  -e RESTORE_CONFIRM_DATABASE=markup_db \
  -e ALLOW_NONEMPTY_RESTORE=1 \
  app bash /opt/app-scripts/restore-postgres.sh /data/backups/markup-YYYYMMDDTHHMMSSZ.dump
docker compose up -d app
curl -fsS http://127.0.0.1:3030/api/health
```

Verify a known workspace/project row and the finished migration count after the
restore. If either differs from the backup manifest, keep the app stopped.

### Rollback drill

Application images are tagged with the exact 40-character source SHA. Rollback
means returning to a known prior image, not rebuilding an old branch. Take a
backup first, record the current image, and verify the prior image exists locally.

```bash
bash /root/markup-clone/scripts/rollback-image-preflight.sh
bash /root/markup-clone/scripts/retain-rollback-image.sh
set -a
. /data/markup-clone/rollback-image.env
set +a
docker image inspect "$ROLLBACK_IMAGE" >/dev/null
test "$(docker image inspect "$ROLLBACK_IMAGE" --format '{{.Id}}')" = "$ROLLBACK_IMAGE_ID"
docker stop markup-clone
docker rename markup-clone markup-clone-failed
# Re-run the docker run block from scripts/deploy.sh with
# $ROLLBACK_IMAGE and the unchanged env, network, and mounts.
curl -fsS http://127.0.0.1:3030/api/health
```

Keep `markup-clone-failed` until health and the owner/client smoke journey pass.
To abort the rollback, remove the replacement, rename the retained container
back, and start it. Additive migrations are retained; never reverse database
migrations casually during an application rollback.

The stopped `markup-clone-rollback-retainer` exists only to keep Docker's nightly
image-prune job from deleting the rollback image. It has no network, restart
policy, mounts, or published ports. Do not remove it until a newer deployed
release has been captured and verified by the same helper.

Read-only production inventory on 2026-08-08 confirmed that the healthy live
container uses `markup-clone:d47ada5bfa0d66be70d4751ce63ddfee07c63da3`,
that the tag remains local as image
`sha256:c077ad33288c5284c16d6c58d11f1bb140dd14167c24502bab0ce81cdc55d891`,
and that the public health endpoint returns HTTP 200. This proves a prior image
is retained; it does not prove a production rollback has been executed.

### Observability drill

```bash
curl -fsS http://127.0.0.1:3030/api/health
docker inspect markup-clone --format '{{.State.Health.Status}}'
docker logs --since 10m markup-clone 2>&1 | tail -200
docker exec markup-postgres pg_isready -U markup -d markup_db
bash /root/markup-clone/scripts/host-state.sh
```

Healthy means both containers answer, the application log has no repeated 5xx,
Prisma, audit, delivery-worker, or recapture failures, and host-state confirms
the Caddy route plus recapture prerequisites.

### Rate-limit drill

Do not flood the production widget to test throttling. Exercise the deterministic
route suites and verify the runtime remains single-instance as documented in
`docs/rate-limit-limitations.md`.

```bash
npx vitest run tests/unit/rate-limit.test.ts \
  tests/integration/comments-rate-limit.test.ts \
  tests/integration/recapture.test.ts \
  tests/integration/screenshot-status.test.ts
docker ps --filter name=markup-clone --format '{{.Names}}'
```

The suites must assert HTTP 429 and numeric `Retry-After` behavior. More than one
application instance is a release stop until the limiter uses a shared store.

---

## Failure 1 — Caddyfile-import rejected: `unrecognized directive: <site-name>`

**Symptom:** `caddy` is up but HTTPS on `markup.ashbi.ca` returns `502` or `connection refused`. `journalctl -u caddy` shows `unrecognized directive: markup.ashbi.ca` at startup.

**Diagnosis:** someone reintroduced the M1 pattern — a Caddyfile `import` directive pulling in a Caddyfile *site block* instead of a JSON config fragment. Caddy v2's `import` is for JSON only; site blocks must be inlined.

**Fix (60s):**

```bash
ssh coolify 'bash /root/markup-clone/scripts/deploy.sh --route-only'   # re-inlines the site block
ssh coolify 'systemctl restart caddy && sleep 2 && journalctl -u caddy -n 20 --no-pager'
```

**Prevention:** never add `import` to a Caddyfile in this repo. Use `add_markup_route` in `scripts/deploy.sh` (line ~366). The `import` line is preserved as a no-op backstop comment in the guard — don't "fix" it.

**Test command:** `ssh coolify 'curl -sI https://markup.ashbi.ca | head -1'` — expect `HTTP/2 200`.

---

## Failure 2 — `pg_hba` trust subnet mismatch: `Authentication failed against database server`

**Symptom:** `/api/health` 500s. `docker logs markup-clone` shows `P1000 Authentication failed against database server` from Prisma. Container itself is up.

**Diagnosis:** the postgres container's `pg_hba.conf` falls through to its `scram-sha-256` default (the official image's first non-comment line) because our `host all all <SUBNET> trust` rule is missing or the subnet changed.

**Fix (90s):**

```bash
ssh coolify
SUBNET=$(docker network inspect markup-net -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}')
docker exec markup-postgres bash -c "sed -i '1 a\\\n# manual: trust the app subnet\nhost all all $SUBNET trust' /var/lib/postgresql/data/pg_hba.conf"
docker exec markup-postgres pg_ctl -D /var/lib/postgresql/data restart -m fast
```

Then re-run `deploy.sh` so the subnet rule gets pinned permanently.

**Prevention:** `deploy.sh` step 8 inserts the trust line automatically. If you're changing the Docker network, re-run `deploy.sh` end-to-end. Never hard-code a subnet.

**Test command:** `ssh coolify 'docker exec markup-clone npx prisma db pull --print 2>&1 | tail -5'` — expect no `P1000` and a schema print, not a stack trace.

---

## Failure 3 — Mid-continuation bash comment: `docker: requires at least 1 argument`

**Symptom:** a deploy or install script aborts with `docker: requires at least 1 argument`. The line number in the error points inside a heredoc body, often at a `#` comment. The script is `scripts/install-cron.sh` or any new cron-installer you wrote.

**Diagnosis:** a heredoc whose body is *mostly* a comment can be evaluated by bash if its delimiter is unquoted (`<<EOF`) AND the body contains `$VAR`, `$(...)`, `` `...` ``, or `\` in a way that affects the next text token. A `# foo (bar)` comment with an unbalanced `)` or stray backtick causes bash to start parameter/command substitution inside the comment, and the empty/malformed expansion breaks the very next token (e.g. `docker` with no args). The error you see is misleading: the line it points at is fine in isolation; it's the heredoc body above it that misbehaved.

> **CORRECTION (this section previously gave the opposite advice — the runbook was wrong, and we're owning it):** the previous version of this section told you to *quote the delimiter with `<<'EOF'`* whenever a comment might contain `(`, backticks, etc. That's true in isolation, but it's a footgun in this repo because the cron-installer heredoc **needs `$GUARD_SCRIPT` and `$GUARD_LOG` to expand** to real paths. Switching to `<<'EOF'` silently suppressed that expansion and is what actually broke the most recent cron-broken case — the cron file ended up with a literal `$GUARD_SCRIPT` on the `* * * * *` line (see Failure 5). The `install-cron.sh` shipped in this repo now uses unquoted `<<EOF` and the heredoc body is written so that no comment contains an unbalanced paren, backtick, or backslash.

**Fix (30s):** if you're authoring the heredoc, do one of:

```bash
# (A) Use bare <<EOF and ESCAPE metachars in any comment that has them.
#     This is what install-cron.sh does. The body must be free of
#     $(...), `...`, and stray \ that could swallow a token.
cat > /etc/cron.d/markup-guard <<EOF
# runs every minute \(see scripts/foo\)
* * * * * root /root/markup-clone/scripts/markup-caddy-guard.sh
EOF

# (B) Use <<'EOF' (quoted) when you don't need \$VAR expansion in
#     the body. Safe for any comment content. Use this if the body
#     is fully static and you don't want to think about escaping.
cat > /etc/cron.d/markup-guard <<'EOF'
# runs every minute, see scripts/foo (import) directive
* * * * * root /root/markup-clone/scripts/markup-caddy-guard.sh
EOF
```

The rule of thumb the runbook should have given from the start: **don't reach for `<<'EOF'` by reflex — pick the one that matches whether you need `$VAR` to expand, and audit the body for metachars either way.** The (A) form is what `install-cron.sh` now uses; the (B) form is correct for fully static bodies.

**Recovery when you already shipped the broken version (this is what bit us):** re-run `bash scripts/install-cron.sh` on the VPS — it rewrites `/etc/cron.d/markup-caddy-guard` with the corrected heredoc. Then verify (see Failure 5 for the full recipe).

**Prevention:**
- When authoring a heredoc that needs `$VAR` expansion, audit every comment line in the body for unbalanced `(`, `)`, backticks, and `\`. Escape them or rephrase the comment.
- When authoring a fully static heredoc, use `<<'EOF'`.
- Run `bash -n scripts/install-cron.sh && echo OK` after edits — it catches heredoc syntax errors before you ship.
- Don't trust this runbook's earlier advice; read the script and trust the file.

**Test command:** `bash -n scripts/install-cron.sh && echo OK` — expect `OK`. `bash -n` parses without executing and catches heredoc syntax errors immediately.

---

## Failure 4 — Orphan caddy from debug session: TLS works, then suddenly HTTPS goes down

**Symptom:** `markup.ashbi.ca` is healthy for hours, then HTTPS starts returning `502`/`connection reset`/`TLS internal error` with no deploy in between. `systemctl status caddy` says "active (running)" — looks fine.

**Diagnosis:** an earlier `ssh coolify` debug session left a bare `caddy run` (or `caddy` with no subcommand) process bound to :443. systemd's caddy is *also* bound to :443, but two listeners on the same port is racy — whichever wins the `accept()` race changes mid-connection, breaking TLS. The orphan's PPID is its old SSH shell (PPID ≠ 1), not systemd.

**Fix (10s):**

```bash
ssh coolify 'bash /root/markup-clone/scripts/cleanup-caddy-orphans.sh'
```

That script detects caddy PIDs with PPID ≠ 1, SIGTERMs them, escalates to SIGKILL if needed, and verifies the system-caddy still owns :443.

**Prevention:** never run a bare `caddy` (or `caddy run`) on the VPS outside of a `screen`/`tmux` session you're going to clean up. Use `caddy validate --config /etc/caddy/Caddyfile` and `caddy reload` (over the systemd-managed socket) instead — they don't bind :443. If you must run an interactive caddy for debugging, kill it before you disconnect: `pkill -f "caddy run"`.

**Test command:** `ssh coolify 'pgrep -af caddy | grep -v caddy-guard'` — expect **no output**. The only caddy on the box should be the systemd-managed one (PPID 1) and any short-lived caddy-guard transients.

---

## Failure 5 — Cron job runs but does nothing (silent variable substitution failure)

**Symptom:** `markup.ashbi.ca` stays healthy for a while, then a fleet-wide Caddy edit wipes the markup route and HTTPS starts 502ing. `journalctl -u crond --since '-5min'` shows the `markup-caddy-guard` CMD firing every minute on schedule — cron is *not* broken. But `/var/log/markup-caddy-guard.log` is **stale** (mtime older than 60s) and the route is not being re-added. cron thinks the job is succeeding; the job is doing nothing.

**Diagnosis:** `scripts/install-cron.sh` previously wrote the guard cron file using a *quoted* `<<'EOF'` heredoc, which suppresses all parameter substitution in the body. The cron file on the VPS ended up with a **literal `$GUARD_SCRIPT` and `$GUARD_LOG`** on the `* * * * *` line instead of the expanded paths. cron then tries to run a command named `$GUARD_SCRIPT` (not a real file), fails silently, and writes nothing to the log — which is why the log mtime stays stale even though cron is firing the job.

**Fix (60s) — full operator recipe, no VPS guessing:**

```bash
# 1. Confirm the cron file has the bug (literal $VAR in the body).
ssh coolify 'cat /etc/cron.d/markup-caddy-guard' | grep -E "root " | head -1
#    BAD  (literal):  * * * * * root $GUARD_SCRIPT >> $GUARD_LOG 2>&1
#    GOOD (expanded): * * * * * root /root/markup-clone/scripts/markup-caddy-guard.sh >> /var/log/markup-caddy-guard.log 2>&1
#    If you see `$GUARD_SCRIPT` in the output, the cron is broken.

# 2. Check the log mtime for a second confirmation.
ssh coolify 'ls -la /var/log/markup-caddy-guard.log'
#    mtime older than ~60s + cron firing = the broken-heredoc case.

# 3. Re-run the installer. install-cron.sh now uses unquoted <<EOF,
#    so $GUARD_SCRIPT and $GUARD_LOG expand to real paths.
bash scripts/install-cron.sh
#    (run this from the repo on the VPS, or rsync the script first)

# 4. Verify the fix landed.
ssh coolify 'cat /etc/cron.d/markup-caddy-guard' | grep -E "root " | head -1
#    Expect: * * * * * root /root/markup-clone/scripts/markup-caddy-guard.sh >> /var/log/markup-caddy-guard.log 2>&1

# 5. Wait ~60s, then confirm the guard actually fired.
ssh coolify 'ls -la /var/log/markup-caddy-guard.log && tail -n 20 /var/log/markup-caddy-guard.log'
#    mtime should be fresh; log should show recent guard activity.

# 6. Confirm the Caddy route is back.
ssh coolify 'grep -A1 "markup.ashbi.ca" /etc/caddy/Caddyfile'
#    Expect the site block line back.
```

**If step 4 still shows `$GUARD_SCRIPT` after re-running:** you ran the installer from a stale checkout that *still* has the old `<<'EOF'` heredoc. Pull the latest `main` (this fix landed alongside the runbook update) and re-run. If you're sure you're on the latest, check the heredoc in `scripts/install-cron.sh` directly with `grep -n "<<.*EOF" scripts/install-cron.sh` — every heredoc in the caddy-guard install block must be **unquoted**.

**If the guard fires but the route still doesn't get re-added:** that's a different bug (the guard script itself, or the Caddy admin API is down). Run `bash scripts/markup-caddy-guard.sh` directly to see the error, then check Failure 1 / Failure 4.

**Prevention:**
- Never reintroduce a quoted `<<'EOF'` heredoc anywhere in `scripts/install-cron.sh` that needs `$VAR` expansion. The two heredocs in that file (prune job and caddy-guard job) both need expansion; both must stay unquoted.
- A second pair of eyes on any new heredoc in a `scripts/*.sh` file: does it need `$VAR`? If yes, bare `<<EOF` and audit the body for metachars (see Failure 3). If no, use `<<'EOF'`.
- The Pre-deploy checklist item #1 catches this — `ls -la /var/log/markup-caddy-guard.log` is your early-warning that the cron is silently broken before the route actually drops.

**Test command:** `ssh coolify 'cat /etc/cron.d/markup-caddy-guard' | grep -E "root " | head -1` — expect an *expanded* path, never a literal `$GUARD_SCRIPT`.
