#!/bin/bash
set -e

echo "Starting Uvicorn ASGI server..."
exec uvicorn app.main:asgi_app --host 0.0.0.0 --port 8000
