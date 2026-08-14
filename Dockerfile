# Multi-Channel Unified API Gateway
FROM ribato/multiwa-api:latest

USER root

# Install system dependencies (Redis for message queues, Chromium for real-browser adapter, and Prisma CLI globally)
RUN apt-get update && \
    apt-get install -y --no-install-recommends redis-server chromium bash curl fonts-liberation libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libgbm1 libasound2 && \
    npm install -g prisma && \
    rm -rf /var/lib/apt/lists/*

# Configure Hugging Face Spaces Port (7860)
ENV PORT=7860
ENV API_PORT=3333
ENV API_HOST=0.0.0.0
ENV NODE_ENV=production

# Queue & Storage
ENV REDIS_URL=redis://127.0.0.1:6379

# Engine Configuration
ENV DEFAULT_ENGINE=whatsapp-web-js
ENV CHROMIUM_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_TIMEOUT=120000

# Security Secrets
ENV JWT_SECRET=c025199d816db2613ca48c1efaef8e61b69aa155a26067e9747d98fccf31d2b7
ENV JWT_REFRESH_SECRET=c025199d816db2613ca48c1efaef8e61b69aa155a26067e9747d98fccf31d2b7_refresh
ENV ENCRYPTION_KEY=c025199d816db2613ca48c1efaef8e61b69aa155a26067e9747d98fccf31d2b7

# Ensure storage and dashboard directories exist
RUN mkdir -p /data/sessions /app/sessions /app/storage /app/uploads /app/dashboard && \
    chmod -R 777 /data /app 2>/dev/null || true

# Copy dashboard SPA, gateway proxy, and engine patcher
COPY dashboard /app/dashboard
COPY proxy.js /app/proxy.js
COPY patch_engine.js /app/patch_engine.js

# Copy custom entrypoint wrapper
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Expose HF Spaces default port
EXPOSE 7860

ENTRYPOINT ["/app/entrypoint.sh"]