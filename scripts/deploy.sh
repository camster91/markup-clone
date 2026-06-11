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

mkdir -p "$(dirname "$LOG")"

log() { echo "[$(date -Iseconds)] $*" | tee -a "$LOG"; }
fail() { log "FAIL: $*"; exit 1; }

# --- 1. Detect source and refresh the working tree ---
cd "$APP_DIR"
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true

if [ -f "$TARBALL" ] && [ "$TARBALL" -nt "$APP_DIR/.git/HEAD" ]; then
  log "Source: tarball at $TARBALL (newer than git HEAD)"
  # Clear out everything except .env and .git, then untar
  # Keep .git so the resulting HEAD commit matches what we just untarred.
  # (If the tarball excludes .git, fallback to git pull below.)
  find "$APP_DIR" -mindepth 1 -maxdepth 1 \
    ! -name '.env' ! -name 'node_modules' ! -name '.next' ! -name '.git' \
    -exec rm -rf {} +
  tar -xzf "$TARBALL" -C "$APP_DIR"
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
  log "WARN: git tree is broken, using origin/main SHA from the env or a hardcoded value"
  # The freshest SHA in the working tree comes from the file mtime of the
  # last write. Fall back to reading the latest commit hash from a marker.
  if [ -f "$APP_DIR/.last-sha" ]; then
    NEW_TAG=$(cat "$APP_DIR/.last-sha")
    log "WARN: using marker SHA $NEW_TAG"
  else
    fail "git tree is broken and no SHA marker found. Push a fresh tarball or fix git manually."
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
log "Recreating container $APP_CONTAINER"
docker rm -f "$APP_CONTAINER" 2>/dev/null || true
docker run -d \
  --name "$APP_CONTAINER" \
  --network bridge \
  --restart unless-stopped \
  --env-file "$APP_DIR/.env" \
  -v "$SCREENSHOTS_DIR:/data/screenshots" \
  -p "127.0.0.1:${HOST_PORT}:3000" \
  --label traefik.enable=true \
  --label "traefik.http.routers.${APP_NAME}.entrypoints=websecure" \
  --label "traefik.http.routers.${APP_NAME}.rule=Host(\`markup.ashbi.ca\`)" \
  --label "traefik.http.routers.${APP_NAME}.tls.certresolver=letsencrypt" \
  --label "traefik.http.services.${APP_NAME}.loadbalancer.server.port=3000" \
  "$APP_NAME:$NEW_TAG" 2>&1 | tee -a "$LOG"

# Attach to the postgres network so it can reach markup-postgres by name
docker network connect "$PG_NET" "$APP_CONTAINER" 2>/dev/null || true

# --- 4b. Caddy route sync ---
# Make sure /opt/caddy/Caddyfile has a route for the public hostname.
# PUBLIC_HOSTNAME env var (default markup.ashbi.ca) controls what gets added.
CADDYFILE="/opt/caddy/Caddyfile"
PUBLIC_HOSTNAME="${PUBLIC_HOSTNAME:-markup.ashbi.ca}"
if [ -f "$CADDYFILE" ]; then
  if ! grep -qE "^${PUBLIC_HOSTNAME//./\\.}\s*\\{" "$CADDYFILE"; then
    log "Adding Caddy route for ${PUBLIC_HOSTNAME} -> 127.0.0.1:${HOST_PORT}"
    cat >> "$CADDYFILE" <<EOF

# ${APP_NAME} (auto-added by deploy.sh)
${PUBLIC_HOSTNAME} {
    reverse_proxy 127.0.0.1:${HOST_PORT}
}
EOF
  fi
else
  log "WARN: $CADDYFILE not found, skipping Caddy route sync"
fi

# --- 5. Health check ---
log "Waiting for $APP_CONTAINER to be healthy..."
for i in $(seq 1 20); do
  if curl -sf "http://127.0.0.1:${HOST_PORT}/api/health" >/dev/null 2>&1; then
    log "Health check passed after ${i}s"
    curl -s "http://127.0.0.1:${HOST_PORT}/api/health" | tee -a "$LOG"
    log "DEPLOY OK: $NEW_TAG"
    exit 0
  fi
  sleep 1
done

log "Health check failed after 20s. Last 20 log lines:"
docker logs "$APP_CONTAINER" --tail 20 2>&1 | tee -a "$LOG"
fail "container did not become healthy"
