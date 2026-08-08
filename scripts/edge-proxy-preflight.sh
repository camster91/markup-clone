#!/usr/bin/env bash

set -euo pipefail

COMMAND="${1:-}"
PUBLIC_HOSTNAME="${PUBLIC_HOSTNAME:-markup.ashbi.ca}"
HOST_PORT="${HOST_PORT:-3030}"
EDGE_PROXY="${EDGE_PROXY:-auto}"
TRAEFIK_ROUTERS_FILE="${TRAEFIK_ROUTERS_FILE:-/opt/traefik/dynamic/routers.yml}"
TRAEFIK_API_URL="${TRAEFIK_API_URL:-http://127.0.0.1:8080}"
TRAEFIK_ROUTER_NAME="${TRAEFIK_ROUTER_NAME:-markup}"
TRAEFIK_SERVICE_NAME="${TRAEFIK_SERVICE_NAME:-markup}"
TRAEFIK_CERT_RESOLVER="${TRAEFIK_CERT_RESOLVER:-letsencrypt}"
CURL_BIN="${CURL_BIN:-curl}"

fail() {
  echo "edge preflight: $*" >&2
  exit 1
}

detect_edge_proxy() {
  case "$EDGE_PROXY" in
    traefik|caddy)
      printf '%s\n' "$EDGE_PROXY"
      return 0
      ;;
    auto) ;;
    *) fail "EDGE_PROXY must be auto, traefik, or caddy" ;;
  esac

  if command -v docker >/dev/null 2>&1 \
    && docker inspect traefik >/dev/null 2>&1; then
    command -v ss >/dev/null 2>&1 \
      || fail "Traefik exists but the public listener cannot be inspected"
    ss -ltnp 2>/dev/null \
      | awk 'index($0, "443") && tolower($0) ~ /traefik/ { found=1 } END { exit !found }' \
      || fail "Traefik exists but does not own public port 443"
    printf '%s\n' traefik
    return 0
  fi

  printf '%s\n' caddy
}

verify_public_edge() {
  local mode body router_json service_json
  mode=$(detect_edge_proxy)

  if [ "$mode" = "traefik" ]; then
    [ -r "$TRAEFIK_ROUTERS_FILE" ] || fail "Traefik routers file is unreadable"
    grep -Fq "Host(\`${PUBLIC_HOSTNAME}\`)" "$TRAEFIK_ROUTERS_FILE" \
      || fail "Traefik route for ${PUBLIC_HOSTNAME} is missing"
    grep -Fq "url: http://127.0.0.1:${HOST_PORT}" "$TRAEFIK_ROUTERS_FILE" \
      || fail "Traefik service for loopback port ${HOST_PORT} is missing"

    router_json=$("$CURL_BIN" --fail --silent --show-error \
      "${TRAEFIK_API_URL}/api/http/routers/${TRAEFIK_ROUTER_NAME}@file") \
      || fail "active Traefik router cannot be inspected"
    service_json=$("$CURL_BIN" --fail --silent --show-error \
      "${TRAEFIK_API_URL}/api/http/services/${TRAEFIK_SERVICE_NAME}@file") \
      || fail "active Traefik service cannot be inspected"
    command -v python3 >/dev/null 2>&1 \
      || fail "python3 is required to validate Traefik runtime state"
    if ! ROUTER_JSON="$router_json" \
      SERVICE_JSON="$service_json" \
      EXPECTED_HOST="$PUBLIC_HOSTNAME" \
      EXPECTED_PORT="$HOST_PORT" \
      EXPECTED_SERVICE="$TRAEFIK_SERVICE_NAME" \
      EXPECTED_RESOLVER="$TRAEFIK_CERT_RESOLVER" \
      python3 <<'PY'
import json
import os
import sys

try:
    router = json.loads(os.environ['ROUTER_JSON'])
    service = json.loads(os.environ['SERVICE_JSON'])
except (KeyError, json.JSONDecodeError):
    sys.exit(1)

expected_rule = f"Host(`{os.environ['EXPECTED_HOST']}`)"
expected_url = f"http://127.0.0.1:{os.environ['EXPECTED_PORT']}"
router_ok = (
    router.get('status') == 'enabled'
    and router.get('rule') == expected_rule
    and router.get('service') == os.environ['EXPECTED_SERVICE']
    and 'websecure' in (router.get('entryPoints') or [])
    and (router.get('tls') or {}).get('certResolver') == os.environ['EXPECTED_RESOLVER']
)
servers = (service.get('loadBalancer') or {}).get('servers') or []
service_ok = (
    service.get('status') == 'enabled'
    and expected_url in [server.get('url') for server in servers]
)
sys.exit(0 if router_ok and service_ok else 1)
PY
    then
      fail "active Traefik runtime route does not match the release contract"
    fi
  fi

  # Never bypass certificate verification. A self-signed, expired, mismatched,
  # or incomplete chain is a release failure even when the app is healthy.
  body=$("$CURL_BIN" --fail --silent --show-error \
    --resolve "${PUBLIC_HOSTNAME}:443:127.0.0.1" \
    "https://${PUBLIC_HOSTNAME}/api/health") \
    || fail "trusted HTTPS health check failed for ${PUBLIC_HOSTNAME}"
  printf '%s' "$body" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' \
    || fail "public health response is not healthy"

  echo "edge preflight: ${mode} route and trusted HTTPS are healthy"
}

case "$COMMAND" in
  detect) detect_edge_proxy ;;
  verify) verify_public_edge ;;
  *) fail "usage: edge-proxy-preflight.sh detect|verify" ;;
esac
