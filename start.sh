#!/bin/bash
set -e

# Start Tor service in background
service tor start

# Wait up to 10 seconds for Tor SOCKS5 proxy on 127.0.0.1:9050
echo "Waiting for Tor SOCKS5 proxy to become ready..."
for i in {1..10}; do
  if nc -z 127.0.0.1 9050 2>/dev/null || (exec 3<>/dev/tcp/127.0.0.1/9050) 2>/dev/null; then
    echo "Tor SOCKS5 proxy is ready on 127.0.0.1:9050"
    break
  fi
  sleep 1
done

# Export proxy environment variables for Python & Go/whatsmeow
export HTTP_PROXY="socks5://127.0.0.1:9050"
export HTTPS_PROXY="socks5://127.0.0.1:9050"
export ALL_PROXY="socks5://127.0.0.1:9050"
export http_proxy="socks5://127.0.0.1:9050"
export https_proxy="socks5://127.0.0.1:9050"
export all_proxy="socks5://127.0.0.1:9050"

echo "Starting Uvicorn ASGI server with Tor SOCKS5 Proxy..."
exec uvicorn app.main:asgi_app --host 0.0.0.0 --port 8000
