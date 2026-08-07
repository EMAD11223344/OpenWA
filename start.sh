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

# Use torsocks to transparently route ALL TCP connections through Tor SOCKS5.
# This works at the LD_PRELOAD level, intercepting connect() syscalls from
# both Python AND the Go CGO binary (neonize/whatsmeow), so even though
# neonize doesn't expose proxy settings in Python, all WebSocket connections
# to web.whatsapp.com will route through Tor's clean exit node IPs.
echo "Starting Uvicorn ASGI server via torsocks (transparent SOCKS5 proxy)..."
exec torsocks uvicorn app.main:asgi_app --host 0.0.0.0 --port 8000
