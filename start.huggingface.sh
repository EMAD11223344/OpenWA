#!/bin/bash

# Nginx owns the public Hugging Face port (7860). It serves the static
# dashboard immediately and proxies /api to the NestJS backend, so the Space
# becomes healthy right away — even while the backend is still connecting to
# the database.
echo "🌐 Starting Nginx Web Server on Port 7860..."
nginx -g "daemon off;" &
NGINX_PID=$!

# The backend must always listen on 2785 (nginx proxies to it). Space-level
# PORT variables would otherwise make NestJS fight nginx for port 7860.
export PORT=2785

# Run the backend with auto-restart: if it exits (e.g. database connection
# retries exhausted), keep the container alive and try again instead of
# leaving the Space dead until the 30-minute health timeout.
(
  while true; do
    echo "🚀 Starting OpenWA NestJS Backend on port ${PORT}..."
    node dist/main
    EXIT_CODE=$?
    echo "⚠️  Backend exited with code ${EXIT_CODE}. Restarting in 10s... (check DATABASE_* settings if this repeats)"
    sleep 10
  done
) &

# Keep the container alive as long as nginx runs.
wait $NGINX_PID
