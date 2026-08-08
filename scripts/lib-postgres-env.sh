#!/usr/bin/env bash
# Source-only helper: parse DATABASE_URL into libpq environment variables while
# keeping credentials out of argv. Node is already present in the app image.

load_postgres_env() {
  : "${DATABASE_URL:?DATABASE_URL is required}"
  local exports
  exports=$(node <<'NODE'
const url = new URL(process.env.DATABASE_URL);
if (!['postgres:', 'postgresql:'].includes(url.protocol)) process.exit(2);
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
const values = {
  PGHOST: url.hostname,
  PGPORT: url.port || '5432',
  PGUSER: decodeURIComponent(url.username),
  PGPASSWORD: decodeURIComponent(url.password),
  PGDATABASE: database,
};
for (const [name, value] of Object.entries(values)) {
  if (!value) process.exit(3);
  process.stdout.write(`export ${name}=${quote(value)}\n`);
}
NODE
  )
  eval "$exports"
}
