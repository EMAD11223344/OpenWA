# Evolution API v2 Container for Hugging Face Spaces & Docker Deployments
FROM evoapicloud/evolution-api:latest

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
ENV WEBSOCKET_GLOBAL_EVENTS=true
ENV CONFIG_SESSION_PHONE_CLIENT="Evolution API"
ENV QRCODE_LIMIT=30

# Fast Connection & Live Data Persistence
ENV CONFIG_SESSION_PHONE_SYNC_FULL_HISTORY=false
ENV DATABASE_SAVE_DATA_INSTANCE=true
ENV DATABASE_SAVE_DATA_NEW_MESSAGE=true
ENV DATABASE_SAVE_MESSAGE_UPDATE=true
ENV DATABASE_SAVE_DATA_CONTACTS=true
ENV DATABASE_SAVE_DATA_CHATS=true

# Default Event Toggles for Webhooks / WebSockets
ENV WEBHOOK_EVENTS_QRCODE_UPDATED=true
ENV WEBHOOK_EVENTS_CONNECTION_UPDATE=true
ENV WEBHOOK_EVENTS_MESSAGES_UPSERT=true
ENV WEBHOOK_EVENTS_SEND_MESSAGE=true

# Database & Cache Configuration
ENV DATABASE_ENABLED=false
ENV DATABASE_PROVIDER=postgresql
ENV DATABASE_CONNECTION_URI=postgresql://postgres:postgres@localhost:5432/evolution
ENV CACHE_REDIS_ENABLED=false
ENV CACHE_LOCAL_ENABLED=true

# Logging
ENV LOG_LEVEL=INFO
ENV LOG_COLOR=true

WORKDIR /evolution

# Copy auto-schema initialization entrypoint script
COPY entrypoint.sh /evolution/entrypoint.sh
RUN chmod +x /evolution/entrypoint.sh

# Ensure workspace directories exist with full write access
RUN mkdir -p /evolution/instances /evolution/store /evolution/public && \
    chmod -R 777 /evolution/instances /evolution/store /evolution/public

# Expose HF Spaces default port
EXPOSE 7860

ENTRYPOINT ["/evolution/entrypoint.sh"]
CMD ["node", "dist/main"]
