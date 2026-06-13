# Deploy Runbook — "I just deployed and it broke"

Incident-response doc. If you're here, the deploy is on fire and you need to fix it in 5 minutes, not read essays. The README's [Known pitfalls](../README.md#known-pitfalls) and [Troubleshooting](../README.md#troubleshooting) sections are the *root-cause* write-ups (use those when starting fresh or doing a postmortem); this runbook is the *on-call* doc with copy-pasteable fixes.

> **First move always:** `ssh coolify` and `bash /root/markup-clone/scripts/cleanup-caddy-orphans.sh` — orphan caddy is the most common "mystery" outage and takes 5 seconds to rule out.

## Pre-deploy checklist

Run through these before kicking off a deploy. Each takes <10s.

1. **On the VPS, no orphan caddy is bound on :443.** `ssh coolify 'pgrep -af caddy | grep -v caddy-guard'` — expect no output.
2. **`/etc/caddy/Caddyfile` and `/opt/caddy/markup.d/caddyfile` exist and are readable.** `ssh coolify 'ls -l /etc/caddy/Caddyfile /opt/caddy/markup.d/caddyfile 2>&1'`.
3. **`.env` on the VPS has the current `POSTGRES_PASSWORD` and `DATABASE_URL`.** `ssh coolify 'grep -E "^(POSTGRES_PASSWORD|DATABASE_URL)=" /root/markup-clone/.env'` — both lines present, no `***` from chat-layer redaction.
4. **The `markup-net` Docker bridge exists and has a known subnet.** `ssh coolify 'docker network inspect markup-net -f "{{range .IPAM.Config}}{{.Subnet}}{{end}}"'` — must return a CIDR, not empty.
5. **Local `npm run lint && npx vitest run` are clean.** 0 warnings, 188/188 passing.
6. **The Caddyfile on the VPS has the `markup.ashbi.ca { reverse_proxy 127.0.0.1:3030 }` site block.** `ssh coolify 'grep -A1 "markup.ashbi.ca" /etc/caddy/Caddyfile'`.
7. **No uncommitted changes in the repo** that would change deploy behavior. `git status` clean.

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

**Diagnosis:** an unquoted `<<EOF` heredoc is performing parameter/command substitution on every body line, including comments. A `# ... (something)` comment with an unbalanced `)` or backtick gets bash to try to evaluate it, then errors out with a misleading argument-count error from the resulting empty expansion.

**Fix (30s):** find the offending heredoc opener and quote the delimiter. In `scripts/install-cron.sh` the heredoc on line ~84 is already `<<'EOF'`; if you added a new one with bare `<<EOF`, change it to `<<'EOF'`:

```bash
# before (broken if comments contain $( ) or backticks):
cat > /etc/cron.d/markup-guard <<EOF
# runs every minute, see scripts/foo (import) directive
* * * * * root /root/markup-clone/scripts/markup-caddy-guard.sh
EOF

# after (safe):
cat > /etc/cron.d/markup-guard <<'EOF'
# runs every minute, see scripts/foo (import) directive
* * * * * root /root/markup-clone/scripts/markup-caddy-guard.sh
EOF
```

**Prevention:** use `<<'EOF'` (quoted) for any heredoc that contains shell metacharacters in comments, examples, or pasted code. Use bare `<<EOF` only when you explicitly want `$VAR` and `$(cmd)` substitution.

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
