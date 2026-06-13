# ===== Stage 1: Backend Builder =====
FROM node:22-slim AS backend-builder
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build

# ===== Stage 2: Dashboard Builder =====
FROM node:20-alpine AS dashboard-builder
WORKDIR /app
COPY dashboard/package*.json ./
RUN npm ci --legacy-peer-deps
COPY dashboard/ .
RUN npm run build

# ===== Stage 3: Production =====
FROM node:22-slim AS production

# Install Nginx, Chrome/Chromium, curl, and required dependencies
RUN apt-get update && apt-get install -y \
    nginx \
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    dumb-init \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set Chrome executable path for Puppeteer
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PORT=2785

WORKDIR /app

# Copy production package files and install dependencies
COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force

# Copy built NestJS backend from backend-builder stage
COPY --from=backend-builder /app/dist ./dist

# Copy built React dashboard from dashboard-builder stage
COPY --from=dashboard-builder /app/dist /usr/share/nginx/html

# Copy Nginx and startup scripts
COPY nginx.huggingface.conf /etc/nginx/sites-available/default
COPY nginx.huggingface.conf /etc/nginx/conf.d/default.conf
COPY start.huggingface.sh ./start.sh

# Create required directories and set permissions
RUN mkdir -p ./data/sessions ./data/media \
    /var/cache/nginx /var/run /var/log/nginx /var/lib/nginx /usr/share/nginx/html && \
    chmod +x ./start.sh && \
    chmod -R 777 /var/cache/nginx /var/run /var/log/nginx /var/lib/nginx /usr/share/nginx/html /app

# Expose Hugging Face default port
EXPOSE 7860

# Start both services
ENTRYPOINT ["dumb-init", "--"]
CMD ["./start.sh"]