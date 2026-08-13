FROM evoapicloud/evolution-api:v2.3.6
USER root

# ✅ Alpine: apk add (مش apt-get!)
RUN apk add --no-cache redis postgresql postgresql-client bash

# ✅ Setup PostgreSQL embedded
RUN mkdir -p /var/lib/postgresql/data /run/postgresql && \
    chown -R postgres:postgres /var/lib/postgresql /run/postgresql && \
    su - postgres -c "initdb -D /var/lib/postgresql/data --locale=C" && \
    echo "host all all 127.0.0.1/32 trust" >> /var/lib/postgresql/data/pg_hba.conf

# ✅ Create evolution DB and user
RUN su - postgres -c "pg_ctl start -D /var/lib/postgresql/data -l /var/lib/postgresql/logfile" && \
    sleep 3 && \
    su - postgres -c "psql -c \"CREATE USER evolution WITH PASSWORD 'evolution_pass';\"" && \
    su - postgres -c "psql -c \"CREATE DATABASE evolution OWNER evolution;\"" && \
    su - postgres -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE evolution TO evolution;\"" && \
    su - postgres -c "pg_ctl stop -D /var/lib/postgresql/data"

# HF Spaces Port
ENV SERVER_PORT=7860
ENV PORT=7860
ENV NODE_ENV=production

# Auth
ENV AUTHENTICATION_TYPE=apikey
ENV AUTHENTICATION_API_KEY=evolution_secret_key_7860
ENV SERVER_URL=https://your-username-your-space.hf.space
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

# Cache (Embedded Redis)
ENV CACHE_REDIS_ENABLED=true
ENV CACHE_REDIS_URI=redis://127.0.0.1:6379/6
ENV CACHE_REDIS_PREFIX_KEY=evolution

# ✅ Database MUST be true for v2!
ENV DATABASE_ENABLED=true
ENV DATABASE_PROVIDER=postgresql
ENV DATABASE_CONNECTION_URI=postgresql://evolution:evolution_pass@127.0.0.1:5432/evolution?schema=public

# Logging
ENV LOG_LEVEL=INFO
ENV LOG_COLOR=true

# Network
ENV NODE_OPTIONS="--dns-result-order=ipv4first --network-family-autoselection-attempt-timeout=500"

# ✅ Correct paths: /evolution/ (مش /app/)
RUN mkdir -p /evolution/instances /evolution/store /evolution/public && \
    chmod -R 777 /evolution/instances /evolution/store /evolution/public

# ✅ Copy entrypoint to /evolution/ (مش /app/)
COPY entrypoint.sh /evolution/entrypoint.sh
RUN chmod +x /evolution/entrypoint.sh

EXPOSE 7860

ENTRYPOINT ["/evolution/entrypoint.sh"]