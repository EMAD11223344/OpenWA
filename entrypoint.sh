#!/bin/sh
set -e

# Start the embedded Tor SOCKS5 proxy (bypass HF datacenter IP block).
# Non-fatal: if Tor can't start, the API still boots.
mkdir -p /tmp/tor-data
cat > /tmp/torrc <<'EOF'
SocksPort 127.0.0.1:9050
RunAsDaemon 1
DataDirectory /tmp/tor-data
Log notice file /tmp/tor.log
EOF
tor -f /tmp/torrc || echo "WARNING: Tor failed to start."

# Self-diagnostic: confirm Tor actually bootstrapped a circuit.
# HF Spaces may block the Tor network — this check prints the verdict to the
# container logs a few minutes after boot so we know whether the proxy is usable.
(
  i=0
  while [ $i -lt 180 ]; do
    if grep -q "Bootstrapped 100" /tmp/tor.log 2>/dev/null; then
      echo "TOR CHECK: Tor bootstrapped OK — proxy usable."
      echo "WA CHECK: probing https://web.whatsapp.com through Tor (25s)..."
      cd /evolution 2>/dev/null || true
      node -e "
const { SocksProxyAgent } = require('socks-proxy-agent');
const agent = new SocksProxyAgent('socks5://127.0.0.1:9050');
fetch('https://web.whatsapp.com', { agent, redirect: 'manual', signal: AbortSignal.timeout(25000) })
  .then(r => console.log('WA CHECK: web.whatsapp.com responded status=' + r.status + ' (WhatsApp reachable through Tor)'))
  .catch(e => console.log('WA CHECK: FAILED — ' + e.message + ' (WhatsApp rejects this Tor exit IP)'));
" 2>&1 || echo "WA CHECK: node check unavailable"
      exit 0
    fi
    sleep 5
    i=$((i+5))
  done
  echo "TOR CHECK: FAILED — Tor did not bootstrap in 180s."
  echo "TOR CHECK: likely cause: HF blocks the Tor network, or WhatsApp blocks Tor exit IPs."
  echo "TOR CHECK: fix: set HF Space secrets PROXY_HOST / PROXY_PORT / PROXY_PROTOCOL to a residential/mobile proxy."
  tail -5 /tmp/tor.log 2>/dev/null || true
) &

# Automatically run database migrations when DATABASE_ENABLED=true
if [ "$DATABASE_ENABLED" = "true" ] && [ -n "$DATABASE_CONNECTION_URI" ]; then
  echo "==> [Evolution API Entrypoint] Deploying Prisma database migrations..."
  npm run db:deploy || true
fi

# Handover control to the primary process
exec "$@"
