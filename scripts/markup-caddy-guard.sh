#!/usr/bin/env bash
# Markup Clone Caddyfile guard.
#
# History
# -------
# 2026-06-12: created (commit 1b90d92). The original guard re-added
# the inline `markup.ashbi.ca { ... }` block to both /opt/caddy/Caddyfile
# and /etc/caddy/Caddyfile if a fleet-wide edit wiped it. That worked
# (verified live) but was reactive: there was a 0-60s window per cron
# tick where a fleet-wide overwrite could still drop the route.
#
# 2026-06-13: durable-import rewrite. The markup route now lives in
# /opt/caddy/markup.d/caddyfile and is loaded by the master
# /opt/caddy/Caddyfile via:
#
#     import /opt/caddy/markup.d/caddyfile
#
# Even if another agent's deploy.sh overwrites /opt/caddy/Caddyfile
# to a 5-route base, the markup.d file is untouched (other deploys
# have no reason to touch it). The next caddy reload/restart picks up
# both the base + the import.
#
# This guard's only remaining job is to be a BACKSTOP for the
# import line itself: if a fleet overwrite strips the import
# directive, re-add it. The import line is the only fragile part of
# the durable pattern; everything else is owned by markup-clone and
# other services don't touch it.
#
# The guard also re-installs /opt/caddy/markup.d/caddyfile from a
# ship-file in the repo (/root/markup-clone/scripts/caddyfile.markup.d)
# in the unlikely event it gets deleted. That file is the source of
# truth; deploy.sh keeps it in sync on every deploy.
#
# Cron entry (one row, every minute):
#   * * * * * /root/markup-clone/scripts/markup-caddy-guard.sh >> /var/log/markup-caddy-guard.log 2>&1
#
# Why every minute: the worst-case window for a missing markup
# route is bounded at 60 seconds. The actual caddy restart is
# only triggered if the file changed, so the steady-state cost
# is one grep per minute.

set -euo pipefail

PUBLIC_HOSTNAME="${PUBLIC_HOSTNAME:-markup.ashbi.ca}"
HOST_PORT="${HOST_PORT:-3030}"
APP_NAME="${APP_NAME:-markup-clone}"
LIVE_CADDYFILE="/opt/caddy/Caddyfile"
BASE_CADDYFILE="/etc/caddy/Caddyfile"
MARKUP_D_DIR="/opt/caddy/markup.d"
MARKUP_D_FILE="${MARKUP_D_DIR}/caddyfile"
MARKUP_D_SHIP="${APP_DIR:-/root/markup-clone}/scripts/caddyfile.markup.d"
LOG_PREFIX="[$(date -u +%Y-%m-%dT%H:%M:%SZ)]"

# --- 1. Defend /opt/caddy/markup.d/caddyfile ---
#
# If the file is missing, copy it back from the ship-file. Caddy
# without this file fails to start (it errors on the import
# directive). We DON'T reload caddy here if we just had to
# restore this file — the next step (import line guard) will
# trigger a restart if anything is amiss.
markup_d_changed=0
if [ ! -f "$MARKUP_D_FILE" ] && [ -f "$MARKUP_D_SHIP" ]; then
  echo "$LOG_PREFIX missing $MARKUP_D_FILE, restoring from $MARKUP_D_SHIP"
  mkdir -p "$MARKUP_D_DIR"
  install -m 0644 "$MARKUP_D_SHIP" "$MARKUP_D_FILE"
  markup_d_changed=1
fi

# --- 2. Defend the import line in the master Caddyfile ---
#
# Re-add the import directive if a fleet-wide edit removed it.
# This is the primary (and only) job of the guard under the
# durable-import design. The route itself is provided by the
# import, so we do NOT inline the route block here anymore —
# doing so would create a duplicate site definition and caddy
# would refuse to start.
import_changed=0
for f in "$LIVE_CADDYFILE" "$BASE_CADDYFILE"; do
  [ -f "$f" ] || continue
  if ! grep -qF 'import /opt/caddy/markup.d/caddyfile' "$f"; then
    echo "$LOG_PREFIX missing 'import $MARKUP_D_FILE' in $f, re-adding"
    {
      echo ""
      echo "# ${APP_NAME} (auto-added by markup-caddy-guard.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ))"
      echo "import ${MARKUP_D_FILE}"
    } >> "$f"
    import_changed=1
  fi
done

if [ "$markup_d_changed" = "0" ] && [ "$import_changed" = "0" ]; then
  exit 0
fi

# --- 3. Reload caddy ---
#
# File changed. Reload caddy softly via the admin API if
# available, else via systemctl restart. The host's caddy
# unit is started with `caddy run --config ...` directly (no
# admin socket by default), so the admin API is normally
# unavailable — systemctl restart is the common path.
if curl -sf --max-time 1 http://127.0.0.1:2019/config/ >/dev/null 2>&1; then
  caddy adapt --config "$LIVE_CADDYFILE" --pretty 2>/dev/null > /tmp/markup-caddy-guard.json || {
    echo "$LOG_PREFIX caddy adapt failed; falling back to systemctl restart"
    systemctl restart caddy >/dev/null 2>&1 || true
    exit 0
  }
  curl -sf -X POST -H "Content-Type: application/json" --data @/tmp/markup-caddy-guard.json http://127.0.0.1:2019/load >/dev/null 2>&1 && \
    echo "$LOG_PREFIX caddy reloaded via admin API" || \
    echo "$LOG_PREFIX admin API POST failed; falling back to systemctl restart"
else
  systemctl restart caddy >/dev/null 2>&1 && \
    echo "$LOG_PREFIX caddy restarted" || \
    echo "$LOG_PREFIX caddy restart failed"
fi
