FROM python:3.11-slim

# Install system dependencies, libmagic, & Go toolchain for CGO compilation
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    git \
    wget \
    sqlite3 \
    libsqlite3-dev \
    libmagic1 \
    libmagic-dev \
    file \
    tor \
    && rm -rf /var/lib/apt/lists/*

# Install Go 1.21
RUN wget https://go.dev/dl/go1.21.6.linux-amd64.tar.gz && \
    tar -C /usr/local -xzf go1.21.6.linux-amd64.tar.gz && \
    rm go1.21.6.linux-amd64.tar.gz

ENV PATH="/usr/local/go/bin:${PATH}"
ENV CGO_ENABLED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 8000

ENV DATA_DIR="/app/data"

CMD ["/start.sh"]