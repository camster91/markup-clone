#!/usr/bin/env bash
# Install the markup-clone prune-screenshots cron job.
#
# This script is idempotent: it always replaces the existing
# /etc/cron.d/markup-clone file with the same content, so re-running
# it is safe. It does NOT chmod +x prune-screenshots.sh; that's the
# deploy script's job (deploy.sh already does
#   chmod +x "$APP_DIR/scripts/"*.sh
# after a tarball extract, so a fresh clone doesn't need this).
#
# Cron schedule: 03:00 UTC every day, which is 23:00 ET (overnight).
# The cleanup of <90-day-old screenshots is safe to run while the app
# is serving — it only deletes files that have been superseded by
# newer captures, and the Screenshot rows are CASCADE-deleted by the
# DB constraint. The DELETEs run inside the postgres container, not
# directly on the host.
#
# Manual run: bash scripts/install-cron.sh

set -euo pipefail

CRON_FILE="/etc/cron.d/markup-clone"
SCRIPT_PATH="/root/markup-clone/scripts/prune-screenshots.sh"
LOG_FILE="/var/log/prune-screenshots.log"

if [ ! -f "$SCRIPT_PATH" ]; then
  echo "ERROR: $SCRIPT_PATH does not exist. Run deploy.sh first." >&2
  exit 1
fi

# Ensure the script is executable.
chmod +x "$SCRIPT_PATH"

# Idempotent install. The schedule: 03:00 UTC daily.
cat > "$CRON_FILE" <<EOF
# /etc/cron.d/markup-clone
# Daily prune of screenshots older than 90 days.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 3 * * * root SCREENSHOT_DIR=/data/screenshots LOG_FILE=$LOG_FILE $SCRIPT_PATH >> $LOG_FILE 2>&1
EOF
chmod 644 "$CRON_FILE"

# Touch the log file so tail/grep on it doesn't 404 on day one.
touch "$LOG_FILE"
chmod 644 "$LOG_FILE"

echo "Installed $CRON_FILE:"
cat "$CRON_FILE"
echo
echo "Next run: 03:00 UTC. Manual run: bash $SCRIPT_PATH"
