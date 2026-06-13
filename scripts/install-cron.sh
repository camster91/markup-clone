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
# 2. /etc/cron.d/markup-caddy-guard — every-minute guard that
#    re-adds the markup.ashbi.ca Caddy route to both
#    /opt/caddy/Caddyfile and /etc/caddy/Caddyfile if a
#    fleet-wide edit wipes either file. Soft-reloads caddy
#    via the admin API when reachable, else systemctl restart.
#    The Caddyfile at /opt/caddy/Caddyfile is shared across the
#    Ashbi fleet; other repos (simaqadeer-app, family-planner, etc.)
#    have their own deploy.sh scripts that also write to it.
#
# Both files are written idempotently (cat >) so re-running this
# script is safe. The deploy script also calls this on every
# successful healthcheck, so a fresh deploy onto an existing host
# sets up the crons automatically.
#
# Note: the M1 "durable import via /opt/caddy/markup.d/caddyfile"
# approach was tried 2026-06-13 and reverted the same day
# (Caddy v2's `import` directive is for JSON config, not
# Caddyfile site blocks; an imported file with
# `markup.ashbi.ca { ... }` errors with "unrecognized
# directive"). The inline-route guard is the right tradeoff.
#
# Manual run: bash scripts/install-cron.sh
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
  # Write the cron file with a QUOTED heredoc delimiter so backticks
  # and `import` (a bash keyword in some configurations) in the
  # comment block don't get treated as command substitution or
  # invoked. Both heredocs in this script use quoted `<<'EOF'`
  # to disable parameter and command expansion inside.
  cat > /etc/cron.d/markup-caddy-guard <<'EOF'
# /etc/cron.d/markup-caddy-guard
# Every-minute guard that re-adds the markup.ashbi.ca Caddy
# route to /opt/caddy/Caddyfile and /etc/caddy/Caddyfile if
# a fleet-wide edit wipes it. Soft-reloads caddy via the admin
# API when reachable, else systemctl restart caddy. See
# scripts/markup-caddy-guard.sh for the full design.
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
