#!/bin/bash
set -e

# Start Tor SOCKS5 proxy daemon in background
echo "Starting Tor SOCKS5 proxy daemon..."
service tor start || tor &

# Wait for Tor to be ready (up to 15 seconds)
echo "Waiting for Tor SOCKS5 proxy to become ready on 127.0.0.1:9050..."
for i in $(seq 1 15); do
  if python3 -c "import socket; s=socket.socket(); s.settimeout(1); s.connect(('127.0.0.1',9050)); s.close(); print('OK')" 2>/dev/null; then
    echo "Tor SOCKS5 proxy is ready!"
    break
  fi
  echo "  Waiting... ($i/15)"
  sleep 1
done

# Set PROXY_URL for neonize's NewClient(proxy=...) parameter
# This is read by manager.py create_session() and passed directly
# to whatsmeow's SetProxyAddress() via neonize's built-in proxy support
export PROXY_URL="socks5://127.0.0.1:9050"

echo "Starting Uvicorn ASGI server (proxy=$PROXY_URL)..."
exec uvicorn app.main:asgi_app --host 0.0.0.0 --port 8000
