#!/usr/bin/env bash

set -euo pipefail

APP_NAME="${APP_NAME:-markup-clone}"
APP_CONTAINER="${APP_CONTAINER:-markup-clone}"
RETAINER_CONTAINER="${ROLLBACK_RETAINER_CONTAINER:-${APP_CONTAINER}-rollback-retainer}"
NEXT_RETAINER="${RETAINER_CONTAINER}.next.$$"
OWNERSHIP_LABEL="ashbi.rollback-retainer"

fail() {
  echo "rollback retainer: $*" >&2
  exit 1
}

cleanup_next() {
  docker rm -f "$NEXT_RETAINER" >/dev/null 2>&1 || true
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

if ! docker create \
  --name "$NEXT_RETAINER" \
  --label "$OWNERSHIP_LABEL=true" \
  --label "ashbi.rollback-image=$configured_image" \
  --network none \
  --restart no \
  --entrypoint /bin/true \
  "$configured_image" >/dev/null; then
  fail "cannot create temporary rollback retainer $NEXT_RETAINER"
fi
trap cleanup_next EXIT

next_image_id=$(docker inspect --format '{{.Image}}' "$NEXT_RETAINER" 2>/dev/null) || \
  fail "cannot verify temporary rollback retainer"
if [ "$next_image_id" != "$running_image_id" ]; then
  fail "temporary rollback retainer does not reference the running image"
fi

if docker inspect "$RETAINER_CONTAINER" >/dev/null 2>&1; then
  existing_owner=$(docker inspect \
    --format "{{ index .Config.Labels \"$OWNERSHIP_LABEL\" }}" \
    "$RETAINER_CONTAINER" 2>/dev/null || true)
  [ "$existing_owner" = "true" ] || \
    fail "refusing to replace unowned container $RETAINER_CONTAINER"
  docker rm -f "$RETAINER_CONTAINER" >/dev/null
fi

docker rename "$NEXT_RETAINER" "$RETAINER_CONTAINER"
trap - EXIT

retained_image_id=$(docker inspect --format '{{.Image}}' "$RETAINER_CONTAINER" 2>/dev/null) || \
  fail "cannot verify rollback retainer $RETAINER_CONTAINER"
if [ "$retained_image_id" != "$running_image_id" ]; then
  fail "rollback retainer does not reference the running image"
fi

echo "rollback retainer: retained $configured_image ($retained_image_id) as $RETAINER_CONTAINER"
