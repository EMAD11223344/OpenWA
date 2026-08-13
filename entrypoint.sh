#!/bin/bash
set -e

# Start PostgreSQL
echo "==> [Entrypoint] Starting PostgreSQL..."
mkdir -p /run/postgresql
chown postgres:postgres /run/postgresql
su - postgres -c "pg_ctl start -D /var/lib/postgresql/data -l /var/lib/postgresql/logfile"

# Wait for PostgreSQL to be ready
until su - postgres -c "pg_isready -q"; do
  echo "Waiting for PostgreSQL..."
  sleep 1
done
echo "==> PostgreSQL is ready!"

# Start Redis in background
echo "==> [Entrypoint] Starting Redis..."
redis-server --bind 127.0.0.1 --port 6379 &
sleep 2

# Verify Redis
if redis-cli ping 2>/dev/null | grep -q "PONG"; then
  echo "==> Redis is ready!"
else
  echo "==> WARNING: Redis not responding!"
fi

# ✅ Run original database deployment (Prisma migrations)
echo "==> [Entrypoint] Deploying database..."
cd /evolution
. ./Docker/scripts/deploy_database.sh

# Start API
echo "==> [Entrypoint] Starting Evolution API..."
exec npm run start:prod