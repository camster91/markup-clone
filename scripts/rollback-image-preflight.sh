#!/usr/bin/env bash

set -euo pipefail

APP_NAME="${APP_NAME:-markup-clone}"
APP_CONTAINER="${APP_CONTAINER:-markup-clone}"
OUTPUT_FILE="${1:-${ROLLBACK_IMAGE_FILE:-/data/markup-clone/rollback-image.env}}"

fail() {
  echo "rollback preflight: $*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "docker is unavailable"

configured_image=$(docker inspect --format '{{.Config.Image}}' "$APP_CONTAINER" 2>/dev/null) || \
  fail "container $APP_CONTAINER is not available"

image_repository=${configured_image%:*}
image_tag=${configured_image##*:}
if [ "$image_repository" != "$APP_NAME" ] || \
   ! printf '%s\n' "$image_tag" | grep -Eq '^[0-9a-f]{40}$'; then
  fail "current image must be ${APP_NAME}:<40-character source SHA>; got $configured_image"
fi

resolved_image_id=$(docker image inspect --format '{{.Id}}' "$configured_image" 2>/dev/null) || \
  fail "rollback image $configured_image is not available locally"
running_image_id=$(docker inspect --format '{{.Image}}' "$APP_CONTAINER" 2>/dev/null) || \
  fail "cannot resolve the running image for $APP_CONTAINER"

if ! printf '%s\n' "$resolved_image_id" | grep -Eq '^sha256:[0-9a-f]{64}$'; then
  fail "rollback image returned an invalid image id"
fi
if [ "$resolved_image_id" != "$running_image_id" ]; then
  fail "rollback tag $configured_image does not match the running container image"
fi

output_directory=$(dirname "$OUTPUT_FILE")
mkdir -p "$output_directory"
temporary_file="${OUTPUT_FILE}.tmp.$$"
trap 'rm -f "$temporary_file"' EXIT
umask 077
{
  printf 'ROLLBACK_IMAGE=%s\n' "$configured_image"
  printf 'ROLLBACK_IMAGE_ID=%s\n' "$resolved_image_id"
  printf 'CAPTURED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$temporary_file"
chmod 600 "$temporary_file"
mv -f "$temporary_file" "$OUTPUT_FILE"
trap - EXIT

echo "rollback preflight: retained $configured_image ($resolved_image_id)"
