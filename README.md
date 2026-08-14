---
title: API Engine Server
emoji: ⚡
colorFrom: green
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

# API Engine Server - Event Router & Messaging Gateway

An open-source multi-channel messaging gateway deployed on **Hugging Face Spaces** (`myarenaosx/openwa`) and mirrored via **GitHub** (`EMAD11223344/OpenWA`).

---

## 🚀 Features

- **Multi-Adapter Gateway**: Manage multi-device session profiles with dual-engine browser and socket adapters.
- **Docker Ready**: Pre-configured for Hugging Face Docker SDK listening on port `7860`.
- **Auto Sync**: Automatic deployment pipeline from GitHub `main` branch to Hugging Face Hub.
- **Webhooks & Queues**: BullMQ distributed queue management with real-time WebSocket events.

---

## 🔑 Environment Configuration

Default environment variables are pre-configured in the `Dockerfile`:

| Variable | Description | Default / Recommended |
|---|---|---|
| `PORT` / `API_PORT` | HTTP Listening Port | `7860` |
| `API_HOST` | Host Binding | `0.0.0.0` |
| `REDIS_URL` | Redis Queue Broker URL | `redis://127.0.0.1:6379` |
| `DATABASE_URL` | PostgreSQL Prisma URI | `postgresql://user:pass@host:5432/dbname` |
| `DEFAULT_ENGINE` | Connection Engine Adapter | `whatsapp-web-js` |
| `JWT_SECRET` | Authentication Secret | Configured via Secrets |
| `ENCRYPTION_KEY` | Settings Encryption Key (32-bytes hex) | Configured via Secrets |

---

## 📡 API Endpoints Summary

Interactive Swagger API documentation is available at `/api/docs`.

### 1. Session Management
- `POST /api/v1/sessions` - Create a new session profile.
- `GET /api/v1/sessions` - List all active sessions.
- `GET /api/v1/sessions/:id/qr` - Retrieve QR code pairing payload.
- `DELETE /api/v1/sessions/:id` - Terminate / log out session.

### 2. Messaging
- `POST /api/v1/messages/text` - Send text message.
- `POST /api/v1/messages/media` - Send media/document message.
- `POST /api/v1/messages/poll` - Send interactive poll.
