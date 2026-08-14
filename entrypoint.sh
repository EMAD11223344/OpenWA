#!/bin/bash
set -e

# 1. Clean up stale Chromium lockfiles
rm -rf /tmp/.X* /tmp/puppeteer* /app/sessions/*/Singleton* /data/sessions/*/Singleton* 2>/dev/null || true

# 2. Start embedded Redis daemon for BullMQ
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

# 3. Map DATABASE_CONNECTION_URI to DATABASE_URL and DIRECT_URL
if [ -n "$DATABASE_CONNECTION_URI" ]; then
  echo "==> [Gateway Entrypoint] Mapping DATABASE_CONNECTION_URI to DATABASE_URL..."
  export DATABASE_URL="$DATABASE_CONNECTION_URI"
  export DIRECT_URL="$DATABASE_CONNECTION_URI"
fi

# 4. Synchronize Prisma Database Schema (Persistent Push)
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

# 5. Enforce Chromium Container Wrapper (Guarantees IPv4-First, Anti-Hang & Sandboxing in Docker)
if [ -f /usr/bin/chromium ] && [ ! -f /usr/bin/chromium.real ]; then
  echo "==> [Gateway Entrypoint] Setting up Chromium binary wrapper..."
  mv /usr/bin/chromium /usr/bin/chromium.real
  cat << 'EOF' > /usr/bin/chromium
#!/bin/bash
exec /usr/bin/chromium.real \
  --no-sandbox \
  --disable-setuid-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --no-first-run \
  --no-zygote \
  --single-process \
  --dns-result-order=ipv4first \
  --disable-features=IsolateOrigins,site-per-process,VizDisplayCompositor \
  --disable-background-timer-throttling \
  --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding \
  --disable-ipc-flooding-protection \
  --disable-web-security \
  --ignore-certificate-errors \
  "$@"
EOF
  chmod +x /usr/bin/chromium
fi

# 6. Start MultiWA Gateway API in resilient watchdog loop on internal port 3333
export PORT=3333
export API_PORT=3333
export API_HOST=0.0.0.0
export DEFAULT_ENGINE=whatsapp-web-js
export CHROMIUM_PATH=/usr/bin/chromium
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
export PUPPETEER_TIMEOUT=180000
export NAVIGATION_TIMEOUT=180000
export WHATSAPP_TIMEOUT=180000
export QR_TIMEOUT=180000
export PAGE_TIMEOUT=180000
# Pin a known-good WhatsApp Web version so wwebjs fetches HTML from GitHub CDN
# instead of navigating directly to web.whatsapp.com (avoids ERR_TIMED_OUT)
export WWEBJS_WEB_VERSION="2.3000.1041881976-alpha"
export WWEBJS_WEB_VERSION_URL="https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html"
export PUPPETEER_ARGS="--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage,--disable-gpu,--no-first-run,--no-zygote,--single-process,--dns-result-order=ipv4first,--disable-background-timer-throttling"
export CHROMIUM_FLAGS="--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu --no-first-run --no-zygote --single-process --dns-result-order=ipv4first"

start_backend_watchdog() {
  cd /app 2>/dev/null || true
  while true; do
    echo "==> [Backend Watchdog] Launching MultiWA API Engine on port 3333..."
    if [ -f "apps/api/dist/main.js" ]; then
      node apps/api/dist/main.js || echo "==> [Backend Watchdog] Process exited ($?)."
    elif [ -f "dist/apps/api/main.js" ]; then
      node dist/apps/api/main.js || echo "==> [Backend Watchdog] Process exited ($?)."
    elif [ -f "dist/main.js" ]; then
      node dist/main.js || echo "==> [Backend Watchdog] Process exited ($?)."
    elif [ -f "/docker/entrypoint-api.sh" ]; then
      /docker/entrypoint-api.sh || echo "==> [Backend Watchdog] Process exited ($?)."
    else
      npm run start:prod || echo "==> [Backend Watchdog] Process exited ($?)."
    fi
    echo "==> [Backend Watchdog] Restarting backend in 2s..."
    sleep 2
  done
}

start_backend_watchdog &

# 7. Start Gateway Proxy & Dashboard on Port 7860 in foreground
echo "==> [Gateway Entrypoint] Starting MultiWA Dashboard & Gateway Proxy on port 7860..."
export PORT=7860
export TARGET_PORT=3333

sleep 2
exec node /app/proxy.js