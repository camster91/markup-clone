# syntax=docker/dockerfile:1.7
#
# Multi-stage build for markup-clone (Next.js 16 standalone output).
#
# Build:  docker build -t markup-clone:dev .
# Run:    docker run --rm -p 3030:3000 \
#             -e DATABASE_URL=postgresql://user:***@host:5432/db \
#             -v $(pwd)/scripts:/opt/app-scripts:ro \
#             -v $(pwd)/data/screenshots:/data/screenshots \
#             markup-clone:dev
#
# For the recapture flow to work in the container, the host must mount
# ./scripts at /opt/app-scripts (the route spawns bash on
# /opt/app-scripts/recapture.sh).
#
# The DATABASE_URL passed at build time is a placeholder; prisma generate
# does not connect to a real DB. The real DATABASE_URL is supplied at
# run time via env or --env-file.

# ── Base layer (shared) ──────────────────────────────────────────────────────
FROM node:20-alpine AS base
WORKDIR /app

# ── Deps layer (cached unless package.json changes) ──────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Local/CI migration image. It carries the Prisma CLI and migration files but
# does not build or start the application. Docker Compose runs this once after
# Postgres is healthy and before the app container starts.
FROM deps AS migrator
COPY prisma ./prisma
COPY prisma.config.ts ./
CMD ["npx", "prisma", "migrate", "deploy"]

# ── Builder layer (runs the next build) ──────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="postgresql://placeholder:***@localhost:5432/placeholder"
RUN npx prisma generate && npm run build

# ── Runner layer (slim — only what is needed at runtime) ────────────────────
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Chromium + psql for the recapture flow. chromium-headless-shell is enough
# for --screenshot mode (no GPU, no audio, no extensions). Match the
# postgres:16 server: unpinned Alpine currently selects 18, whose dumps emit
# settings PostgreSQL 16 cannot restore.
RUN apk add --no-cache \
        curl \
        bash \
        chromium \
        chromium-headless-shell \
        nss \
        postgresql16-client \
        poppler-utils \
        dumb-init \
    && ln -sf /usr/bin/chromium-browser /usr/local/bin/chromium 2>/dev/null || true

# Copy the standalone build output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/prisma ./prisma

# /data/screenshots is the bind-mount target for persisted screenshot files
RUN mkdir -p /data/screenshots /data/backups /opt/app-scripts

EXPOSE 3000

# dumb-init reaps zombies and forwards SIGTERM to node
HEALTHCHECK --interval=10s --timeout=3s --retries=6 --start-period=15s \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "server.js"]
