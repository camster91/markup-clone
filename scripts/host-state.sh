#!/usr/bin/env bash
# Inspect the VPS and emit a state report.
# Two outputs: /root/host-state.json (machine-readable) and /root/host-state.md (human-readable).
# Idempotent. Run on demand: `bash scripts/host-state.sh` (either on the host, or via SSH from a dev box).
#
# What it captures:
#   - Host identity, uptime, disk
#   - Docker daemon: version, running containers, images
#   - Listening ports
#   - Public routes from /opt/caddy/Caddyfile
#   - The Caddy process status and admin port reachability
#   - All Docker volumes (so we know what survives container recreations)
#   - All docker networks (especially user-defined bridges like markup-net)
#   - Markup-clone health (if container exists)

set -euo pipefail

OUT_DIR="/root"
JSON="$OUT_DIR/host-state.json"
MD="$OUT_DIR/host-state.md"
TS=$(date -Iseconds)

# --- Helpers ---
jq_safe() { # write JSON to stdout using python to dodge the missing-jq-toolbox risk
  python3 -c 'import json,sys; json.dump(json.loads(sys.stdin.read()), sys.stdout, indent=2, sort_keys=True)' 2>/dev/null || cat
}

# --- Collect ---
HOSTNAME=$(hostname)
OS=$(. /etc/os-release && echo "${NAME} ${VERSION_ID}")
KERNEL=$(uname -r)
UPTIME=$(uptime -p 2>/dev/null || uptime)
DISK_TOTAL=$(df -h / | awk 'NR==2 {print $2}')
DISK_USED=$(df -h / | awk 'NR==2 {print $3}')
DISK_AVAIL=$(df -h / | awk 'NR==2 {print $4}')
DISK_PCT=$(df -h / | awk 'NR==2 {print $5}')

DOCKER_VERSION=$(docker --version 2>/dev/null || echo "docker NOT available")

# Containers as JSON
CONTAINERS_JSON=$(docker ps -a --format '{{json .}}' 2>/dev/null \
  | python3 -c '
import json, sys
out = []
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try:
        d = json.loads(line)
        # extract port bindings from docker inspect
        out.append({
            "name": d.get("Names") or d.get("Name"),
            "image": d.get("Image"),
            "status": d.get("Status"),
            "state": d.get("State"),
            "ports": d.get("Ports"),
            "created": d.get("CreatedAt"),
        })
    except Exception:
        pass
print(json.dumps(out))
' || echo '[]')

# For each running container, get port bindings and labels
CONTAINERS_FULL=$(docker ps --format '{{.ID}}|{{.Names}}' 2>/dev/null | while IFS='|' read -r id name; do
  inspect=$(docker inspect "$id" 2>/dev/null | python3 -c '
import json, sys
try:
    d = json.loads(sys.stdin.read())[0]
    print(json.dumps({
        "name": d.get("Name", "").lstrip("/"),
        "image": (d.get("Config") or {}).get("Image"),
        "state": (d.get("State") or {}).get("Status"),
        "ports": (d.get("HostConfig") or {}).get("PortBindings") or {},
        "labels": (d.get("Config") or {}).get("Labels") or {},
        "env_keys": sorted([(e.split("=",1)[0]) for e in ((d.get("Config") or {}).get("Env") or []) if "=" in e and not e.startswith(("PATH","HOSTNAME","HOME"))]),
        "networks": sorted(list((d.get("NetworkSettings") or {}).get("Networks") or {}).keys()),
    }))
except Exception:
    print("{}")
')
  echo "${id}|${inspect}"
done)

# Images
IMAGES_JSON=$(docker images --format '{{json .}}' 2>/dev/null | python3 -c '
import json, sys
out = []
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try:
        d = json.loads(line)
        out.append({
            "repository": d.get("Repository"),
            "tag": d.get("Tag"),
            "id": d.get("ID"),
            "size": d.get("Size"),
            "created": d.get("CreatedSince") or d.get("CreatedAt"),
        })
    except Exception:
        pass
print(json.dumps(out))
' || echo '[]')

# Volumes
VOLUMES_JSON=$(docker volume ls --format '{{json .}}' 2>/dev/null | python3 -c '
import json, sys
out = []
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try:
        d = json.loads(line)
        out.append({"name": d.get("Name"), "driver": d.get("Driver")})
    except Exception:
        pass
print(json.dumps(out))
' || echo '[]')

# Networks (user-defined only)
NETWORKS_JSON=$(docker network ls --format '{{json .}}' 2>/dev/null | python3 -c '
import json, sys
out = []
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try:
        d = json.loads(line)
        if d.get("Driver") in ("bridge", "overlay") and d.get("Name") not in ("bridge", "host", "none"):
            out.append({"name": d.get("Name"), "driver": d.get("Driver"), "id": d.get("ID")[:12]})
    except Exception:
        pass
print(json.dumps(out))
' || echo '[]')

# Listening ports
LISTEN_PORTS=$(ss -tlnp 2>/dev/null | awk 'NR>1 {print $4}' | sed 's/.*://' | sort -un | head -30)

# Caddyfile routes
CADDYFILE="/opt/caddy/Caddyfile"
if [ -f "$CADDYFILE" ]; then
  CADDY_ROUTES=$(awk '
    /^[a-zA-Z0-9._-]+(,\s*[a-zA-Z0-9._-]+)*\s*\{\s*$/ {
      # collect hostnames on this line
      gsub(/\s*\{\s*$/, "")
      print "  - " $0
    }
    /^\s*reverse_proxy\s+/ {
      print "    -> " $2
    }
  ' "$CADDYFILE")
else
  CADDY_ROUTES="  (no $CADDYFILE found)"
fi

# Caddy process status
CADDY_PID=$(pgrep -f 'caddy run' | head -1 || echo "")
if [ -n "$CADDY_PID" ]; then
  CADDY_STATUS="running (pid $CADDY_PID)"
  CADDY_ADMIN=$(curl -sf http://127.0.0.1:2019/config/ >/dev/null 2>&1 && echo "reachable" || echo "unreachable")
else
  CADDY_STATUS="NOT RUNNING"
  CADDY_ADMIN="n/a"
fi

# Traefik status
TRAEFIK_PID=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -i traefik | head -1 || echo "")
if [ -n "$TRAEFIK_PID" ]; then
  TRAEFIK_STATUS="running (container: $TRAEFIK_PID)"
else
  TRAEFIK_STATUS="not running"
fi

# markup-clone health
MARKUP_STATUS="not present"
MARKUP_HEALTH="n/a"
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "markup-clone"; then
  MARKUP_STATUS="running"
  MARKUP_HEALTH=$(curl -sf http://127.0.0.1:3030/api/health 2>/dev/null || echo "unreachable")
fi

# --- Build the JSON report ---
# Use a single Python script that re-collects everything itself, so we don't
# have to round-trip through shell interpolation (which corrupts numbers like 020).
cat > /tmp/_build_state.py <<'PYEOF'
import json, os, subprocess, sys

def sh(cmd, default=""):
    try:
        return subprocess.check_output(cmd, shell=True, text=True, stderr=subprocess.DEVNULL).strip()
    except Exception:
        return default

state = {
    "capturedAt": subprocess.check_output(["date", "-Iseconds"], text=True).strip(),
    "host": {
        "hostname": sh("hostname"),
        "os": sh(". /etc/os-release && echo \"${NAME} ${VERSION_ID}\""),
        "kernel": sh("uname -r"),
        "uptime": sh("uptime -p", sh("uptime")),
        "disk": {
            "total": sh("df -h / | awk 'NR==2 {print $2}'"),
            "used": sh("df -h / | awk 'NR==2 {print $3}'"),
            "available": sh("df -h / | awk 'NR==2 {print $4}'"),
            "percent": sh("df -h / | awk 'NR==2 {print $5}'"),
        },
    },
    "docker": {
        "version": sh("docker --version"),
        "containers": [],
        "images": [],
        "volumes": [],
        "user_defined_networks": [],
    },
    "listening_ports": [],
    "front_end": {
        "caddy": {"status": "NOT RUNNING", "admin_api": "n/a", "config_file": "/opt/caddy/Caddyfile", "routes": ""},
        "traefik": "not running",
    },
    "markup_clone": {
        "container_status": "not present",
        "health": "n/a",
    },
}

# Containers (ps)
try:
    ps_out = subprocess.check_output(["docker", "ps", "-a", "--format", "{{json .}}"], text=True).splitlines()
    for line in ps_out:
        if not line.strip(): continue
        try:
            d = json.loads(line)
            state["docker"]["containers"].append({
                "name": d.get("Names") or d.get("Name"),
                "image": d.get("Image"),
                "status": d.get("Status"),
                "state": d.get("State"),
                "ports": d.get("Ports"),
                "created": d.get("CreatedAt"),
            })
        except Exception:
            pass
except Exception:
    pass

# Containers full (port bindings + labels + networks)
try:
    out = subprocess.check_output(["docker", "ps", "--format", "{{.ID}}"], text=True).split()
    for cid in out:
        try:
            ins = json.loads(subprocess.check_output(["docker", "inspect", cid], text=True))[0]
            name = (ins.get("Name") or "").lstrip("/")
            host_cfg = ins.get("HostConfig") or {}
            cfg = ins.get("Config") or {}
            ns = ins.get("NetworkSettings") or {}
            state["docker"]["containers"].append({
                "name": name,
                "image": cfg.get("Image"),
                "state": (ins.get("State") or {}).get("Status"),
                "port_bindings": host_cfg.get("PortBindings") or {},
                "labels": cfg.get("Labels") or {},
                "env_keys": sorted([(e.split("=",1)[0]) for e in (cfg.get("Env") or []) if "=" in e and not e.startswith(("PATH","HOSTNAME","HOME"))]),
                "networks": sorted(list(ns.get("Networks") or {}).keys()),
            })
        except Exception:
            pass
except Exception:
    pass

# Dedupe containers by name (the ps list and the inspect list both got appended)
seen = set()
deduped = []
for c in state["docker"]["containers"]:
    n = c.get("name")
    if n in seen: continue
    seen.add(n)
    deduped.append(c)
state["docker"]["containers"] = deduped

# Images
try:
    for line in subprocess.check_output(["docker", "images", "--format", "{{json .}}"], text=True).splitlines():
        if not line.strip(): continue
        try:
            d = json.loads(line)
            state["docker"]["images"].append({
                "repository": d.get("Repository"),
                "tag": d.get("Tag"),
                "id": d.get("ID"),
                "size": d.get("Size"),
                "created": d.get("CreatedSince") or d.get("CreatedAt"),
            })
        except Exception:
            pass
except Exception:
    pass

# Volumes
try:
    for line in subprocess.check_output(["docker", "volume", "ls", "--format", "{{json .}}"], text=True).splitlines():
        if not line.strip(): continue
        try:
            d = json.loads(line)
            state["docker"]["volumes"].append({"name": d.get("Name"), "driver": d.get("Driver")})
        except Exception:
            pass
except Exception:
    pass

# Networks
try:
    for line in subprocess.check_output(["docker", "network", "ls", "--format", "{{json .}}"], text=True).splitlines():
        if not line.strip(): continue
        try:
            d = json.loads(line)
            if d.get("Driver") in ("bridge", "overlay") and d.get("Name") not in ("bridge", "host", "none"):
                state["docker"]["user_defined_networks"].append({"name": d.get("Name"), "driver": d.get("Driver"), "id": d.get("ID", "")[:12]})
        except Exception:
            pass
except Exception:
    pass

# Listening ports
try:
    raw = subprocess.check_output(["ss", "-tlnp"], text=True)
    ports = []
    for line in raw.splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 4:
            local = parts[3]
            if ":" in local:
                ports.append(local.rsplit(":", 1)[-1])
    state["listening_ports"] = sorted(set(ports))
except Exception:
    pass

# Caddy
caddyfile = "/opt/caddy/Caddyfile"
try:
    with open(caddyfile) as f:
        caddy_text = f.read()
except Exception:
    caddy_text = ""

if caddy_text:
    # Parse routes
    routes = []
    current_hosts = None
    for line in caddy_text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        # Match a host block opener
        if "{" in stripped and stripped.endswith("{"):
            hosts = stripped.rstrip(" {").strip()
            current_hosts = hosts
        elif stripped.startswith("reverse_proxy") and current_hosts:
            target = stripped.split()[1] if len(stripped.split()) > 1 else "?"
            routes.append({"hosts": current_hosts, "target": target})
            current_hosts = None
        elif stripped == "}" and current_hosts:
            current_hosts = None

    pid = sh("pgrep -f 'caddy run' | head -1")
    if pid:
        state["front_end"]["caddy"]["status"] = f"running (pid {pid})"
        admin = "reachable" if sh("curl -sf http://127.0.0.1:2019/config/ >/dev/null 2>&1 && echo yes") == "yes" else "unreachable"
        state["front_end"]["caddy"]["admin_api"] = admin
    state["front_end"]["caddy"]["routes"] = routes

# Traefik
try:
    out = subprocess.check_output(["docker", "ps", "--format", "{{.Names}}"], text=True)
    for name in out.split():
        if "traefik" in name.lower():
            state["front_end"]["traefik"] = f"running (container: {name})"
            break
except Exception:
    pass

# markup-clone
mc_name = "markup-clone"
for c in state["docker"]["containers"]:
    if c.get("name") == mc_name:
        state["markup_clone"]["container_status"] = "running" if c.get("state") == "running" else c.get("state", "unknown")
        try:
            h = subprocess.check_output(
                ["curl", "-sf", "http://127.0.0.1:3030/api/health"],
                text=True, timeout=2,
            )
            state["markup_clone"]["health"] = h.strip()
        except Exception:
            state["markup_clone"]["health"] = "unreachable"
        break

print(json.dumps(state, indent=2, sort_keys=True))
PYEOF
python3 /tmp/_build_state.py > "$JSON"
rm -f /tmp/_build_state.py

# --- Build the markdown report ---
{
  echo "# Host State Report"
  echo
  echo "_Captured: $(date -Iseconds)_"
  echo
  echo "## Host"
  echo
  echo "| Key | Value |"
  echo "|---|---|"
  echo "| Hostname | \`$(hostname)\` |"
  echo "| OS | $(. /etc/os-release && echo "${NAME} ${VERSION_ID}") |"
  echo "| Kernel | $(uname -r) |"
  echo "| Uptime | $(uptime -p 2>/dev/null || uptime) |"
  echo "| Disk | $(df -h / | awk 'NR==2 {print $3}') used / $(df -h / | awk 'NR==2 {print $2}') total ($(df -h / | awk 'NR==2 {print $5}') used, $(df -h / | awk 'NR==2 {print $4}') free) |"
  echo
  echo "## Docker"
  echo
  echo "Version: \`$(docker --version 2>/dev/null || echo 'not available')\`"
  echo
  echo "### Containers"
  echo
  echo "| Name | State | Image | Created |"
  echo "|---|---|---|---|"
  docker ps -a --format '| {{.Names}} | {{.State}} | {{.Image}} | {{.CreatedAt}} |' 2>/dev/null
  echo
  echo "### User-defined networks"
  echo
  docker network ls --format '{{.Name}}\t{{.Driver}}' 2>/dev/null | awk -F'\t' '$1 != "bridge" && $1 != "host" && $1 != "none" {print "- " $1 " (" $2 ")"}'
  echo
  echo "### Volumes"
  echo
  docker volume ls --format '{{.Name}}' 2>/dev/null | awk '{print "- " $0}'
  echo
  echo "## Front end"
  echo
  echo "| Component | Status |"
  echo "|---|---|"
  if pgrep -f 'caddy run' >/dev/null 2>&1; then
    CADDY_PID=$(pgrep -f 'caddy run' | head -1)
    if curl -sf http://127.0.0.1:2019/config/ >/dev/null 2>&1; then
      CADDY_ADMIN="reachable"
    else
      CADDY_ADMIN="unreachable"
    fi
    echo "| Caddy | running (pid $CADDY_PID, admin: $CADDY_ADMIN) |"
  else
    echo "| Caddy | NOT RUNNING |"
  fi
  TRAEFIK=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -i traefik | head -1)
  if [ -n "$TRAEFIK" ]; then
    echo "| Traefik | running (container: $TRAEFIK) |"
  else
    echo "| Traefik | not running |"
  fi
  echo
  echo "### Caddy routes (from /opt/caddy/Caddyfile)"
  echo
  if [ -f /opt/caddy/Caddyfile ]; then
    echo '```'
    awk '
      /^[a-zA-Z0-9._-]+(,\s*[a-zA-Z0-9._-]+)*\s*\{\s*$/ {
        gsub(/\s*\{\s*$/, "")
        print "- " $0
      }
      /^\s*reverse_proxy\s+/ {
        print "    -> " $2
      }
    ' /opt/caddy/Caddyfile
    echo '```'
  else
    echo "_(no /opt/caddy/Caddyfile found)_"
  fi
  echo
  echo "## Listening ports"
  echo
  echo '```'
  ss -tlnp 2>/dev/null | head -30
  echo '```'
  echo
  echo "## markup-clone"
  echo
  echo "| Field | Value |"
  echo "|---|---|"
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "markup-clone"; then
    echo "| Container | running |"
    HEALTH=$(curl -sf http://127.0.0.1:3030/api/health 2>/dev/null || echo "unreachable")
    echo "| Health | \`$HEALTH\` |"
  else
    echo "| Container | not present |"
  fi
  echo "| Public URL | https://markup.ashbi.ca |"
  echo "| Container port mapping | 127.0.0.1:3030 -> container:3000 |"
  echo "| Image | $(docker ps --filter name=markup-clone --format '{{.Image}}' 2>/dev/null || echo 'n/a') |"
} > "$MD"

echo "Wrote: $JSON"
echo "Wrote: $MD"
