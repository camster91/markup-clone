#!/bin/sh
# App container entrypoint (baked into the image; see Dockerfile).
#
# The container starts as root only long enough to make the user-file volume
# writable by the unprivileged `node` user, then runs the app as `node`.
# Existing volumes were written by root before the image dropped privileges,
# so the first start after that change fixes their ownership. Later starts
# only touch entries that are wrong, so a restart over a large volume stays
# fast.
#
# /data/backups is left alone: backups run through `docker exec` as root and
# the app never reads them.

set -eu

if [ "$(id -u)" = "0" ]; then
  for dir in "${SCREENSHOTS_DIR:-/data/screenshots}" ${ATTACHMENTS_DIR:+"$ATTACHMENTS_DIR"}; do
    mkdir -p "$dir"
    find "$dir" \( ! -user node -o ! -group node \) -exec chown node:node {} +
  done
  exec su-exec node "$@"
fi

exec "$@"
