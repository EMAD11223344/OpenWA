# Evolution API v2 for Hugging Face Spaces
FROM evoapicloud/evolution-api:v2.3.6

USER root

# Install lightweight embedded Redis server for native cache layer
RUN apk add --no-cache redis

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
ENV WEBSOCKET_ALLOWED_HOSTS=*
ENV CONFIG_SESSION_PHONE_CLIENT="Evolution API"
ENV QRCODE_LIMIT=30

# CORS Configuration for Browser & Manager UI
ENV CORS_ORIGIN=*
ENV CORS_METHODS=GET,POST,PUT,DELETE
ENV CORS_CREDENTIALS=true

# Cache Configuration (Embedded Redis on localhost)
ENV CACHE_REDIS_ENABLED=true
ENV CACHE_REDIS_URI=redis://127.0.0.1:6379/6
ENV CACHE_REDIS_PREFIX_KEY=evolution
ENV CACHE_LOCAL_ENABLED=false

# Force IPv4 DNS order & low autoselection timeout to eliminate WebSocket handshake timeouts
ENV NODE_OPTIONS="--dns-result-order=ipv4first --network-family-autoselection-attempt-timeout=500"

# Database Configuration
ENV DATABASE_ENABLED=false
ENV DATABASE_PROVIDER=postgresql
ENV DATABASE_CONNECTION_URI=postgresql://postgres:postgres@localhost:5432/evolution

# Logging
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
