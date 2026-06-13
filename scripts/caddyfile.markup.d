# /opt/caddy/markup.d/caddyfile
#
# Owned by markup-clone deploy (scripts/deploy.sh). Other services'
# deploys have no reason to touch this file.
#
# Loaded by /opt/caddy/Caddyfile via:
#   import /opt/caddy/markup.d/caddyfile
#
# This is the durable fix for the multi-tenant Caddyfile churn problem:
# even if another fleet member's deploy.sh overwrites the master
# /opt/caddy/Caddyfile, the markup route survives as long as the
# import line is present in the master. The every-minute
# /etc/cron.d/markup-caddy-guard re-adds the import line defensively.
#
# DO NOT ADD non-markup routes here. Keep this file markup-only.

# Markup Clone (Next.js 16 app on the host, reverse-proxied from 127.0.0.1:3030)
markup.ashbi.ca {
    reverse_proxy 127.0.0.1:3030
}
