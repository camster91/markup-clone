#!/usr/bin/env bash
# Install the markup-clone cron jobs (prune + delivery worker + Caddy guard).
#
# Three jobs are installed:
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
# 3. /etc/cron.d/markup-integration-delivery — every-minute bounded
#    delivery worker invocation using the app container's dedicated secret.
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
EDGE_HELPER="$APP_DIR/scripts/edge-proxy-preflight.sh"
EDGE_PROXY="${EDGE_PROXY:-auto}"

if [ ! -f "$PRUNE_SCRIPT" ]; then
  echo "ERROR: $PRUNE_SCRIPT does not exist. Run deploy.sh first." >&2
  exit 1
fi

# Idempotent install of the daily prune job.
cat > /etc/cron.d/markup-clone <<EOF
# /etc/cron.d/markup-clone
# Daily prune of screenshots older than 90 days.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 3 * * * root SCREENSHOT_DIR=/data/screenshots LOG_FILE=$PRUNE_LOG bash $PRUNE_SCRIPT >> $PRUNE_LOG 2>&1
EOF
chmod 644 /etc/cron.d/markup-clone

# Touch the log file so tail/grep on it doesn't 404 on day one.
touch "$PRUNE_LOG"
chmod 644 "$PRUNE_LOG"

# Idempotent install of the every-minute Caddy guard. The guard
# script is shipped in scripts/markup-caddy-guard.sh and made
# executable when invoked directly; deploy.sh itself calls it through bash.
GUARD_SCRIPT="$APP_DIR/scripts/markup-caddy-guard.sh"
if [ -f "$EDGE_HELPER" ]; then
  EDGE_PROXY=$(EDGE_PROXY="$EDGE_PROXY" bash "$EDGE_HELPER" detect)
fi
if [ "$EDGE_PROXY" = "traefik" ]; then
  # The live VPS uses Traefik on :443. Retire the obsolete Caddy cron so it
  # cannot mutate or restart a masked edge stack after a successful deploy.
  rm -f /etc/cron.d/markup-caddy-guard
  echo "Traefik owns public ingress; retired the legacy Caddy guard cron"
elif [ -f "$GUARD_SCRIPT" ]; then
  GUARD_LOG="/var/log/markup-caddy-guard.log"
  # Write the cron file with an UNQUOTED heredoc so the $GUARD_SCRIPT
  # and $GUARD_LOG variables expand to actual paths. The only token
  # in the body that COULD be misinterpreted by bash is the literal
  # word "import" in a comment — but heredocs are not executed, the
  # body is just a string to bash. So the unquoted heredoc is safe
  # AND the variables expand. (The previous version used `<<'EOF'`
  # which suppressed the expansion and left literal $GUARD_SCRIPT
  # in the cron file, breaking the job silently.)
  cat > /etc/cron.d/markup-caddy-guard <<EOF
# /etc/cron.d/markup-caddy-guard
# Every-minute guard that re-adds the markup.ashbi.ca Caddy
# route to /opt/caddy/Caddyfile and /etc/caddy/Caddyfile if
# a fleet-wide edit wipes it. Soft-reloads caddy via the admin
# API when reachable, else systemctl restart caddy. See
# scripts/markup-caddy-guard.sh for the full design.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
* * * * * root bash $GUARD_SCRIPT >> $GUARD_LOG 2>&1
EOF
  chmod 644 /etc/cron.d/markup-caddy-guard
  touch "$GUARD_LOG"
  chmod 644 "$GUARD_LOG"
  echo "Installed $GUARD_SCRIPT (every-minute guard, backstop role)"
  echo "Next run: top of the next minute. Log: $GUARD_LOG"
else
  echo "WARN: $GUARD_SCRIPT not found, skipping caddy-guard install (run deploy.sh first)"
fi

# Idempotent install of the durable integration delivery worker. Keep this
# heredoc quoted: the literal $DELIVERY_WORKER_SECRET must survive installation
# and expand only inside the app container when the job runs.
DELIVERY_LOG="/var/log/markup-integration-delivery.log"
cat > /etc/cron.d/markup-integration-delivery <<'EOF'
# /etc/cron.d/markup-integration-delivery
# Process a bounded batch of signed, retryable integration deliveries.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
* * * * * root docker exec markup-clone sh -c 'test -n "$DELIVERY_WORKER_SECRET" && curl -fsS -X POST -H "Authorization: Bearer $DELIVERY_WORKER_SECRET" http://127.0.0.1:3000/api/internal/integration-deliveries/process' >> /var/log/markup-integration-delivery.log 2>&1
EOF
chmod 644 /etc/cron.d/markup-integration-delivery
touch "$DELIVERY_LOG"
chmod 644 "$DELIVERY_LOG"
echo "Installed durable integration delivery worker (every minute). Log: $DELIVERY_LOG"

echo "Installed /etc/cron.d/markup-clone:"
cat /etc/cron.d/markup-clone
echo
echo "Next prune run: 03:00 UTC. Manual run: bash $PRUNE_SCRIPT"
