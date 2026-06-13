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

mkdir -p "$(dirname "$LOG")"

log() { echo "[$(date -Iseconds)] $*" | tee -a "$LOG"; }
fail() { log "FAIL: $*"; exit 1; }

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
docker exec "$PG_CONTAINER" sh -c "
  if ! grep -q '172.20.0.0/16' /var/lib/postgresql/data/pg_hba.conf 2>/dev/null; then
    echo 'host    all             all             172.20.0.0/16            trust' >> /var/lib/postgresql/data/pg_hba.conf
    kill -HUP \$(cat /var/lib/postgresql/data/postmaster.pid | head -1) 2>/dev/null || true
    echo 'pg_hba updated for markup-net trust'
  fi
" || true

# --- 4b. Caddy route sync + reload ---
# Make sure /opt/caddy/Caddyfile has a route for the public hostname.
# PUBLIC_HOSTNAME env var (default markup.ashbi.ca) controls what gets added.
CADDYFILE="/opt/caddy/Caddyfile"
PUBLIC_HOSTNAME="${PUBLIC_HOSTNAME:-markup.ashbi.ca}"
if [ -f "$CADDYFILE" ]; then
  if ! grep -qE "^${PUBLIC_HOSTNAME//./\\.}\s*\{" "$CADDYFILE"; then
    log "Adding Caddy route for ${PUBLIC_HOSTNAME} -> 127.0.0.1:${HOST_PORT}"
    cat >> "$CADDYFILE" <<EOF

# ${APP_NAME} (auto-added by deploy.sh)
${PUBLIC_HOSTNAME} {
    reverse_proxy 127.0.0.1:${HOST_PORT}
}
EOF
    # New Caddyfile entry is on disk. Caddy was started with
    # `caddy run --config /opt/caddy/Caddyfile`; reload so it
    # actually picks the new route up. Without this, the file
    # change is invisible to the running process and the
    # dashboard shows "connection refused" until the operator
    # manually runs `systemctl reload caddy`.
    if command -v systemctl >/dev/null 2>&1; then
      log "Reloading caddy to pick up the new route"
      systemctl reload caddy 2>/dev/null || log "WARN: systemctl reload caddy failed; route is in Caddyfile but not yet active"
    elif pgrep -f "caddy reload" >/dev/null 2>&1; then
      log "Reloading caddy via caddy CLI"
      caddy reload --config "$CADDYFILE" 2>/dev/null || log "WARN: caddy reload failed"
    fi
  fi
else
  log "WARN: $CADDYFILE not found, creating it"
  mkdir -p "$(dirname "$CADDYFILE")"
  touch "$CADDYFILE"
  # Now re-run the route check (the file is empty, so the route isn't there yet)
  if ! grep -qE "^${PUBLIC_HOSTNAME//./\\.}\s*\{" "$CADDYFILE"; then
    log "Adding Caddy route for ${PUBLIC_HOSTNAME} -> 127.0.0.1:${HOST_PORT}"
    cat >> "$CADDYFILE" <<EOF

# ${APP_NAME} (auto-added by deploy.sh)
${PUBLIC_HOSTNAME} {
    reverse_proxy 127.0.0.1:${HOST_PORT}
}
EOF
  fi
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
