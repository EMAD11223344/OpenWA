# Evolution API v2 Container for Hugging Face Spaces & Docker Deployments
FROM evoapicloud/evolution-api:latest

# Configure Hugging Face Docker SDK Port (7860)
ENV SERVER_PORT=7860
ENV PORT=7860
ENV NODE_ENV=production

# Ensure workspace directories exist with full write access
RUN mkdir -p /app/instances /app/store /app/public && \
    chmod -R 777 /app/instances /app/store /app/public

# Expose HF Spaces default port
EXPOSE 7860
