# Evolution API v2.3.6 for Hugging Face Spaces
FROM evoapicloud/evolution-api:v2.3.6

USER root

# Install Redis (embedded) + supervisor to manage processes
RUN apt-get update && apt-get install -y redis-server supervisor && rm -rf /var/lib/apt/lists/*

# HF Spaces requires port 7860
ENV SERVER_PORT=7860
ENV PORT=7860
ENV NODE_ENV=production

# Auth & Server
ENV AUTHENTICATION_TYPE=apikey
ENV AUTHENTICATION_API_KEY=evolution_secret_key_7860
ENV SERVER_URL=https://your-username-your-space.hf.space  # <-- غيّر ده لـ URL بتاعك
ENV AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true

# Instance settings
ENV DEL_INSTANCE=false
ENV DEL_INSTANCE_ON_DISCONNECT=false

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

# Cache (Embedded Redis)
ENV CACHE_REDIS_ENABLED=true
ENV CACHE_REDIS_URI=redis://127.0.0.1:6379/6
ENV CACHE_REDIS_PREFIX_KEY=evolution

# Database (Required for v2!)
ENV DATABASE_ENABLED=true
ENV DATABASE_PROVIDER=postgresql
ENV DATABASE_CONNECTION_URI=postgresql://postgres:postgres@localhost:5432/evolution?schema=public

# Logging
ENV LOG_LEVEL=INFO
ENV LOG_COLOR=true

# DNS & Network stability
ENV NODE_OPTIONS="--dns-result-order=ipv4first --network-family-autoselection-attempt-timeout=500"

# Create supervisor config to run Redis + API together
RUN mkdir -p /var/log/supervisor
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Fix paths for Evolution API (not /app!)
RUN mkdir -p /evolution/instances /evolution/store /evolution/public && \
    chmod -R 777 /evolution/instances /evolution/store /evolution/public

EXPOSE 7860

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]