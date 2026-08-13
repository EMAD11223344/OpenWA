#!/bin/sh
set -e

# Start Redis in background (not daemonized, so we can track it)
if command -v redis-server >/dev/null 2>&1; then
  echo "==> [Entrypoint] Starting Redis on 127.0.0.1:6379..."
  redis-server --bind 127.0.0.1 --port 6379 &
  sleep 2  # Wait for Redis to be ready
  
  # Verify Redis is actually running
  if redis-cli ping | grep -q "PONG"; then
    echo "==> [Entrypoint] Redis is UP."
  else
    echo "==> [Entrypoint] WARNING: Redis failed to start!"
  fi
else
  echo "==> [Entrypoint] WARNING: redis-server not found!"
fi

# Run Prisma migrations (REQUIRED for v2)
if [ "$DATABASE_ENABLED" = "true" ] && [ -n "$DATABASE_CONNECTION_URI" ]; then
  echo "==> [Entrypoint] Running database migrations..."
  npx prisma migrate deploy || true
fi

echo "==> [Entrypoint] Starting Evolution API..."
exec "$@"