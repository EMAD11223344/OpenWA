---
title: Evolution API v2
emoji: ⚡
colorFrom: green
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

# Evolution API v2 - Hugging Face & GitHub Service

An open-source WhatsApp API based on Baileys ([evolution-foundation/evolution-api](https://github.com/evolution-foundation/evolution-api)), deployed on **Hugging Face Spaces** (`myarenaosx/openwa`) and mirrored via **GitHub** (`EMAD11223344/OpenWA`).

---

## 🚀 Features

- **WhatsApp Web API**: Manage multi-device WhatsApp instances, send text, media, audio, buttons, list messages, and polls.
- **Docker Ready**: Pre-configured for Hugging Face Docker SDK listening on port `7860`.
- **Auto Sync**: Automatic deployment pipeline from GitHub `main` branch to Hugging Face Hub.
- **Webhooks & Events**: Real-time webhook event triggers for message status, connections, QR codes, and chat updates.

---

## 🔑 Environment Configuration

Set these environment variables in your Hugging Face Space Settings or local `.env` file:

| Variable | Description | Default / Recommended |
|---|---|---|
| `SERVER_PORT` | HTTP Listening Port | `7860` |
| `AUTHENTICATION_API_KEY` | Global API Key for header auth (`apikey`) | `your-secure-api-key` |
| `SERVER_URL` | Public URL of your deployed Space | `https://myarenaosx-openwa.hf.space` |
| `DATABASE_PROVIDER` | Database backend (`local` / `postgres`) | `local` |
| `DATABASE_SAVE_DATA_INSTANCE` | Save instance state to DB | `true` |
| `DATABASE_SAVE_DATA_NEW_MESSAGE` | Save incoming/outgoing messages | `true` |
| `DEL_INSTANCE` | Auto delete instance on logout | `false` |
| `LOG_LEVEL` | Logging detail (`ERROR`, `WARN`, `INFO`, `DEBUG`) | `INFO` |

---

## 📡 API Endpoints Summary

All requests require the `apikey` header matching `AUTHENTICATION_API_KEY`.

### 1. Instance Management
- `POST /instance/create` - Create a new WhatsApp instance.
- `GET /instance/fetchInstances` - List all active instances.
- `GET /instance/connect/{instance_name}` - Get QR code or connection state.
- `DELETE /instance/logout/{instance_name}` - Log out an instance.

### 2. Messaging
- `POST /message/sendText/{instance_name}` - Send text message.
- `POST /message/sendMedia/{instance_name}` - Send image/video/document.
- `POST /message/sendWhatsAppAudio/{instance_name}` - Send voice note (PTT).

---

## 🛠️ GitHub -> Hugging Face Workflow

Every push to the `main` branch automatically triggers `.github/workflows/sync_to_hf.yml`, pushing updates to `https://huggingface.co/spaces/myarenaosx/openwa`.

Requires repository secret:
- `HF_TOKEN`: Hugging Face User Access Token with write access.
