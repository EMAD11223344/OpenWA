#!/bin/sh
set -e

# Start the embedded Tor SOCKS5 proxy (bypass HF datacenter IP block — was dropped
# during the WAHA→Evolution API migration). Non-fatal: if Tor can't start, the
# API still boots, but WhatsApp Web will likely be IP-blocked and the QR stays empty.
mkdir -p /tmp/tor-data
cat > /tmp/torrc <<'EOF'
SocksPort 127.0.0.1:9050
RunAsDaemon 1
DataDirectory /tmp/tor-data
EOF
tor -f /tmp/torrc || echo "WARNING: Tor failed to start; WhatsApp Web may be IP-blocked."

# Front Tor with Privoxy as an HTTP proxy (Evolution API's global PROXY_PROTOCOL=http).
cat >> /etc/privoxy/config <<'EOF'
listen-address 127.0.0.1:8118
forward-socks5 / 127.0.0.1:9050 .
EOF
privoxy /etc/privoxy/config || echo "WARNING: Privoxy failed to start."

# Automatically run database migrations when DATABASE_ENABLED=true
if [ "$DATABASE_ENABLED" = "true" ] && [ -n "$DATABASE_CONNECTION_URI" ]; then
  echo "==> [Evolution API Entrypoint] Deploying Prisma database migrations..."
  npm run db:deploy || true
fi

# Handover control to the primary process
exec "$@"
