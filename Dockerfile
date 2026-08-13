# Evolution API v2 Container for Hugging Face Spaces & Docker Deployments
FROM evoapicloud/evolution-api:v2.3.7

USER root

# Embed Tor SOCKS5 proxy to bypass the Hugging Face / AWS datacenter IP block.
# This proxy existed in the original WAHA/neonize build (commits e59e86d / 3ce52ed /
# c2fc5cf) and was dropped during the migration to the Evolution API image
# (commit 8134104 "Clear OpenWA repo") — the root cause of the empty QR code.
RUN apk add --no-cache tor

# Configure Hugging Face Docker SDK Port (7860)
ENV SERVER_PORT=7860
ENV PORT=7860
ENV NODE_ENV=production

# Security & Default Auth Key
ENV AUTHENTICATION_TYPE=apikey
ENV AUTHENTICATION_API_KEY=evolution_secret_key_7860
ENV SERVER_URL=https://myarenaosx-openwa.hf.space
ENV AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true

# Instance Retention (Do not auto-delete un-paired instances)
ENV DEL_INSTANCE=false

# WebSocket & Real-time QR Code Event Broadcasts
ENV WEBSOCKET_ENABLED=true
ENV WEBSOCKET_GLOBAL_EVENTS=false
ENV WEBSOCKET_ALLOWED_HOSTS=myarenaosx-openwa.hf.space
ENV CONFIG_SESSION_PHONE_CLIENT="Evolution API"
ENV QRCODE_LIMIT=30

# Default Event Toggles for Webhooks / WebSockets
ENV WEBHOOK_EVENTS_QRCODE_UPDATED=true
ENV WEBHOOK_EVENTS_CONNECTION_UPDATE=true
ENV WEBHOOK_EVENTS_MESSAGES_UPSERT=true
ENV WEBHOOK_EVENTS_SEND_MESSAGE=true

# Cache (local in-memory; no Redis available on HF Spaces)
ENV CACHE_REDIS_ENABLED=false
ENV CACHE_LOCAL_ENABLED=true

# Global SOCKS5 proxy (embedded Tor) — routes Baileys / WhatsApp Web through a
# non-datacenter IP so WhatsApp actually returns a QR code.
# Confirmed against official source (src/utils/makeProxyAgent.ts): PROXY_PROTOCOL
# accepts http | socks | socks5, so pointing directly at Tor's SOCKS5 port works.
# Override these with HF Space secrets if you prefer a residential/mobile proxy.
ENV PROXY_HOST=127.0.0.1
ENV PROXY_PORT=9050
ENV PROXY_PROTOCOL=socks5

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
