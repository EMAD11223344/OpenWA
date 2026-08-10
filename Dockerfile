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

# WebSocket & QR Code Settings for Baileys Engine
ENV WEBSOCKET_ENABLED=true
ENV CONFIG_SESSION_PHONE_CLIENT="Evolution API"
ENV QRCODE_LIMIT=30

# Database Configuration (Disabled by default for standalone HF Spaces execution; enable & set URI in HF Secrets if using Postgres)
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
