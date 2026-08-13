# Evolution API v2 Container for Hugging Face Spaces & Docker Deployments
FROM evoapicloud/evolution-api:v2.2.2

USER root

# Install lightweight embedded Redis server for native cache layer
RUN apk add --no-cache redis

# Configure Hugging Face Docker SDK Port (7860)
ENV SERVER_PORT=7860
ENV PORT=7860
ENV NODE_ENV=production

# Security & Default Auth Key
ENV AUTHENTICATION_TYPE=apikey
ENV AUTHENTICATION_API_KEY=evolution_secret_key_7860
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
ENV CONFIG_SESSION_PHONE_VERSION=2.3000.1043857760
ENV QRCODE_LIMIT=60

# CORS Configuration for Browser & Manager UI
ENV CORS_ORIGIN=*
ENV CORS_METHODS=GET,POST,PUT,DELETE
ENV CORS_CREDENTIALS=true

# Cache Configuration (Embedded Redis on localhost)
ENV CACHE_REDIS_ENABLED=true
ENV CACHE_REDIS_URI=redis://127.0.0.1:6379/6
ENV CACHE_REDIS_PREFIX_KEY=evolution

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
