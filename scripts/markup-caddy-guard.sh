#!/usr/bin/env bash
# Markup Clone Caddyfile guard.
#
# Re-adds the markup.ashbi.ca Caddy route to BOTH
# /opt/caddy/Caddyfile and /etc/caddy/Caddyfile if a
# fleet-wide edit wipes it, and soft-reloads caddy
# when the file changed.
#
# The Caddyfile at /opt/caddy/Caddyfile is shared across
# the Ashbi fleet. Other repos (simaqadeer-app,
# family-planner, alinenasseh) have their own deploy.sh
# scripts that also write to it. This every-minute
# cron is the backstop that catches wipes between deploys.
#
# The previous "import /opt/caddy/markup.d/caddyfile"
# approach (M1) was tried 2026-06-13 and reverted: Caddy
# v2's import directive is for JSON config, not Caddyfile
# site blocks. Reverted in commit 020e845 + this file
# updated to defend the inline route block.
#
# Cron entry (one row, every minute):
#   * * * * * /root/markup-clone/scripts/markup-caddy-guard.sh >> /var/log/markup-caddy-guard.log 2>&1
#
# Why every minute: the worst-case window for a missing
# markup route is bounded at 60 seconds. The actual caddy
# reload is only triggered if the file changed, so the
# steady-state cost is one grep per minute.

set -euo pipefail

PUBLIC_HOSTNAME="${PUBLIC_HOSTNAME:-markup.ashbi.ca}"
HOST_PORT="${HOST_PORT:-3030}"
APP_NAME="${APP_NAME:-markup-clone}"
LIVE_CADDYFILE="/opt/caddy/Caddyfile"
BASE_CADDYFILE="/etc/caddy/Caddyfile"
LOG_PREFIX="[$(date -u +%Y-%m-%dT%H:%M:%SZ)]"

changed=0
for f in "$LIVE_CADDYFILE" "$BASE_CADDYFILE"; do
  if [ -f "$f" ] && ! grep -qE "^${PUBLIC_HOSTNAME//./\\.}\s*\{" "$f"; then
    echo "$LOG_PREFIX missing ${PUBLIC_HOSTNAME} route in $f, re-adding"
    cat >> "$f" <<ROUTE_EOF

# ${APP_NAME} (auto-added by markup-caddy-guard.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ))
${PUBLIC_HOSTNAME} {
    reverse_proxy 127.0.0.1:${HOST_PORT}
}
ROUTE_EOF
    changed=1
  fi
done

if [ "$changed" -eq 0 ]; then
  exit 0
fi

# File changed. Reload caddy softly via the admin API if available,
# else via systemctl restart.
if curl -sf --max-time 1 http://127.0.0.1:2019/config/ >/dev/null 2>&1; then
  caddy adapt --config "$LIVE_CADDYFILE" --pretty 2>/dev/null > /tmp/markup-caddy-guard.json || {
    echo "$LOG_PREFIX caddy adapt failed; falling back to systemctl restart caddy"
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
