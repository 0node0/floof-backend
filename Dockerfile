# syntax=docker/dockerfile:1.6

# ---- Build stage ----
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install build dependencies for native modules (pg, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install deps from committed lockfile (reproducible builds)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY tsconfig.json medusa-config.ts ./
COPY src ./src

# Build Medusa
RUN npm run build

# Production deps for the compiled server bundle
RUN cd .medusa/server && npm ci --omit=dev --ignore-scripts

# ---- Runtime stage ----
FROM node:22-bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl ca-certificates tini curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 1001 medusa && useradd -m -u 1001 -g medusa medusa

COPY --from=builder --chown=medusa:medusa /app/.medusa/server /app/.medusa/server
COPY --chown=medusa:medusa start.sh /app/start.sh
RUN chmod +x /app/start.sh

ENV NODE_ENV=production
ENV PORT=9000
ENV MEDUSA_WORKDIR=/app/.medusa/server

USER medusa

EXPOSE 9000

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-9000}/health" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/start.sh"]
