# Evolution API v2 for Hugging Face Spaces — clean rebuild from zero
# Official image per evolution-foundation/evolution-api README (evoapicloud/evolution-api)
FROM evoapicloud/evolution-api:v2.3.7

USER root

# Tor SOCKS5 proxy to bypass the HF/AWS datacenter IP block (WhatsApp refuses datacenter IPs).
# PROXY_PROTOCOL accepts http | https | socks | socks4 | socks5 (official docs: Network & Proxy Configuration)
RUN apk add --no-cache tor

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

# Global proxy (default for instances without their own proxy)
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
