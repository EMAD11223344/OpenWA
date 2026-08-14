#!/bin/bash
set -e

# 1. Start embedded Redis daemon for BullMQ
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

# 2. Always map DATABASE_CONNECTION_URI to DATABASE_URL if present
if [ -n "$DATABASE_CONNECTION_URI" ]; then
  echo "==> [Gateway Entrypoint] Mapping DATABASE_CONNECTION_URI to DATABASE_URL..."
  export DATABASE_URL="$DATABASE_CONNECTION_URI"
fi

# 3. Synchronize Prisma Database Schema (Create missing tables)
if [ -n "$DATABASE_URL" ]; then
  echo "==> [Gateway Entrypoint] Synchronizing database tables with Prisma schema..."
  cd /app 2>/dev/null || true
  npx prisma db push --schema=packages/database/prisma/schema.prisma --accept-data-loss || \
  npx prisma db push --schema=prisma/schema.prisma --accept-data-loss || true
fi

# 4. Start MultiWA Gateway API process
echo "==> [Gateway Entrypoint] Starting Multi-Adapter API Gateway..."

if [ -f "/docker/entrypoint-api.sh" ]; then
  exec /docker/entrypoint-api.sh "$@"
elif [ -f "/app/docker/entrypoint-api.sh" ]; then
  exec /app/docker/entrypoint-api.sh "$@"
else
  cd /app 2>/dev/null || true
  if [ -f "apps/api/dist/main.js" ]; then
    exec node apps/api/dist/main.js
  elif [ -f "dist/apps/api/main.js" ]; then
    exec node dist/apps/api/main.js
  elif [ -f "dist/main.js" ]; then
    exec node dist/main.js
  else
    exec npm run start:prod || exec pnpm start
  fi
fi