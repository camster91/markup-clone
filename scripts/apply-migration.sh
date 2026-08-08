#!/usr/bin/env bash

set -euo pipefail

MIGRATION_NAME="${1:-}"
MIGRATION_FILE="${2:-}"
PG_CONTAINER="${PG_CONTAINER:-markup-postgres}"
PG_USER_VALUE="${PG_USER_VALUE:-markup}"
PG_DB_VALUE="${PG_DB_VALUE:-markup_db}"

fail() {
  echo "migration apply: $*" >&2
  exit 1
}

if ! printf '%s\n' "$MIGRATION_NAME" | grep -Eq '^[0-9]{8,14}_[a-z0-9_]+$'; then
  fail "invalid migration name"
fi
[ -f "$MIGRATION_FILE" ] || fail "migration file is missing"
command -v docker >/dev/null 2>&1 || fail "docker is unavailable"

# PostgreSQL must abort on the first SQL error. Stream the history insert after
# the migration SQL into the same single transaction, so the schema and marker
# either commit together or both roll back. The migration-name validation above
# makes the interpolated identifier safe for this SQL literal.
{
  cat "$MIGRATION_FILE"
  printf '\nINSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, applied_steps_count) VALUES (gen_random_uuid()::text, '\''baseline'\'', NOW(), '\''%s'\'', 1) ON CONFLICT DO NOTHING;\n' "$MIGRATION_NAME"
} | docker exec -i "$PG_CONTAINER" \
  psql --single-transaction -v ON_ERROR_STOP=1 \
  -U "$PG_USER_VALUE" -d "$PG_DB_VALUE" \
  >/dev/null

echo "migration apply: completed $MIGRATION_NAME"
