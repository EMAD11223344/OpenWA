#!/bin/sh
set -e

# No embedded Redis here on purpose — this image now runs on
# CACHE_LOCAL_ENABLED instead of CACHE_REDIS_ENABLED (see Dockerfile).
# That sidesteps both the startup race condition an embedded redis-server
# would have had (daemonize returns before the daemon is actually ready)
# and a known Redis-client instability in this evolution-api version that
# was blocking QR generation.

# Automatically run database migrations when DATABASE_ENABLED=true
if [ "$DATABASE_ENABLED" = "true" ] && [ -n "$DATABASE_CONNECTION_URI" ]; then
  echo "==> [Evolution API Entrypoint] Deploying Prisma database migrations..."
  npm run db:deploy || true
fi

# Handover control to the primary process
exec "$@"