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

# 2. Map DATABASE_CONNECTION_URI to DATABASE_URL and DIRECT_URL
if [ -n "$DATABASE_CONNECTION_URI" ]; then
  echo "==> [Gateway Entrypoint] Mapping DATABASE_CONNECTION_URI to DATABASE_URL..."
  export DATABASE_URL="$DATABASE_CONNECTION_URI"
  export DIRECT_URL="$DATABASE_CONNECTION_URI"
fi

# 3. Synchronize Prisma Database Schema (Persistent Push)
if [ -n "$DATABASE_URL" ]; then
  echo "==> [Gateway Entrypoint] Locating source Prisma schema in container..."
  SCHEMA_PATH=$(find /app -name "schema.prisma" 2>/dev/null | grep -v ".prisma/client" | head -n 1)
  if [ -z "$SCHEMA_PATH" ]; then
    SCHEMA_PATH=$(find /app -name "schema.prisma" 2>/dev/null | head -n 1)
  fi
  
  echo "==> [Gateway Entrypoint] Using Prisma schema: $SCHEMA_PATH"
  if [ -n "$SCHEMA_PATH" ]; then
    echo "==> [Gateway Entrypoint] Synchronizing database schema tables..."
    prisma db push --url "$DATABASE_URL" --schema="$SCHEMA_PATH" --accept-data-loss || \
    npx --yes prisma db push --url "$DATABASE_URL" --schema="$SCHEMA_PATH" --accept-data-loss || true
    echo "==> [Gateway Entrypoint] Database schema push completed."
  fi
fi

# 4. Start MultiWA Gateway API on internal port 3333 in background
echo "==> [Gateway Entrypoint] Starting MultiWA Backend on internal port 3333..."
export PORT=3333
export API_PORT=3333
export API_HOST=0.0.0.0

if [ -f "/docker/entrypoint-api.sh" ]; then
  /docker/entrypoint-api.sh "$@" &
elif [ -f "/app/docker/entrypoint-api.sh" ]; then
  /app/docker/entrypoint-api.sh "$@" &
else
  cd /app 2>/dev/null || true
  if [ -f "apps/api/dist/main.js" ]; then
    node apps/api/dist/main.js &
  elif [ -f "dist/apps/api/main.js" ]; then
    node dist/apps/api/main.js &
  elif [ -f "dist/main.js" ]; then
    node dist/main.js &
  else
    npm run start:prod &
  fi
fi

# 5. Start Gateway Proxy & Dashboard on Port 7860 in foreground
echo "==> [Gateway Entrypoint] Starting MultiWA Dashboard & Gateway Proxy on port 7860..."
export PORT=7860
export TARGET_PORT=3333

sleep 2
exec node /app/proxy.js