---
title: OpenWA Engine
emoji: 💬
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
pinned: false
---

# OpenWA Engine

Central WhatsApp messaging engine for the Business-OS platform.

- **Library:** `@whiskeysockets/baileys@6.7.24` (raw, pinned, no forks)
- **Architecture:** outbound-only control-plane WebSocket into the platform Brain; the engine never accepts inbound connections
- **Auth state:** single encrypted AES-256-GCM snapshot per (account, epoch) in a private S3-compatible bucket; nothing sensitive is written to logs or long-term disk
- **Scope:** session lifecycle, pairing QR relay, inbound message events, outbound sends. Dashboards and quotas live in Business-OS — this repo contains no UI

## Environment

| Variable | Purpose | Required |
|---|---|---|
| `ENGINE_ID` | unique engine identity (default `engine-1`) | no |
| `BRAIN_CONTROL_URL` | `wss://…/whatsapp-engine/control` — Brain control socket | yes (interactive) |
| `ENGINE_CONTROL_SECRET` | HMAC secret for signed control tokens | yes (interactive) |
| `ENGINE_AUTH_STATE_KEY_V1` | 32-byte AES-256-GCM key material for auth snapshots | yes (interactive) |
| `HF_BUCKET_NAME` | private S3 bucket for encrypted auth snapshots (production) | no (falls back to local dev store) |
| `HF_BUCKET_ENDPOINT` / `HF_BUCKET_REGION` / `HF_BUCKET_ACCESS_KEY_ID` / `HF_BUCKET_SECRET_ACCESS_KEY` | S3 credentials | with `HF_BUCKET_NAME` |
| `ENGINE_MAX_ACTIVE_SESSIONS` | capacity cap (default 1) | no |

## Development

```bash
npm install
npm run typecheck          # strict TS compile check
npm run mock               # local protocol trace brain on ws://127.0.0.1:9810
npm run dev                # engine (connect to mock or a real Brain)
```

Mock brain test account — **this is not shared infrastructure**, local dev only.

## Tests

```bash
npm run test:protocol     # mock Brain <-> engine handshake + QR relay + secret hygiene
npm run test:snapshot     # encrypted snapshot roundtrip + store contract
```

## License

Proprietary — Business-OS platform component.