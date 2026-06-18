#!/bin/sh
# Build the @markup/core shared package.
#
# Emits ESM JS + .d.ts files into ./dist/ using the same `tsc` the root
# project depends on (no new deps). The root package.json's
# "build:core" / "prebuild" hooks chain into this; the standalone
# invocation is for verifying the package builds in isolation.
#
# Usage:
#   cd packages/markup-core && ./build.sh
#   # or from repo root:
#   npm run build:core

set -euo pipefail

cd "$(dirname "$0")"

# Prefer the root's tsc so we're pinned to the same TS version as the app
# (avoids "works in root, fails in package" drift).
ROOT_TSC="../../node_modules/.bin/tsc"
if [[ -x "$ROOT_TSC" ]]; then
  TSC="$ROOT_TSC"
else
  TSC="$(command -v tsc || true)"
  if [[ -z "$TSC" ]]; then
    echo "error: tsc not found. Run 'npm install' at the repo root first." >&2
    exit 1
  fi
fi

# Clean previous build so stale .d.ts files from removed exports don't linger.
rm -rf dist

echo "Building @markup/core with $TSC ..."
"$TSC" -p tsconfig.json

echo "@markup/core built → $(pwd)/dist"
