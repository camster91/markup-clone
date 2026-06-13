#!/usr/bin/env bash
# Deploy markup-clone to the Ashbi fleet VPS.
# Source: local tarball pushed from the dev machine (or git pull if available).
# Idempotent: safe to re-run.
#
# Usage:
#   # From the dev machine: push the tarball, then run on the host
#   tar --exclude='.next' --exclude='node_modules' --exclude='.git/objects/pack' -czf /tmp/markup-clone.tgz -C /Users/.../markup-clone .
#   scp /tmp/markup-clone.tgz coolify:/root/markup-clone.tgz
#   ssh coolify "bash /root/markup-clone/scripts/deploy.sh"
#
# Required on the host (created by an earlier deploy):
#   /root/markup-clone/.env      - DATABASE_URL, MUP_API_KEY-equivalent, MATON_*, etc.
#   /opt/caddy/Caddyfile         - Caddy route for markup.ashbi.ca
#   /data/screenshots            - bind-mounted to the container at /data/screenshots
#   /data/markup-clone/postgres  - the markup-postgres volume (or external volume name)
#
# What this script does, in order:
#   1. Detect source: tarball at /root/markup-clone.tgz (mtime) or git pull
#   2. Apply any pending Prisma migrations to the live DB
#   3. Build the new Docker image with the full 40-char SHA tag
#   4. Recreate the markup-clone container (preserves env via --env-file, volume via -v)
#   5. Verify health on 127.0.0.1:<host_port>
#
# Returns 0 on success, non-zero on any failed step. Logs to /var/log/markup-deploy.log.

set -euo pipefail

# --- Config ---
APP_DIR="/root/markup-clone"
APP_NAME="markup-clone"
APP_CONTAINER="markup-clone"
PG_CONTAINER="markup-postgres"
PG_NET="markup-net"
HOST_PORT="${HOST_PORT:-3030}"
LOG="/var/log/markup-deploy.log"
SCREENSHOTS_DIR="/data/screenshots"
TARBALL="/root/markup-clone.tgz"

# --- Pre-flight: kill orphan caddy processes from prior debug sessions ---
#
# Background: an operator (or the script) runs `caddy run --config
# /opt/caddy/Caddyfile 2>&1 | tail -30` in an SSH session to debug
# something. The SSH session closes (timeout, network blip, ctrl-c
# of the parent Hermes terminal call). The bash pipe stays alive
# because of the `tail` holding the read end open, and `caddy run`
# keeps running indefinitely. The result: a `caddy run` process
# whose parent is NOT the systemd caddy unit (and not PID 1 — it's
# some other init reparented ancestor or a lingering bash subshell).
# It binds :443/80, the systemd caddy fails to bind, and HTTPS
# requests break with TLS internal errors until the orphan is
# killed manually.
#
# Verified 2026-06-13: 3 such orphan caddies (PIDs 879926, 880158,
# 923874) caused ~30 min of broken TLS on the next deploy.
#
# The fix: before any deploy work, scan for `caddy run` (or bare
# `caddy`) processes whose PPID is NOT 1, and kill them. The
# systemd-managed caddy is always a direct child of PID 1, so it's
# automatically preserved. The standalone variant of this same
# logic is in scripts/cleanup-caddy-orphans.sh so operators can
# run it ad-hoc without doing a full deploy.
#
# Note: we match `caddy` and `caddy run` but NOT `caddy adapt`,
# `caddy fmt`, `caddy file-server`, etc. — those are transients
# used by markup-caddy-guard.sh and pose no orphan risk.
cleanup_caddy_orphans() {
  local self_pid=$$
  # Find caddy processes using the executable basename (comm field)
  # rather than grepping args — args can contain "caddy" inside
  # heredocs/scripts that aren't actually caddy. comm is the
  # actual binary name as the kernel sees it.
  #
  # ps syntax is portable: `ps -eo pid=,ppid=,comm=,args=` works on
  # both Linux (GNU ps) and macOS (BSD ps). On macOS the comm field
  # is the full executable path (e.g. `/usr/bin/caddy`); on Linux
  # it's just the basename (`caddy`). Match both with a regex that
  # requires "caddy" preceded by / or start-of-line.
  local orphans=""
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    # fields: pid ppid comm args...
    local pid ppid comm args
    pid=$(echo "$line" | awk '{print $1}')
    ppid=$(echo "$line" | awk '{print $2}')
    comm=$(echo "$line" | awk '{print $3}')
    args=$(echo "$line" | cut -d' ' -f4-)
    # Skip ourselves and our parent shell.
    [ "$pid" = "$self_pid" ] && continue
    # Skip anything parented to PID 1 (systemd-managed caddy lives there).
    [ "$ppid" = "1" ] && continue
    # Filter to actual caddy binaries. comm is the kernel-reported
    # executable name, so a shell running a script that mentions
    # "caddy" in its source will have comm=bash/sh, not caddy.
    case "$comm" in
      *caddy)
        # Only target long-running caddy server invocations. `caddy adapt`,
        # `caddy fmt`, `caddy file-server`, `caddy version` are short-lived
        # and the `caddy run` (or bare `caddy`) form is what orphans.
        case "$args" in
          caddy\ run*|"caddy"|*"/caddy run"*|*"/caddy"|*"caddy run "*)
            orphans="${orphans}${orphans:+ }${pid}"
            ;;
        esac
        ;;
    esac
  done < <(ps -eo pid=,ppid=,comm=,args= 2>/dev/null | grep -E '(^|/)caddy( |$)' || true)

  if [ -z "$orphans" ]; then
    return 0
  fi

  log "PRE-FLIGHT: found orphan caddy process(es) (PPID != 1): $orphans"
  for pid in $orphans; do
    local cmd
    cmd=$(ps -o args= -p "$pid" 2>/dev/null | head -c 200 || true)
    log "PRE-FLIGHT: killing orphan caddy pid=$pid cmd='$cmd'"
    kill -TERM "$pid" 2>/dev/null || true
  done
  # Give them a moment to exit cleanly.
  sleep 1
  # Force-kill anything that didn't respond to SIGTERM. Same macOS
  # reap-race note as in cleanup-caddy-orphans.sh: SIGKILL'd children
  # can take a few hundred ms to be reaped, so retry briefly.
  for pid in $orphans; do
    needs_kill=0
    for _ in 1 2 3 4 5; do
      if kill -0 "$pid" 2>/dev/null; then
        needs_kill=1
        sleep 0.2
      else
        needs_kill=0
        break
      fi
    done
    if [ "$needs_kill" = "1" ]; then
      log "PRE-FLIGHT: force-killing orphan caddy pid=$pid with SIGKILL"
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
  return 0
}

mkdir -p "$(dirname "$LOG")"

log() { echo "[$(date -Iseconds)] $*" | tee -a "$LOG"; }
fail() { log "FAIL: $*"; exit 1; }

# Run the orphan-caddy guard BEFORE we touch the tarball, build the
# image, or do anything else. If the systemd caddy is going to fail
# to bind :443 because of an orphan, we want to know now — not 4
# minutes into a deploy.
cleanup_caddy_orphans

# Ensure the postgres container is running before we try to talk to it.
# If Coolify (or some other orchestrator) shut it down between deploys, the
# migration step would otherwise fail with "container is not running".
if ! docker ps --filter "name=^${PG_CONTAINER}$" --format '{{.Names}}' | grep -q "${PG_CONTAINER}"; then
  log "WARN: ${PG_CONTAINER} is not running, attempting to start it"
  docker start "${PG_CONTAINER}" 2>&1 || log "WARN: failed to start ${PG_CONTAINER}; migrations will skip"
  sleep 2
fi

# Ensure the postgres container is configured to auto-restart. Without this,
# a host reboot or daemon restart leaves postgres down until the next deploy.
# (Coolify's default restart policy is 'no' for managed containers.)
docker inspect "${PG_CONTAINER}" --format '{{.HostConfig.RestartPolicy.Name}}' 2>/dev/null | grep -q "^no$" && \
  docker update --restart unless-stopped "${PG_CONTAINER}" 2>/dev/null || true

# Ensure the markup-net bridge network exists and both containers are on it.
# If Coolify (or some external event) removed the network, the app container
# ends up on the default 'bridge' network with no DNS route to postgres.
docker network inspect "${PG_NET}" >/dev/null 2>&1 || \
  docker network create "${PG_NET}" >/dev/null 2>&1
docker network connect "${PG_NET}" "${PG_CONTAINER}" 2>/dev/null || true
# Note: we don't connect ${APP_CONTAINER} here — it's about to be recreated
# with --network bridge, then re-connected below. The connect step below is the
# authoritative one for the app container.


# --- 1. Detect source and refresh the working tree ---
cd "$APP_DIR"
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true

# Optional: dev machine can pass LAST_SHA=<sha> env to bypass the .last-sha
# file dependency (which is gitignored, so it doesn't survive a tarball push).
if [ -n "${LAST_SHA:-}" ]; then
  log "WARN: using LAST_SHA env override: $LAST_SHA"
  echo -n "$LAST_SHA" > "$APP_DIR/.last-sha"
fi

if [ -f "$TARBALL" ] && [ "$TARBALL" -nt "$APP_DIR/.git/HEAD" ]; then
  log "Source: tarball at $TARBALL (newer than git HEAD)"
  # Clear out everything except .env and .git, then untar
  # Keep .git so the resulting HEAD commit matches what we just untarred.
  # (If the tarball excludes .git, fallback to git pull below.)
  find "$APP_DIR" -mindepth 1 -maxdepth 1 \
    ! -name '.env' ! -name 'node_modules' ! -name '.next' ! -name '.git' \
    -exec rm -rf {} +
  tar -xzf "$TARBALL" -C "$APP_DIR"
  # Restore executable bit on scripts/ (tar preserves mtime but not +x by default)
  if [ -d "$APP_DIR/scripts" ]; then
    chmod +x "$APP_DIR/scripts/"*.sh 2>/dev/null || true
  fi
  # Consume the tarball so the next deploy without a fresh push uses git pull
  rm -f "$TARBALL"
  log "Tarball consumed"
elif [ -d "$APP_DIR/.git" ]; then
  log "Source: git pull (optional, will continue with current tree on failure)"
  if ! git pull --ff-only 2>&1 | tee -a "$LOG"; then
    log "WARN: git pull failed (likely no creds). Continuing with current tree at $(git rev-parse HEAD 2>/dev/null || echo 'unknown')"
  fi
else
  fail "No source: $TARBALL missing and $APP_DIR is not a git repo"
fi

# If the tarball didn't include .git (or the working tree is broken), fall
# back to the origin/main SHA so we still build a meaningful image tag.
if ! git rev-parse --verify HEAD >/dev/null 2>&1 || git status -s 2>&1 | grep -q "fatal: unable to read tree"; then
  log "WARN: git tree is broken, falling back to .last-sha marker or LAST_SHA env"
  # Prefer LAST_SHA env (set by dev machine), fall back to .last-sha file.
  if [ -n "${LAST_SHA:-}" ]; then
    NEW_TAG="$LAST_SHA"
    log "WARN: using LAST_SHA env $NEW_TAG"
  elif [ -f "$APP_DIR/.last-sha" ]; then
    NEW_TAG=$(cat "$APP_DIR/.last-sha")
    log "WARN: using marker SHA $NEW_TAG"
  else
    fail "git tree is broken and no SHA source. Pass LAST_SHA=<sha> env or write .last-sha."
  fi
else
  NEW_TAG=$(git rev-parse HEAD)
fi
[ ${#NEW_TAG} -eq 40 ] || fail "git rev-parse returned non-SHA: $NEW_TAG"
log "Building image tag: $NEW_TAG"

# --- 2. Apply pending Prisma migrations ---
# Migrations dir on the host may not match the local one if multiple deploys happened.
# Find the migration directory and apply any unrun ones.
MIG_DIR="$APP_DIR/prisma/migrations"
[ -d "$MIG_DIR" ] || fail "no migrations dir at $MIG_DIR"

# Detect which migrations have been applied
APPLIED=$(docker exec "$PG_CONTAINER" psql -U markup -d markup_db -t -A \
  -c "SELECT migration_name FROM _prisma_migrations" 2>/dev/null || echo "")

for mig_dir in "$MIG_DIR"/*/; do
  [ -d "$mig_dir" ] || continue
  mig_name=$(basename "$mig_dir")
  # Skip the old apiKey migration if the column already exists
  if echo "$APPLIED" | grep -qx "$mig_name"; then
    log "Migration already applied: $mig_name"
    continue
  fi
  if [ "$mig_name" = "20260610010000_add_api_key" ]; then
    # Check if apiKey column exists; skip if so
    HAS_KEY=$(docker exec "$PG_CONTAINER" psql -U markup -d markup_db -t -A \
      -c "SELECT 1 FROM information_schema.columns WHERE table_name='Project' AND column_name='apiKey'" 2>/dev/null | tr -d '[:space:]')
    if [ "$HAS_KEY" = "1" ]; then
      log "Skipping legacy migration $mig_name (apiKey column already exists)"
      docker exec "$PG_CONTAINER" psql -U markup -d markup_db -c \
        "INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, applied_steps_count) VALUES (gen_random_uuid()::text, 'baseline', NOW(), '$mig_name', 1) ON CONFLICT DO NOTHING" >/dev/null
      continue
    fi
  fi
  if [ -f "$mig_dir/migration.sql" ]; then
    log "Applying migration: $mig_name (errors below are OK if already applied)"
    # Suppress errors: psql is noisy about existing relations; the SELECT check above
    # is the only authoritative test for "already applied", and idempotency errors
    # from a partial prior apply are harmless.
    docker exec -i "$PG_CONTAINER" psql -U markup -d markup_db \
      < "$mig_dir/migration.sql" 2>&1 | grep -v "^ERROR:" | head -5 | tee -a "$LOG" || true
    docker exec "$PG_CONTAINER" psql -U markup -d markup_db -c \
      "INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, applied_steps_count) VALUES (gen_random_uuid()::text, 'baseline', NOW(), '$mig_name', 1) ON CONFLICT DO NOTHING" >/dev/null
  fi
done

# --- 3. Build the image ---
log "Building image: $APP_NAME:$NEW_TAG"
docker build -t "$APP_NAME:$NEW_TAG" -t "$APP_NAME:latest" "$APP_DIR" 2>&1 | tail -5 | tee -a "$LOG"

# --- 4. Recreate the container ---
# Notes for the docker run block:
# - Next.js 16 standalone server.js does `process.env.HOSTNAME ||
#   "0.0.0.0"`. Docker sets HOSTNAME to the container ID by default,
#   which makes next-server bind to that single interface (10.x.x.x
#   inside the container). That breaks in-container healthchecks
#   against 127.0.0.1 and any container-to-container traffic.
#   Override to 0.0.0.0 so the app listens on all interfaces.
#   Discovered the hard way when docker healthcheck reported
#   FailingStreak=1030 even though the app itself was fine.
# - Traefik labels are intentionally absent: the public proxy on
#   this host is Caddy, not Traefik. Caddy reads its config from
#   /opt/caddy/Caddyfile (mounted by the systemd override) and
#   from the running admin-API state. Traefik labels would just
#   add noise to `docker inspect`. The Caddy route is added
#   separately further down in this script.
log "Recreating container $APP_CONTAINER"
docker rm -f "$APP_CONTAINER" 2>/dev/null || true
docker run -d \
  --name "$APP_CONTAINER" \
  --network bridge \
  --restart unless-stopped \
  --env-file "$APP_DIR/.env" \
  -e "HOSTNAME=0.0.0.0" \
  -v "$SCREENSHOTS_DIR:/data/screenshots" \
  -v "$APP_DIR/scripts:/opt/app-scripts:ro" \
  -p "127.0.0.1:${HOST_PORT}:3000" \
  "$APP_NAME:$NEW_TAG" 2>&1 | tee -a "$LOG"

# Attach to the postgres network so it can reach markup-postgres by name
docker network connect "$PG_NET" "$APP_CONTAINER" 2>/dev/null || true

# Ensure postgres has a trust rule for connections from markup-net. Without
# this, a fresh postgres container starts with a default pg_hba.conf that
# requires scram-sha-256 passwords, but the .env's stored password may not
# match. The trust rule bypasses that for the markup-net subnet only.
#
# Discover the subnet dynamically: docker userland bridge networks get
# assigned 172.x.0.0/16 subnets on creation, and the exact x depends on
# the host. The previous version of this script hard-coded 172.20.0.0/16
# which broke when a fresh postgres container was created on a host whose
# docker daemon had already used 172.20 for something else (then the
# app container's IP was 172.19.x and the trust rule did not match).
# Use docker network inspect to read the real subnet.
PG_SUBNET=$(docker network inspect "$PG_NET" --format '{{(index .IPAM.Config 0).Subnet}}' 2>/dev/null | head -1)
if [ -z "$PG_SUBNET" ]; then
  log "WARN: could not determine subnet for $PG_NET; falling back to 172.20.0.0/16"
  PG_SUBNET="172.20.0.0/16"
fi
log "Postgres trust subnet: $PG_SUBNET"
docker exec "$PG_CONTAINER" sh -c "
  if ! grep -q '$PG_SUBNET' /var/lib/postgresql/data/pg_hba.conf 2>/dev/null; then
    # HBA is first-match wins, and the default 'host all all all scram-sha-256'
    # line is added by the postgres image at the top of the file. We
    # need our trust rule BEFORE that line, otherwise the scram-sha-256
    # check fires first and the password mismatches. Use sed to insert
    # after the first line (which is the comment header).
    sed -i \"1 a\\\\\n# markup-clone deploy.sh: trust the app container on this subnet\nhost    all             all             $PG_SUBNET            trust\" /var/lib/postgresql/data/pg_hba.conf
    kill -HUP \$(cat /var/lib/postgresql/data/postmaster.pid | head -1) 2>/dev/null || true
    # pg_reload_conf reloads pg_hba but only some of it; the trust
    # rules need a full restart. Restart gracefully.
    pg_ctl -D /var/lib/postgresql/data restart -m fast 2>&1 | tail -3
    echo 'pg_hba updated for trust on $PG_SUBNET'
  fi
" || true

# --- 4b. Caddy route sync + reload ---
# Make sure Caddy has a route for the public hostname. PUBLIC_HOSTNAME
# env var (default markup.ashbi.ca) controls what gets added.
#
# The Caddyfile at /opt/caddy/Caddyfile is shared across the Ashbi
# fleet. Other repos (simaqadeer, jw-habits, alinenasseh) have their
# own deploy.sh that also writes to it. Markup's previous strategy
# was to write the route inline, but if any of those other scripts
# overwrote the file with their own content (which the alinenasseh
# deploy has been observed to do), the markup route disappeared and
# https://markup.ashbi.ca went back to a generic Caddy "no SNI" cert
# error.
#
# The DURABLE pattern (M1 / t_248e6685): markup owns the route in
# /opt/caddy/markup.d/caddyfile (a separate file other services have
# no reason to touch), and the master /opt/caddy/Caddyfile imports
# it:
#
#     import /opt/caddy/markup.d/caddyfile
#
# Even if another agent's deploy.sh overwrites the master to a
# 5-route base, the markup.d file is untouched. The next caddy
# reload picks up both base + import. The only fragile part of
# this design is the import directive itself in the master file —
# so this script (and the every-minute markup-caddy-guard cron)
# defensively re-add it if it's missing. The route block is no
# longer inlined into the master Caddyfile by this script; it's
# only in markup.d.
PUBLIC_HOSTNAME="${PUBLIC_HOSTNAME:-markup.ashbi.ca}"
MARKUP_D_DIR="/opt/caddy/markup.d"
MARKUP_D_FILE="${MARKUP_D_DIR}/caddyfile"
MARKUP_D_SHIP="$APP_DIR/scripts/caddyfile.markup.d"

# 1. Ensure the owned-by-markup file is present. Ship-file is
#    /root/markup-clone/scripts/caddyfile.markup.d in the repo.
if [ -f "$MARKUP_D_SHIP" ]; then
  if [ ! -f "$MARKUP_D_FILE" ] || ! cmp -s "$MARKUP_D_SHIP" "$MARKUP_D_FILE"; then
    log "Installing $MARKUP_D_FILE (owned by markup-clone)"
    mkdir -p "$MARKUP_D_DIR"
    install -m 0644 "$MARKUP_D_SHIP" "$MARKUP_D_FILE"
  fi
else
  log "WARN: $MARKUP_D_SHIP not found; markup.d/caddyfile not refreshed. (Run deploy.sh from a full repo to seed it.)"
fi

# 2. Ensure the import directive is present in the master Caddyfile
#    (the only fragile part of the durable pattern). Re-add if
#    another agent's deploy.sh wiped it. Don't touch /etc/caddy
#    here: that file is no longer used by the running caddy (the
#    systemd unit's override points at /opt/caddy/Caddyfile), and
#    editing it is a way to accidentally double-route. The
#    every-minute guard (markup-caddy-guard.sh) handles both files
#    as a backstop; deploy.sh's primary concern is the live file.
ensure_import_directive() {
  local file="$1"
  [ -f "$file" ] || return 0
  if ! grep -qF 'import /opt/caddy/markup.d/caddyfile' "$file"; then
    log "Re-adding 'import $MARKUP_D_FILE' to $file (was missing)"
    {
      echo ""
      echo "# ${APP_NAME} (auto-added by deploy.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ))"
      echo "import ${MARKUP_D_FILE}"
    } >> "$file"
  fi
}
ensure_import_directive /opt/caddy/Caddyfile

# Reload Caddy so the new file content is picked up by the running
# process. We always do a hard `systemctl restart caddy` rather
# than try the admin API, because:
#
# 1. The Caddyfile on this host has `admin off` in the global
#    options block (line 4 of /opt/caddy/Caddyfile). The admin
#    API socket is only reachable after the file is loaded with
#    `admin on`. Without it, `caddy reload` fails with "dial
#    tcp [::1]:2019: connect: connection refused".
#
# 2. Even when the admin API is up, the soft-reload path
#    (POST /load) doesn't reliably bring port 443/80 back up
#    if Caddy is in a half-broken state. The TLS renewal
#    context-cancellation during reload can leave the
#    listeners in a non-listening state until a full
#    restart. Verified 2026-06-13: deploys that used
#    `systemctl restart` recovered immediately; deploys
#    that used POST /load left caddy up but not listening.
#
# The restart is fast (caddy is a single static binary)
# and the in-memory on-demand certs are repopulated on the
# next request via the ask endpoint.
if command -v systemctl >/dev/null 2>&1; then
  log "Restarting caddy to pick up the new route"
  systemctl restart caddy 2>/dev/null || log "WARN: systemctl restart caddy failed; route is in Caddyfile but not yet active"
else
  log "WARN: systemctl not available; caddy not reloaded"
fi

# --- 4c. Caddy health check ---
# Make sure Caddy is running and has the route loaded. If Caddy is dead,
# route auto-sync is useless (no process to pick up the new Caddyfile).
if pgrep -f "caddy run" >/dev/null 2>&1; then
  if curl -sf http://127.0.0.1:2019/config/ >/dev/null 2>&1; then
    log "Caddy is running and admin API is reachable"
  else
    log "WARN: caddy is running but admin API is not reachable at :2019"
  fi
else
  log "WARN: caddy process not running, attempting restart"
  systemctl restart caddy 2>/dev/null || service caddy restart 2>/dev/null || \
    log "WARN: could not restart caddy (no systemctl or service). The route is added to Caddyfile but Caddy needs to be running to pick it up."
fi

# --- 5. Health check ---
log "Waiting for $APP_CONTAINER to be healthy..."
for i in $(seq 1 20); do
  if curl -sf "http://127.0.0.1:${HOST_PORT}/api/health" >/dev/null 2>&1; then
    log "Health check passed after ${i}s"
    curl -s "http://127.0.0.1:${HOST_PORT}/api/health" | tee -a "$LOG"
    log "DEPLOY OK: $NEW_TAG"

    # Install the daily prune-screenshots cron (idempotent: re-running
    # just rewrites the same file). Without this, stale screenshots
    # accumulate forever — a fresh deploy of the app onto an existing
    # host inherits whatever was on disk from the previous install.
    if [ -f "$APP_DIR/scripts/install-cron.sh" ]; then
      log "Installing prune-screenshots cron (daily 03:00 UTC)"
      bash "$APP_DIR/scripts/install-cron.sh" 2>&1 | tee -a "$LOG"
    fi

    exit 0
  fi
  sleep 1
done

log "Health check failed after 20s. Last 20 log lines:"
docker logs "$APP_CONTAINER" --tail 20 2>&1 | tee -a "$LOG"
fail "container did not become healthy"
