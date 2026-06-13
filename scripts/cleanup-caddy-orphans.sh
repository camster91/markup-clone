#!/usr/bin/env bash
# Markup Clone: kill orphan caddy processes from prior debug sessions.
#
# Run this ad-hoc when you suspect a stray `caddy run` is holding
# port 443/80 and breaking HTTPS. No deploy required.
#
# Usage:
#   bash scripts/cleanup-caddy-orphans.sh            # on the VPS
#   ssh coolify 'bash /root/markup-clone/scripts/cleanup-caddy-orphans.sh'
#
# ---
#
# Background: an operator (or the script) runs `caddy run --config
# /opt/caddy/Caddyfile 2>&1 | tail -30` in an SSH session to debug
# something. The SSH session closes (timeout, network blip, ctrl-c
# of the parent Hermes terminal call). The bash pipe stays alive
# because of the `tail` holding the read end open, and `caddy run`
# keeps running indefinitely. The result: a `caddy run` process
# whose parent is NOT the systemd caddy unit (and not PID 1 — it's
# some other init-reparented ancestor or a lingering bash subshell).
# It binds :443/80, the systemd caddy fails to bind, and HTTPS
# requests break with TLS internal errors until the orphan is
# killed manually.
#
# Verified 2026-06-13: 3 such orphan caddies (PIDs 879926, 880158,
# 923874) caused ~30 min of broken TLS on the next deploy.
#
# This script is the standalone variant of the same logic that
# runs as a pre-flight guard at the top of deploy.sh. The deploy
# version is auto-invoked before every deploy; this one is for
# operators who want to clean up without doing a full deploy.
#
# Detection rule: any process whose command line is `caddy run ...`
# or just `caddy` (the long-running server), AND whose PPID is not
# 1. The systemd-managed caddy is always a direct child of PID 1
# (systemd is PID 1), so it's automatically preserved. Children
# of other parents — including a reparented bash subshell from a
# closed SSH session — get SIGTERM, then SIGKILL after 1s.
#
# This script does NOT touch `caddy adapt`, `caddy fmt`, `caddy
# file-server`, or `caddy version` — those are short-lived
# transients used by markup-caddy-guard.sh and pose no orphan
# risk. The systemd caddy, also a child of PID 1, is also
# preserved by the PPID filter.
#
# Logging: writes to /var/log/markup-deploy.log if writable
# (matching deploy.sh), else to stdout.

set -euo pipefail

# --- Config ---
APP_NAME="markup-clone"
LOG="/var/log/markup-deploy.log"

# Pick the logging strategy. Mirror deploy.sh's pattern: tee to
# the log file if we can write to its directory, else just stdout.
mkdir -p "$(dirname "$LOG")" 2>/dev/null || LOG=""

log() {
  local msg="[$(date -Iseconds)] $*"
  if [ -n "$LOG" ] && [ -w "$(dirname "$LOG")" ]; then
    echo "$msg" | tee -a "$LOG"
  else
    echo "$msg"
  fi
}

log "=== cleanup-caddy-orphans.sh starting (pid=$$) ==="

# --- Detect orphans ---
# Find caddy processes using the executable basename (comm field)
# rather than grepping args — args can contain "caddy" inside
# heredocs/scripts that aren't actually caddy. comm is the actual
# binary name as the kernel sees it.
#
# ps syntax is portable: `ps -eo pid=,ppid=,comm=,args=` works on
# both Linux (GNU ps) and macOS (BSD ps). On macOS the comm field
# is the full executable path (e.g. `/usr/bin/caddy`); on Linux
# it's just the basename (`caddy`). Match both with a regex that
# requires "caddy" preceded by / or start-of-line.
#
# Only long-running server invocations (bare `caddy` or `caddy run
# ...`) are targeted. `caddy adapt`, `caddy fmt`, `caddy
# file-server`, `caddy version` are short-lived transients used by
# markup-caddy-guard.sh and pose no orphan risk.
self_pid=$$
orphans=""
while IFS= read -r line; do
  [ -z "$line" ] && continue
  # fields: pid ppid comm args...
  pid=$(echo "$line" | awk '{print $1}')
  ppid=$(echo "$line" | awk '{print $2}')
  comm=$(echo "$line" | awk '{print $3}')
  args=$(echo "$line" | cut -d' ' -f4-)
  # Skip ourselves.
  [ "$pid" = "$self_pid" ] && continue
  # Skip anything parented to PID 1 (systemd-managed caddy lives there).
  [ "$ppid" = "1" ] && continue
  # Filter to actual caddy binaries.
  case "$comm" in
    *caddy)
      case "$args" in
        caddy\ run*|"caddy"|*"/caddy run"*|*"/caddy"|*"caddy run "*)
          orphans="${orphans}${orphans:+ }${pid}"
          ;;
      esac
      ;;
  esac
done < <(ps -eo pid=,ppid=,comm=,args= 2>/dev/null | grep -E '(^|/)caddy( |$)' || true)

if [ -z "$orphans" ]; then
  log "no orphan caddy processes found"
  log "=== cleanup-caddy-orphans.sh done (no-op) ==="
  exit 0
fi

log "found orphan caddy process(es) (PPID != 1): $orphans"

# --- Kill them: SIGTERM first, then SIGKILL after 1s ---
killed_term=0
killed_kill=0
for pid in $orphans; do
  cmd=$(ps -o args= -p "$pid" 2>/dev/null | head -c 200 || true)
  log "killing orphan caddy pid=$pid cmd='$cmd' (SIGTERM)"
  if kill -TERM "$pid" 2>/dev/null; then
    killed_term=$((killed_term + 1))
  fi
done

# Give them a moment to exit cleanly.
sleep 1

# Force-kill anything that didn't respond to SIGTERM.
for pid in $orphans; do
  if kill -0 "$pid" 2>/dev/null; then
    log "force-killing orphan caddy pid=$pid (SIGKILL, did not respond to SIGTERM)"
    if kill -KILL "$pid" 2>/dev/null; then
      killed_kill=$((killed_kill + 1))
    fi
  fi
done

# Verify. On macOS in particular, a SIGKILL'd child can take a few
# hundred ms to be fully reaped by its parent (the bash subshell),
# during which `kill -0` may still report the PID as alive even
# though no real process is there. Retry a few times with a small
# sleep so we don't false-positive.
remaining=""
for pid in $orphans; do
  alive=0
  for _ in 1 2 3 4 5; do
    if kill -0 "$pid" 2>/dev/null; then
      alive=1
      sleep 0.2
    else
      alive=0
      break
    fi
  done
  if [ "$alive" = "1" ]; then
    remaining="${remaining}${remaining:+ }${pid}"
  fi
done

if [ -n "$remaining" ]; then
  log "FAIL: caddy process(es) still alive after cleanup: $remaining"
  log "=== cleanup-caddy-orphans.sh done (FAIL) ==="
  exit 1
fi

log "summary: $killed_term SIGTERM'd, $killed_kill SIGKILL'd, 0 remaining"
log "=== cleanup-caddy-orphans.sh done (OK) ==="
exit 0
