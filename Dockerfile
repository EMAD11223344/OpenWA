# Evolution API v2 for Hugging Face Spaces — diagnostic build
# Official image per evolution-foundation/evolution-api README (evoapicloud/evolution-api)
FROM evoapicloud/evolution-api:v2.3.6

USER root

# NOTE: v2.3.6 bundles Baileys 7.0.0-rc.6. Tor was tried and REMOVED: the in-container
# WA CHECK proved WhatsApp blocks Tor exit IPs (fetch through Tor failed), while the
# direct version-fetch to web.whatsapp.com SUCCEEDS. So the WhatsApp connection goes
# DIRECT (no proxy). LOG_BAILEYS=debug exposes the real connection state so the
# "no QR" cause (network vs Baileys v7-rc bug) can be seen in the logs.
# NODE_OPTIONS IPv6 timeout is a documented community fix for "QR not appearing".

# Hugging Face Docker SDK port
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

# WebSocket & QR Code Event Broadcasts
ENV WEBSOCKET_ENABLED=true
ENV WEBSOCKET_GLOBAL_EVENTS=true
ENV CONFIG_SESSION_PHONE_CLIENT="Evolution API"
ENV QRCODE_LIMIT=30

# Fast Connection & Disable Full History Sync (Prevents Pre-key upload timeout)
ENV CONFIG_SESSION_PHONE_SYNC_FULL_HISTORY=false

# IPv6 autoselection timeout: community-documented fix for "QR code not appearing"
# when the host has broken IPv6 routing (see evolution-api issue #2367 / PR #2388).
ENV NODE_OPTIONS=--network-family-autoselection-attempt-timeout=1000

# Database Configuration
ENV DATABASE_ENABLED=false
ENV DATABASE_PROVIDER=postgresql
ENV DATABASE_CONNECTION_URI=postgresql://postgres:postgres@localhost:5432/evolution

# Logging — LOG_BAILEYS=debug surfaces Baileys WS handshake, connection state and
# QR emission; without it the "no QR" failure is invisible (default is error-level).
ENV LOG_LEVEL=INFO
ENV LOG_COLOR=true
ENV LOG_BAILEYS=debug

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
