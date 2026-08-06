---
title: Neonize WhatsApp Gateway
emoji: 🟢
colorFrom: green
colorTo: green
sdk: docker
app_port: 8000
pinned: false
---

# 🟢 Neonize WhatsApp Gateway

High-performance Python microservice wrapping the **Neonize** (Go `whatsmeow` CGO core) native WhatsApp multi-device protocol.

## Features
- **Ultra-low RAM**: 15MB - 45MB memory footprint per session (no Chromium).
- **Sub-second Startup**: Direct WebSocket connections with native Noise handshakes.
- **Socket.IO & REST**: Real-time event broadcasting (`session.qr`, `message.received`, `session.status`).
