# Evolution API v2 Container for Hugging Face Spaces & Docker Deployments
FROM evoapicloud/evolution-api:v2.3.6

USER root

# Configure Hugging Face Docker SDK Port (7860)
ENV SERVER_PORT=7860
ENV PORT=7860
ENV NODE_ENV=production

# Security & Default Auth Key
# AUTHENTICATION_API_KEY is deliberately NOT set here. Add it as a
# "Repository secret" in the Space's Settings instead — HF injects
# secrets as runtime env vars, so the app picks it up the same way.
# A key baked into the image is visible to anyone who can see the repo.
ENV AUTHENTICATION_TYPE=apikey
ENV SERVER_URL=https://myarenaosx-openwa.hf.space
ENV AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true

# Instance Retention
ENV DEL_INSTANCE=false

# WebSocket & QR Code Event Broadcasts
ENV WEBSOCKET_ENABLED=true
ENV WEBSOCKET_GLOBAL_EVENTS=true
ENV WEBSOCKET_ALLOWED_HOSTS=*
ENV CONFIG_SESSION_PHONE_CLIENT="Chrome (Windows)"
ENV CONFIG_SESSION_PHONE_NAME="Windows"
# CONFIG_SESSION_PHONE_VERSION is deliberately left unset. evolution-api
# auto-fetches the current WhatsApp Web version at startup when this is
# empty — that behavior was added specifically so people stop hardcoding
# a value that goes stale within weeks and breaks pairing. If auto-fetch
# ever fails (e.g. an outbound network hiccup on HF's side), check
# github.com/wppconnect-team/wa-version for a current value and set it
# as a Space runtime variable — not back in this file.
ENV QRCODE_LIMIT=60

# CORS Configuration for Browser & Manager UI
# CORS_ORIGIN can't be "*" while CORS_CREDENTIALS=true — browsers reject
# that combination outright, which silently breaks credentialed fetches
# from the Manager UI (status/QR polling). Scoped to the Space's own
# origin below; add more comma-separated origins if another frontend
# needs credentialed access.
ENV CORS_ORIGIN=https://myarenaosx-openwa.hf.space
ENV CORS_METHODS=GET,POST,PUT,DELETE
ENV CORS_CREDENTIALS=true

# Cache Configuration — local in-process cache instead of Redis.
# CACHE_REDIS_ENABLED=true is unreliable on evolution-api v2.3.6 (the
# Redis client disconnects intermittently, which blocks QR generation)
# and buys nothing in a single-instance deployment — Redis only matters
# once you're sharing cache across multiple instances.
ENV CACHE_LOCAL_ENABLED=true
ENV CACHE_REDIS_ENABLED=false

# Force IPv4 DNS order & low autoselection timeout
ENV NODE_OPTIONS="--dns-result-order=ipv4first --network-family-autoselection-attempt-timeout=500"

# Database Configuration
ENV DATABASE_ENABLED=false
ENV DATABASE_PROVIDER=postgresql
ENV DATABASE_CONNECTION_URI=postgresql://postgres:postgres@localhost:5432/evolution

# Logging
ENV LOG_LEVEL=INFO
ENV LOG_COLOR=true

# Copy auto-schema initialization entrypoint script
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Ensure workspace directories exist with full write access
RUN mkdir -p /app/instances /app/store /app/public && \
    chmod -R 777 /app/instances /app/store /app/public

# Expose HF Spaces default port
EXPOSE 7860

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["npm", "run", "start:prod"]