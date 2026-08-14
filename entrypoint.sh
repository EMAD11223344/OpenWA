#!/bin/bash
set -e

# Start embedded Redis server in background for queue management
echo "==> [Gateway Entrypoint] Starting embedded Redis daemon..."
if command -v redis-server >/dev/null 2>&1; then
  redis-server --bind 127.0.0.1 --port 6379 --daemonize yes || echo "WARNING: Redis background start failed"
  sleep 1
  if redis-cli ping 2>/dev/null | grep -q "PONG"; then
    echo "==> [Gateway Entrypoint] Redis is ready and accepting connections."
  else
    echo "==> [Gateway Entrypoint] WARNING: Redis ping check did not respond."
  fi
fi

# Run Prisma schema migrations if DATABASE_URL is configured
if [ -n "$DATABASE_URL" ]; then
  echo "==> [Gateway Entrypoint] Applying database schema migrations..."
  npx prisma migrate deploy || true
fi

# Hand over to primary process
echo "==> [Gateway Entrypoint] Starting API Engine Gateway..."
exec "$@"