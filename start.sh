#!/bin/sh
set -e

cd /app/.medusa/server

# Run migrations on boot (idempotent — safe to run on every restart)
echo "[start] Running database migrations..."
npx medusa db:migrate 2>/dev/null || {
  # Fallback: try the bundled migration binary directly
  node node_modules/.bin/medusa db:migrate 2>/dev/null || echo "[start] Migration command not found — skipping (assumes already migrated)"
}

# Boot the Medusa server
echo "[start] Starting Medusa server..."
exec npx medusa start
