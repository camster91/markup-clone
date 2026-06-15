# Deploy Runbook — "I just deployed and it broke"

Incident-response doc. If you're here, the deploy is on fire and you need to fix it in 5 minutes, not read essays. The README's [Known pitfalls](../README.md#known-pitfalls) and [Troubleshooting](../README.md#troubleshooting) sections are the *root-cause* write-ups (use those when starting fresh or doing a postmortem); this runbook is the *on-call* doc with copy-pasteable fixes.

> **First move always:** `ssh coolify` and `bash /root/markup-clone/scripts/cleanup-caddy-orphans.sh` — orphan caddy is the most common "mystery" outage and takes 5 seconds to rule out.

## Pre-deploy checklist

Run through these before kicking off a deploy. Each takes <10s.

1. **On the VPS, no orphan caddy is bound on :443, and the guard cron has fired in the last 60s.** `ssh coolify 'pgrep -af caddy | grep -v caddy-guard'` — expect no output. `ssh coolify 'ls -la /var/log/markup-caddy-guard.log'` — the log mtime should be within the last 60s; if it's stale while `journalctl -u crond` shows the `markup-caddy-guard` CMD firing every minute, see Failure 5.
2. **`/etc/caddy/Caddyfile` and `/opt/caddy/markup.d/caddyfile` exist and are readable.** `ssh coolify 'ls -l /etc/caddy/Caddyfile /opt/caddy/markup.d/caddyfile 2>&1'`.
3. **`.env` on the VPS has the current `POSTGRES_PASSWORD` and `DATABASE_URL`.** `ssh coolify 'grep -E "^(POSTGRES_PASSWORD|DATABASE_URL)=" /root/markup-clone/.env'` — both lines present, no `***` from chat-layer redaction.
4. **The `markup-net` Docker bridge exists and has a known subnet.** `ssh coolify 'docker network inspect markup-net -f "{{range .IPAM.Config}}{{.Subnet}}{{end}}"'` — must return a CIDR, not empty.
5. **Local `npm run lint && npx vitest run` are clean.** 0 warnings, 212+/212+ passing (the suite has grown with the audit sweep D5/D7/D8 + F3/F4/F5; the exact count is in the last `npx vitest run` output).
6. **The Caddyfile on the VPS has the `markup.ashbi.ca { reverse_proxy 127.0.0.1:3030 }` site block.** `ssh coolify 'bash /root/markup-clone/scripts/host-state.sh | grep -i "markup route"'` — the `has_markup_route` helper (line 28 of `scripts/host-state.sh`) returns `present` if the block is there, `**MISSING**` if not. The bare `grep -A1 "markup.ashbi.ca" /etc/caddy/Caddyfile` form still works but will false-positive on a stale or commented-out block.
7. **The new screenshot status endpoint `/api/screenshots/[id]/status` is reachable from the dashboard origin.** `ssh coolify 'curl -sI -H "Origin: https://markup.ashbi.ca" http://127.0.0.1:3030/api/screenshots/00000000-0000-0000-0000-000000000000/status'` — expect a `200` (the zero UUID resolves to a 404 payload but the origin check passes) or a `404` from the route, **never** a `405 Method Not Allowed` or a `Connection refused`. This route is what `ScreenshotView` polls every second during a recapture (commits `bd5c4ac` + `7ce5dba` + `d131d5f`); if it's missing the dashboard's "regenerating screenshot" spinner never resolves.
8. **No uncommitted changes in the repo** that would change deploy behavior. `git status` clean.

If any item fails, fix it *before* you start — these are the failure modes below.

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
