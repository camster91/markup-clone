#!/usr/bin/env bash
# Install the markup-clone cron jobs (prune + Caddy guard).
#
# Two jobs are installed:
#
# 1. /etc/cron.d/markup-clone — daily 03:00 UTC prune of screenshots
#    older than 90 days. The DELETEs run inside the postgres
#    container, not directly on the host, and the cron is safe to
#    run while the app is serving.
#
# 2. /etc/cron.d/markup-caddy-guard — every-minute guard. The
#    Caddyfile at /opt/caddy/Caddyfile is shared across the Ashbi
#    fleet; other repos (simaqadeer-app, family-planner, etc.) have
#    their own deploy.sh scripts that also write to it.
#
#    Under the durable-import design (M1 / t_248e6685), the markup
#    route lives in /opt/caddy/markup.d/caddyfile and is loaded by
#    the master Caddyfile via `import /opt/caddy/markup.d/caddyfile`.
#    The markup.d file is owned by markup-clone and other services
#    have no reason to touch it. The guard's only remaining job is
#    to be a BACKSTOP for the import directive in the master
#    Caddyfile: re-add the import line if a fleet-wide edit wiped
#    it, restore the markup.d file from the ship-file if it was
#    deleted, and reload caddy. The primary defense is the import
#    itself; the cron is belt-and-suspenders.
#
# Both files are written idempotently (cat >) so re-running this
# script is safe. The deploy script also calls this on every
# successful healthcheck, so a fresh deploy onto an existing host
# sets up the crons automatically.
#
# Manual run: bash scripts/install-cron.sh

set -euo pipefail

APP_DIR="${APP_DIR:-/root/markup-clone}"
PRUNE_SCRIPT="$APP_DIR/scripts/prune-screenshots.sh"
PRUNE_LOG="/var/log/prune-screenshots.log"

if [ ! -f "$PRUNE_SCRIPT" ]; then
  echo "ERROR: $PRUNE_SCRIPT does not exist. Run deploy.sh first." >&2
  exit 1
fi

# Ensure the prune script is executable.
chmod +x "$PRUNE_SCRIPT"

# Idempotent install of the daily prune job.
cat > /etc/cron.d/markup-clone <<EOF
# /etc/cron.d/markup-clone
# Daily prune of screenshots older than 90 days.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 3 * * * root SCREENSHOT_DIR=/data/screenshots LOG_FILE=$PRUNE_LOG $PRUNE_SCRIPT >> $PRUNE_LOG 2>&1
EOF
chmod 644 /etc/cron.d/markup-clone

# Touch the log file so tail/grep on it doesn't 404 on day one.
touch "$PRUNE_LOG"
chmod 644 "$PRUNE_LOG"

# Idempotent install of the every-minute Caddy guard. The guard
# script is shipped in scripts/markup-caddy-guard.sh and made
# executable by deploy.sh's tarball-extract chmod loop.
GUARD_SCRIPT="$APP_DIR/scripts/markup-caddy-guard.sh"
if [ -f "$GUARD_SCRIPT" ]; then
  chmod +x "$GUARD_SCRIPT"
  GUARD_LOG="/var/log/markup-caddy-guard.log"
  cat > /etc/cron.d/markup-caddy-guard <<EOF
# /etc/cron.d/markup-caddy-guard
# Every-minute BACKSTOP guard for the durable-import pattern
# (M1 / t_248e6685). The primary defense is the
# `import /opt/caddy/markup.d/caddyfile` directive in
# /opt/caddy/Caddyfile; this cron only fires if a fleet-wide
# edit strips that line or deletes the owned-by-markup file.
# See scripts/markup-caddy-guard.sh for the full design.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
* * * * * root $GUARD_SCRIPT >> $GUARD_LOG 2>&1
EOF
  chmod 644 /etc/cron.d/markup-caddy-guard
  touch "$GUARD_LOG"
  chmod 644 "$GUARD_LOG"
  echo "Installed $GUARD_SCRIPT (every-minute guard, backstop role)"
  echo "Next run: top of the next minute. Log: $GUARD_LOG"
else
  echo "WARN: $GUARD_SCRIPT not found, skipping caddy-guard install (run deploy.sh first)"
fi

echo "Installed /etc/cron.d/markup-clone:"
cat /etc/cron.d/markup-clone
echo
echo "Next prune run: 03:00 UTC. Manual run: bash $PRUNE_SCRIPT"
