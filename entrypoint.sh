#!/bin/sh
set -e

# Automatically run database migrations when DATABASE_ENABLED=true
if [ "$DATABASE_ENABLED" = "true" ] && [ -n "$DATABASE_CONNECTION_URI" ]; then
  echo "==> [Evolution API Entrypoint] Deploying Prisma database migrations..."
  npm run db:deploy || true
fi

# Handover control to the primary process
exec "$@"
