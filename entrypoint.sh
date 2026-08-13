#!/bin/sh
set -e

# Start local Redis server if installed
if command -v redis-server >/dev/null 2>&1; then
  echo "==> [Evolution API Entrypoint] Starting embedded Redis daemon..."
  redis-server --daemonize yes || echo "WARNING: Failed to start embedded Redis"
fi

# Automatically run database migrations when DATABASE_ENABLED=true
if [ "$DATABASE_ENABLED" = "true" ] && [ -n "$DATABASE_CONNECTION_URI" ]; then
  echo "==> [Evolution API Entrypoint] Deploying Prisma database migrations..."
  npm run db:deploy || true
fi

# Handover control to the primary process
exec "$@"
