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

# 2. Map DATABASE_CONNECTION_URI to DATABASE_URL if present
if [ -n "$DATABASE_CONNECTION_URI" ]; then
  echo "==> [Gateway Entrypoint] Mapping DATABASE_CONNECTION_URI to DATABASE_URL..."
  export DATABASE_URL="$DATABASE_CONNECTION_URI"
fi

# 3. Synchronize Prisma Database Schema (Clean Wipe & Fresh Push)
if [ -n "$DATABASE_URL" ]; then
  echo "==> [Gateway Entrypoint] Locating source Prisma schema in container..."
  SCHEMA_PATH=$(find /app -name "schema.prisma" 2>/dev/null | grep -v ".prisma/client" | head -n 1)
  if [ -z "$SCHEMA_PATH" ]; then
    SCHEMA_PATH=$(find /app -name "schema.prisma" 2>/dev/null | head -n 1)
  fi
  
  echo "==> [Gateway Entrypoint] Using Prisma schema: $SCHEMA_PATH"
  if [ -n "$SCHEMA_PATH" ]; then
    echo "==> [Gateway Entrypoint] Performing database clean reset & schema deployment..."
    prisma db push --force-reset --schema="$SCHEMA_PATH" --accept-data-loss || \
    /app/node_modules/.bin/prisma db push --force-reset --schema="$SCHEMA_PATH" --accept-data-loss || \
    npx --yes prisma db push --force-reset --schema="$SCHEMA_PATH" --accept-data-loss || true
    echo "==> [Gateway Entrypoint] Database schema push completed."
  fi
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