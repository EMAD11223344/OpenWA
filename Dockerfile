FROM evoapicloud/evolution-api:v2.3.6
USER root

# ✅ ثبت Redis بـ apt-get (لأن الصورة Debian-based)
RUN apt-get update && apt-get install -y redis-server && rm -rf /var/lib/apt/lists/*

# HF Spaces Port
ENV SERVER_PORT=7860
ENV PORT=7860
ENV NODE_ENV=production

# Auth
ENV AUTHENTICATION_TYPE=apikey
ENV AUTHENTICATION_API_KEY=evolution_secret_key_7860
ENV SERVER_URL=https://your-space-name.hf.space
ENV AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true

# Instance
ENV DEL_INSTANCE=false

# WebSocket & QR
ENV WEBSOCKET_ENABLED=true
ENV WEBSOCKET_GLOBAL_EVENTS=true
ENV WEBSOCKET_ALLOWED_HOSTS=*
ENV CONFIG_SESSION_PHONE_CLIENT="Chrome (Windows)"
ENV CONFIG_SESSION_PHONE_NAME="Windows"
ENV QRCODE_LIMIT=60

# CORS
ENV CORS_ORIGIN=*
ENV CORS_METHODS=GET,POST,PUT,DELETE
ENV CORS_CREDENTIALS=true

# Cache
ENV CACHE_REDIS_ENABLED=true
ENV CACHE_REDIS_URI=redis://127.0.0.1:6379/6
ENV CACHE_REDIS_PREFIX_KEY=evolution

# ✅ شغّل الداتابيز (مش تقدر تستغنى عنها في v2)
ENV DATABASE_ENABLED=true
ENV DATABASE_PROVIDER=postgresql
ENV DATABASE_CONNECTION_URI=postgresql://postgres:postgres@localhost:5432/evolution?schema=public

# Logging
ENV LOG_LEVEL=INFO
ENV LOG_COLOR=true

# Network
ENV NODE_OPTIONS="--dns-result-order=ipv4first --network-family-autoselection-attempt-timeout=500"

# ✅ المسارات الصحيحة /evolution/ مش /app/
RUN mkdir -p /evolution/instances /evolution/store /evolution/public && \
    chmod -R 777 /evolution/instances /evolution/store /evolution/public

# Copy entrypoint
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 7860

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["npm", "run", "start:prod"]