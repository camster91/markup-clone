#!/usr/bin/env bash
# Deploy markup-clone to the Ashbi fleet VPS.
# Source: the host's authenticated Git checkout.
# Idempotent: safe to re-run.
#
# Usage: ssh coolify "cd /root/markup-clone && git pull --ff-only && bash scripts/deploy.sh"
#
# Required on the host (created by an earlier deploy):
#   /root/markup-clone/.env      - DATABASE_URL, MUP_API_KEY-equivalent, MATON_*, etc.
#   /opt/traefik/dynamic/routers.yml or legacy Caddy route for markup.ashbi.ca
#   /data/screenshots            - bind-mounted to the container at /data/screenshots
#   /data/markup-clone/postgres  - the markup-postgres volume (or external volume name)
#
# What this script does, in order:
#   1. Fast-forward the authenticated Git checkout and verify it is clean
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
PUBLIC_HOSTNAME="${PUBLIC_HOSTNAME:-markup.ashbi.ca}"
LOG="/var/log/markup-deploy.log"
SCREENSHOTS_DIR="/data/screenshots"
BACKUPS_DIR="/data/markup-clone/backups"

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

# Run the orphan-caddy guard BEFORE we refresh source, build the
# image, or do anything else. If the systemd caddy is going to fail
# to bind :443 because of an orphan, we want to know now — not 4
# minutes into a deploy.
[ -f "$APP_DIR/scripts/edge-proxy-preflight.sh" ] \
  || fail "missing edge-proxy-preflight.sh"
EDGE_PROXY=$(bash "$APP_DIR/scripts/edge-proxy-preflight.sh" detect)
log "Detected edge proxy: $EDGE_PROXY"
if [ "$EDGE_PROXY" = "caddy" ]; then
  cleanup_caddy_orphans
else
  log "Traefik owns public ingress; skipping legacy Caddy process cleanup"
fi

# Ensure the postgres container exists and is running before we try to talk
# to it. Three branches, in order:
#   1. docker ps shows the container running           -> do nothing
#   2. docker ps empty, docker inspect shows it exists -> docker start
#   3. docker ps empty, docker inspect empty           -> docker run (create)
#
# Branch 3 fires when the host was rebuilt or the volume is on a fresh
# box. The original script only handled branch 2 (`docker start`); on
# a host with no markup-postgres container at all, `docker start` would
# fail with "No such container" and migrations would silently skip.
# Creating it from scratch here makes the script self-bootstrapping.
#
# Branch 3 reads POSTGRES_PASSWORD from /root/markup-clone/.env (it
# lives in the DATABASE_URL). We use python3 to extract it, not a
# shell pipe with `cut`/`awk`/regex, for two reasons:
#   (a) DATABASE_URL is a URL; urlparse is the only correct parser.
#       Shell regexes get passwords-with-special-chars wrong (e.g.
#       `p@ss:wo!rd` round-trips through sed with surprising results).
#   (b) The chat-layer-redaction-workarounds skill documents that
#       bash heredocs with $(...) in the body misparse on the way
#       through the terminal tool; python3 << 'PYEOF' with a
#       single-quoted delimiter is the verified-safe path for
#       reading credential-bearing files on a remote.
# We use `printf %q` to escape the password back into a shell-safe
# token, so the value is never exposed to argv expansion or word
# splitting downstream. The script never logs it; the only places
# the value lives are inside the running python process and the
# one-shot docker run argv.
PG_DATA_DIR="${PG_DATA_DIR:-/data/markup-clone/postgres}"
PG_IMAGE="${PG_IMAGE:-postgres:16-alpine}"
PG_USER_VALUE="${PG_USER_VALUE:-markup}"
PG_DB_VALUE="${PG_DB_VALUE:-markup_db}"
PG_ENV_FILE="${PG_ENV_FILE:-$APP_DIR/.env}"

read_pg_password() {
  # Extract the password component from DATABASE_URL in $PG_ENV_FILE.
  # Returns a shell-safe quoted/escaped token (printf %q output) so
  # callers can splat it back into a docker run argv without exposing
  # it to word splitting or glob expansion. Empty output -> file is
  # missing or DATABASE_URL is malformed; caller is expected to fail.
  python3 <<'PYEOF'
import os, sys
from urllib.parse import urlparse
env_path = os.environ.get("PG_ENV_FILE", "/root/markup-clone/.env")
try:
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            if k.strip() == "DATABASE_URL":
                v = v.strip().strip('"').strip("'")
                pw = urlparse(v).password or ""
                # printf %q -> bash-safe single-quoted/escaped token
                sys.stdout.write(pw.replace("'", "'\\''"))
                sys.exit(0)
except FileNotFoundError:
    pass
sys.exit(1)
PYEOF
}

if docker ps --filter "name=^${PG_CONTAINER}$" --format '{{.Names}}' | grep -q "${PG_CONTAINER}"; then
  : # branch 1: already running, nothing to do
elif docker inspect "${PG_CONTAINER}" >/dev/null 2>&1; then
  log "WARN: ${PG_CONTAINER} is stopped, starting it"
  docker start "${PG_CONTAINER}" 2>&1 || log "WARN: failed to start ${PG_CONTAINER}; migrations will skip"
  sleep 2
else
  log "${PG_CONTAINER} does not exist; creating it from ${PG_IMAGE}"
  mkdir -p "${PG_DATA_DIR}"
  if ! PG_ENV_FILE="${PG_ENV_FILE}" read_pg_password; then
    log "WARN: could not read DATABASE_URL from ${PG_ENV_FILE}; cannot create ${PG_CONTAINER}"
    log "WARN: migrations will skip"
  else
    PG_PW_Q=$(PG_ENV_FILE="${PG_ENV_FILE}" read_pg_password)
    docker run -d \
      --name "${PG_CONTAINER}" \
      --network bridge \
      --restart unless-stopped \
      -e "POSTGRES_USER=${PG_USER_VALUE}" \
      -e "POSTGRES_PASSWORD=${PG_PW_Q}" \
      -e "POSTGRES_DB=${PG_DB_VALUE}" \
      -v "${PG_DATA_DIR}:/var/lib/postgresql/data" \
      "${PG_IMAGE}" 2>&1 | tee -a "$LOG"
    # Give postgres a moment to initialize the data directory before
    # the migration step (or the trust-rule step further down) tries
    # to docker exec psql into it.
    sleep 5
    # Wait for pg_isready, up to ~15s, so we don't race the migrations.
    for i in $(seq 1 15); do
      if docker exec "${PG_CONTAINER}" pg_isready -U "${PG_USER_VALUE}" -d "${PG_DB_VALUE}" >/dev/null 2>&1; then
        log "${PG_CONTAINER} is ready after ${i}s"
        break
      fi
      sleep 1
    done
  fi
fi

# Ensure the postgres container is configured to auto-restart. Without this,
# a host reboot or daemon restart leaves postgres down until the next deploy.
# (Coolify's default restart policy is 'no' for managed containers. Also
# applies to containers we just created in the branch-3 path above.)
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


# --- 1. Refresh and verify the release working tree ---
cd "$APP_DIR"
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true

[ -d "$APP_DIR/.git" ] || fail "release checkout is not a Git repository"
log "Source: git pull --ff-only"
if ! git pull --ff-only 2>&1 | tee -a "$LOG"; then
  fail "git pull --ff-only failed; refusing to build stale source"
fi

# A source-SHA tag is valid only when Git can prove the exact commit and the
# pulled tree matches it. Marker files and caller-provided labels are
# not accepted as release provenance.
if ! git rev-parse --verify HEAD >/dev/null 2>&1 || git status -s 2>&1 | grep -q "fatal: unable to read tree"; then
  fail "release source must resolve to a valid Git commit"
fi
# A source-SHA image tag is trustworthy only when every tracked and untracked
# build input belongs to that commit. Refuse dirty checkouts instead of silently
# labeling uncommitted code with the previous commit's SHA.
if [ -n "$(git status --porcelain --untracked-files=all)" ]; then
  fail "release source tree is dirty; commit the exact release contents before deploying"
fi
NEW_TAG=$(git rev-parse HEAD)
[ ${#NEW_TAG} -eq 40 ] || fail "git rev-parse returned non-SHA: $NEW_TAG"
log "Building image tag: $NEW_TAG"

# Before migrations or container replacement, prove the currently running
# application can be addressed by its immutable source-SHA image tag. The
# preflight also records the exact tag and image ID atomically for the operator.
# A first install has no prior container and therefore no rollback image; every
# upgrade fails closed when its existing image cannot be verified.
ROLLBACK_IMAGE_FILE="${ROLLBACK_IMAGE_FILE:-/data/markup-clone/rollback-image.env}"
if docker inspect "$APP_CONTAINER" >/dev/null 2>&1; then
  [ -f "$APP_DIR/scripts/rollback-image-preflight.sh" ] || \
    fail "missing rollback-image-preflight.sh"
  log "Verifying retained rollback image before migrations"
  APP_NAME="$APP_NAME" \
    APP_CONTAINER="$APP_CONTAINER" \
    ROLLBACK_IMAGE_FILE="$ROLLBACK_IMAGE_FILE" \
    bash "$APP_DIR/scripts/rollback-image-preflight.sh" 2>&1 | tee -a "$LOG"
  log "Verifying current public route and trusted TLS before migrations"
  EDGE_PROXY="$EDGE_PROXY" \
    PUBLIC_HOSTNAME="$PUBLIC_HOSTNAME" \
    HOST_PORT="$HOST_PORT" \
    bash "$APP_DIR/scripts/edge-proxy-preflight.sh" verify 2>&1 | tee -a "$LOG"
else
  log "First install: no existing $APP_CONTAINER container to retain for rollback"
fi

# --- 2. Apply pending Prisma migrations ---
# Migrations dir on the host may not match the local one if multiple deploys happened.
# Find the migration directory and apply any unrun ones.
MIG_DIR="$APP_DIR/prisma/migrations"
[ -d "$MIG_DIR" ] || fail "no migrations dir at $MIG_DIR"

# A newly created PostgreSQL database has no Prisma history table yet. Create
# the Prisma 6-compatible table before querying or recording raw SQL migrations.
# IF NOT EXISTS keeps this a no-op for every existing deployment.
docker exec -i "$PG_CONTAINER" \
  psql -v ON_ERROR_STOP=1 -U "$PG_USER_VALUE" -d "$PG_DB_VALUE" <<'SQL'
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" VARCHAR(36) NOT NULL,
  "checksum" VARCHAR(64) NOT NULL,
  "finished_at" TIMESTAMPTZ,
  "migration_name" VARCHAR(255) NOT NULL,
  "logs" TEXT,
  "rolled_back_at" TIMESTAMPTZ,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "_prisma_migrations_pkey" PRIMARY KEY ("id")
);
SQL

# Detect which migrations have been applied
APPLIED=$(docker exec "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 \
  -U "$PG_USER_VALUE" -d "$PG_DB_VALUE" -t -A \
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
    HAS_KEY=$(docker exec "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 \
      -U "$PG_USER_VALUE" -d "$PG_DB_VALUE" -t -A \
      -c "SELECT 1 FROM information_schema.columns WHERE table_name='Project' AND column_name='apiKey'" 2>/dev/null | tr -d '[:space:]')
    if [ "$HAS_KEY" = "1" ]; then
      log "Skipping legacy migration $mig_name (apiKey column already exists)"
      docker exec "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 \
        -U "$PG_USER_VALUE" -d "$PG_DB_VALUE" -c \
        "INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, applied_steps_count) VALUES (gen_random_uuid()::text, 'baseline', NOW(), '$mig_name', 1) ON CONFLICT DO NOTHING" >/dev/null
      continue
    fi
  fi
  if [ -f "$mig_dir/migration.sql" ]; then
    [ -f "$APP_DIR/scripts/apply-migration.sh" ] || fail "missing apply-migration.sh"
    log "Applying migration atomically: $mig_name"
    PG_CONTAINER="$PG_CONTAINER" \
      PG_USER_VALUE="$PG_USER_VALUE" \
      PG_DB_VALUE="$PG_DB_VALUE" \
      bash "$APP_DIR/scripts/apply-migration.sh" \
        "$mig_name" "$mig_dir/migration.sql" 2>&1 | tee -a "$LOG"
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
  -v "$BACKUPS_DIR:/data/backups" \
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
# own deploy.sh that also writes to it. Markup's strategy is to
# re-add the markup.ashbi.ca route on every deploy, and the
# every-minute markup-caddy-guard cron is a backstop in case a
# fleet-wide edit wipes the file between deploys.
#
# The "import /opt/caddy/markup.d/caddyfile" approach (M1 / t_248e6685)
# was tried and reverted. Caddy v2's `import` directive is for JSON
# config, not Caddyfile site blocks — when the imported file contains
# `markup.ashbi.ca { reverse_proxy ... }`, Caddy errors with
# "unrecognized directive: markup.ashbi.ca". The Caddyfile-import
# pattern would require either running a separate Caddy instance
# (different port) or converting the fragment to JSON. The every-minute
# inline-route guard is the right operational tradeoff for now.
add_markup_route() {
  local file="$1"
  [ -z "$file" ] && return 1
  if ! grep -qE "^${PUBLIC_HOSTNAME//./\\.}\s*\{" "$file" 2>/dev/null; then
    log "Adding Caddy route for ${PUBLIC_HOSTNAME} -> 127.0.0.1:${HOST_PORT} (in $file)"
    mkdir -p "$(dirname "$file")"
    touch "$file"
    cat >> "$file" <<EOF

# ${APP_NAME} (auto-added by deploy.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ))
${PUBLIC_HOSTNAME} {
    reverse_proxy 127.0.0.1:${HOST_PORT}
}
EOF
  fi
}

if [ "$EDGE_PROXY" = "caddy" ]; then
# Persist to BOTH the systemd-override file (live read by caddy) and
# the /etc/caddy base (so a fleet-wide overwrite doesn't lose us).
for CADDYFILE in /opt/caddy/Caddyfile /etc/caddy/Caddyfile; do
  add_markup_route "$CADDYFILE"
done

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
else
  log "Traefik route is managed outside this deploy; no edge configuration was mutated"
fi

# --- 5. Health check ---
log "Waiting for $APP_CONTAINER to be healthy..."
for i in $(seq 1 20); do
  if curl -sf "http://127.0.0.1:${HOST_PORT}/api/health" >/dev/null 2>&1; then
    log "Health check passed after ${i}s"
    curl -s "http://127.0.0.1:${HOST_PORT}/api/health" | tee -a "$LOG"
    log "Rechecking public route and trusted TLS"
    EDGE_PROXY="$EDGE_PROXY" \
      PUBLIC_HOSTNAME="$PUBLIC_HOSTNAME" \
      HOST_PORT="$HOST_PORT" \
      bash "$APP_DIR/scripts/edge-proxy-preflight.sh" verify 2>&1 | tee -a "$LOG"
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
