import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs/promises';
import https from 'https';
import * as qrcode from 'qrcode';
import {
  IWhatsAppEngine,
  EngineStatus,
  EngineEventCallbacks,
  IncomingMessage,
  MessageResult,
  MediaInput,
  Contact,
  ContactCard,
  LocationInput,
  Group,
  GroupInfo,
  GroupParticipant,
  Label,
  MessageReaction,
  Status,
  TextStatusOptions,
  StatusResult,
  Channel,
  ChannelMessage,
  Catalog,
  Product,
  ProductQueryOptions,
  PaginatedProducts,
} from '../interfaces/whatsapp-engine.interface';
import { createLogger } from '../../common/services/logger.service';

// Force IPv4 HTTPS Agent to prevent IPv6 silent connection timeouts in container environments (Hugging Face / Docker)
const httpsAgent = new https.Agent({
  keepAlive: true,
  family: 4,
  timeout: 30000,
});

export interface BaileysAdapterConfig {
  sessionId: string;
  authDir: string;
  printQR?: boolean;
}

/**
 * Baileys adapter — pure WebSocket WhatsApp engine.
 * No Chromium. No browser. 30-80 MB per session vs 250-400 MB for whatsapp-web.js.
 *
 * Lifecycle:
 *   initialize() → socket.connect() → on QR → user scans → creds.update saved
 *                → connection.open → callbacks.onReady()
 *   destroy()    → socket.end() + creds persisted for next boot
 */
export class BaileysAdapter extends EventEmitter implements IWhatsAppEngine {
  private socket: any = null;
  private store: any = null;
  private storeSaveInterval: any = null;
  private status: EngineStatus = EngineStatus.DISCONNECTED;
  private qrCode: string | null = null;
  private phoneNumber: string | null = null;
  private pushName: string | null = null;
  private callbacks: EngineEventCallbacks = {};
  private authState: any = null;
  private saveCreds: (() => Promise<void>) | null = null;

  // Lazy-loaded baileys references — resolved at initialize() so the module
  // doesn't crash if @whiskeysockets/baileys isn't installed (e.g. when the
  // fallback whatsapp-web.js engine is actually in use).
  private B: any = null;

  private readonly logger = createLogger('BaileysAdapter');
  private readonly sessionId: string;
  private readonly authDir: string;
  private readonly printQR: boolean;

  constructor(config: BaileysAdapterConfig) {
    super();
    this.sessionId = config.sessionId;
    this.authDir = config.authDir;
    this.printQR = config.printQR ?? false;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  async initialize(callbacks: EngineEventCallbacks): Promise<void> {
    this.callbacks = callbacks;
    this.setStatus(EngineStatus.INITIALIZING);

    try {
      // Lazy-require baileys so the module is optional at startup.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const baileys = require('@whiskeysockets/baileys');
      this.B = baileys;
    } catch (err) {
      this.logger.error('Baileys library not installed — run `npm install @whiskeysockets/baileys` first');
      this.setStatus(EngineStatus.FAILED);
      throw new Error('@whiskeysockets/baileys package not found');
    }

    // Ensure auth directory exists
    await fs.mkdir(this.authDir, { recursive: true });

    // Initialize in-memory store for contacts, chats, and message history
    const storePath = path.join(this.authDir, 'baileys_store.json');
    if (typeof this.B.makeInMemoryStore === 'function') {
      this.store = this.B.makeInMemoryStore({
        logger: this.B.P?.({ level: 'silent' }),
      });
      try {
        this.store.readFromFile(storePath);
      } catch {
        // file doesn't exist yet
      }

      this.storeSaveInterval = setInterval(() => {
        try {
          this.store?.writeToFile(storePath);
        } catch {
          // ignore
        }
      }, 10_000);
    }

    // Load or create auth state
    let { state, saveCreds } = await this.B.useMultiFileAuthState(this.authDir);

    // If session is unauthenticated (no registered user ID), clear stale partial credentials
    // to guarantee Baileys starts completely fresh and emits a new QR code immediately.
    if (!state.creds?.me?.id && !state.creds?.registered) {
      this.logger.log(`Session ${this.sessionId} is unauthenticated — resetting auth dir to generate fresh QR.`);
      await fs.rm(this.authDir, { recursive: true, force: true }).catch(() => { });
      await fs.mkdir(this.authDir, { recursive: true });
      const freshAuth = await this.B.useMultiFileAuthState(this.authDir);
      state = freshAuth.state;
      saveCreds = freshAuth.saveCreds;
    }

    this.authState = state;
    this.saveCreds = saveCreds;

    // Persist creds every time they're updated (multi-device rekey etc.)
    state.creds?.id && this.logger.log(`Auth state loaded for ${this.sessionId}`);

    // ── WA version: use a pinned known-good version ──────────────────────────
    // Do NOT call fetchLatestBaileysVersion() — it often returns a version
    // whose noise-protocol keys WhatsApp's servers reject, causing SSL alert 0.
    // This pinned version is confirmed working as of July 2026.
    const version: [number, number, number] = [2, 3000, 1015901307];
    this.logger.log(`Using pinned WA version: ${version.join('.')}`);

    const browserTuple = this.B.Browsers?.ubuntu('Chrome') ?? ['Ubuntu', 'Chrome', '22.0.04'];

    // ── Custom TLS agent to resolve SSL EPROTO on containerised hosts ────────
    // Hugging Face (and other datacenter hosts) can trigger SSL alert number 0
    // if Node's TLS stack uses an incompatible cipher or SNI configuration.
    // We create a persistent https.Agent that:
    //   • forces IPv4 (avoids silent IPv6 DNS timeouts in HF containers)
    //   • sets a keepAlive socket so Baileys' WebSocket doesn't idle-timeout
    //   • pins minVersion to TLSv1.2 which WhatsApp servers require
    const https = require('https');
    const tlsAgent = new https.Agent({
      family: 4,
      keepAlive: true,
      keepAliveMsecs: 15_000,
      minVersion: 'TLSv1.2' as any,
      rejectUnauthorized: true,
    });

    const socketConfig: any = {
      auth: state,
      version,
      browser: browserTuple,
      printQRInTerminal: this.printQR,
      markOnlineOnConnect: false,
      syncFullHistory: true,
      generateHighQualityLinkPreview: false,
      connectTimeoutMs: 60_000,
      retryRequestDelayMs: 2_000,
      maxRetries: 5,
      wsOptions: {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Origin': 'https://web.whatsapp.com',
        },
        origin: 'https://web.whatsapp.com',
      },
      ...(this.getProxyConfig()),
    };

    if (this.B.P) {
      socketConfig.logger = this.B.P({ level: 'silent' });
    }

    // Create the socket
    this.socket = this.B.makeWASocket(socketConfig);

    // Bind in-memory store to socket event emitter
    if (this.store) {
      this.store.bind(this.socket.ev);
    }

    this.setupEventHandlers();
    this.logger.log(`Baileys socket created for session ${this.sessionId}`);
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      try {
        this.socket.end(undefined);
      } catch (err) {
        this.logger.warn(`Disconnect failed: ${String(err)}`);
      }
      this.socket = null;
      this.setStatus(EngineStatus.DISCONNECTED);
    }
  }

  async logout(): Promise<void> {
    if (this.socket) {
      try {
        await this.socket.logout();
      } catch (err) {
        this.logger.warn(`Logout failed: ${String(err)}`);
        try {
          this.socket.end(undefined);
        } catch {
          // ignore
        }
      }
      this.socket = null;
      this.setStatus(EngineStatus.DISCONNECTED);
    }
    // Clear stored credentials so next start requires QR scan
    try {
      await fs.rm(this.authDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  async destroy(): Promise<void> {
    if (this.socket) {
      this.socket.end(undefined);
      this.socket = null;
      this.setStatus(EngineStatus.DISCONNECTED);
    }
    this.authState = null;
    this.saveCreds = null;
  }

  // ─── Status ──────────────────────────────────────────────────────────────────

  getStatus(): EngineStatus {
    return this.status;
  }

  getQRCode(): string | null {
    return this.qrCode;
  }

  getPhoneNumber(): string | null {
    return this.phoneNumber;
  }

  getPushName(): string | null {
    return this.pushName;
  }

  // ─── Internal helpers ────────────────────────────────────────────────────────

  private setStatus(status: EngineStatus): void {
    this.status = status;
    this.callbacks.onStateChanged?.(status);
    this.emit('stateChanged', status);
  }

  private ensureReady(): void {
    if (this.status !== EngineStatus.READY || !this.socket) {
      throw new Error('WhatsApp client is not ready');
    }
  }

  /**
   * Resolve a chat JID. Baileys handles LID internally via signalRepository,
   * so most JIDs work directly. Phone numbers need @c.us suffix.
   */
  private resolveJid(chatId: string): string {
    if (chatId.endsWith('@lid') || chatId.endsWith('@g.us') || chatId.endsWith('@s.whatsapp.net')) {
      return chatId;
    }
    // Bare phone number — append @c.us
    if (/^\d+$/.test(chatId)) {
      return `${chatId}@s.whatsapp.net`;
    }
    return chatId;
  }

  private getProxyConfig(): Record<string, unknown> {
    // Proxy support can be added via config
    return {};
  }

  private setupEventHandlers(): void {
    if (!this.socket) return;

    const s = this.socket;

    // ── Auth state persistence ─────────────────────────────────────────────
    s.ev.on('creds.update', () => {
      this.saveCreds?.().catch((err: unknown) => {
        this.logger.error(`Failed to save credentials: ${String(err)}`);
      });
    });

    // ── Connection lifecycle ───────────────────────────────────────────────
    s.ev.on('connection.update', (update: any) => {
      const { connection, lastDisconnect, qr, loginTimeout } = update;

      if (qr) {
        this.logger.log(`Raw QR event received from Baileys for session ${this.sessionId}`);
        // Set QR immediately so getQRCode() is populated synchronously
        this.qrCode = qr;
        this.setStatus(EngineStatus.QR_READY);
        this.callbacks.onQRCode?.(qr);

        // Asynchronously render as PNG Data URL for UI display
        qrcode.toDataURL(qr)
          .then((dataUrl: string) => {
            this.qrCode = dataUrl;
            this.callbacks.onQRCode?.(dataUrl);
            this.logger.log(`QR DataURL generated & ready for session ${this.sessionId}`);
          })
          .catch((err: unknown) => {
            this.logger.error(`Failed to convert QR to data URL: ${String(err)}`);
          });
      }

      if (connection === 'open') {
        this.qrCode = null;
        // Extract phone and pushName from the authenticated user
        const me = s.user;
        this.phoneNumber = me?.id?.replace(/:.*$/, '').replace(/@.*$/, '') ?? null;
        this.pushName = me?.name ?? null;
        this.setStatus(EngineStatus.READY);
        this.callbacks.onReady?.(this.phoneNumber ?? '', this.pushName ?? '');
        this.logger.log(`Session ${this.sessionId} connected as ${this.phoneNumber} (${this.pushName})`);
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        // DisconnectReason 401 = logged out / unauthorized
        if (statusCode === 401) {
          this.setStatus(EngineStatus.FAILED);
          this.callbacks.onDisconnected?.('Logged out — re-pair required');
          return;
        }
        // DisconnectReason 408 = request timeout (network issue)
        // DisconnectReason 428 = connection closed (try reconnect)
        // DisconnectReason 440 = connection replaced (logged in elsewhere)
        // DisconnectReason 515 = restart required
        if (statusCode === 440) {
          this.setStatus(EngineStatus.FAILED);
          this.callbacks.onDisconnected?.('Connection replaced by another device');
          return;
        }
        // All other codes: transient disconnect — let baileys retry automatically
        this.setStatus(EngineStatus.DISCONNECTED);
        this.callbacks.onDisconnected?.(`Connection closed (code=${statusCode ?? 'unknown'})`);
      }

      if (connection === 'connecting') {
        if (this.status !== EngineStatus.QR_READY) {
          this.setStatus(EngineStatus.INITIALIZING);
        }
      }
    });

    // ── Incoming messages ──────────────────────────────────────────────────
    s.ev.on('messages.upsert', (messageUpdate: any) => {
      const messages = messageUpdate.messages ?? [];
      for (const msg of messages) {
        // Auto-upsert sender into store.contacts if not present
        if (msg.key?.remoteJid && this.store?.contacts) {
          const fromJid = msg.key.remoteJid;
          if (!this.store.contacts[fromJid]) {
            this.store.contacts[fromJid] = {
              id: fromJid,
              name: msg.pushName ?? fromJid.replace(/@.*$/, ''),
              notify: msg.pushName ?? undefined,
            };
          }
        }

        if (messageUpdate.type !== 'notify') continue; // skip historical sync
        if (msg.key?.fromMe) continue; // skip own messages

        const incoming = this.mapIncomingMessage(msg);
        if (incoming) {
          // Download media in background — don't block message processing
          this.downloadAndPersistMedia(msg, incoming).catch(() => { });
          this.callbacks.onMessage?.(incoming);
        }
      }
    });
  }

  private mapIncomingMessage(msg: any): IncomingMessage | null {
    try {
      const key = msg.key ?? {};
      const from = key.remoteJid ?? '';
      const body =
        msg.message?.conversation ??
        msg.message?.extendedTextMessage?.text ??
        msg.message?.imageMessage?.caption ??
        msg.message?.videoMessage?.caption ??
        msg.message?.documentMessage?.caption ??
        '';

      const isGroup = from.endsWith('@g.us');
      const fromMe = key.fromMe ?? false;

      // Detect message type
      let type = 'text';
      if (msg.message?.imageMessage) type = 'image';
      else if (msg.message?.videoMessage) type = 'video';
      else if (msg.message?.audioMessage) type = 'audio';
      else if (msg.message?.documentMessage) type = 'document';
      else if (msg.message?.locationMessage) type = 'location';
      else if (msg.message?.contactMessage) type = 'contact';
      else if (msg.message?.stickerMessage) type = 'sticker';

      return {
        id: key.id ?? `fallback-${Date.now()}`,
        from,
        to: '',
        chatId: from,
        body,
        type,
        timestamp: msg.messageTimestamp ?? Math.floor(Date.now() / 1000),
        fromMe,
        isGroup,
        media: msg.message?.imageMessage || msg.message?.videoMessage || msg.message?.audioMessage || msg.message?.documentMessage
          ? {
            mimetype: msg.message?.imageMessage?.mimetype ?? msg.message?.videoMessage?.mimetype ?? msg.message?.audioMessage?.mimetype ?? msg.message?.documentMessage?.mimetype ?? 'application/octet-stream',
            filename: msg.message?.documentMessage?.fileName ?? undefined,
          }
          : undefined,
        quotedMessage: msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
          ? {
            id: msg.message.extendedTextMessage.contextInfo.stanzaId ?? '',
            body: msg.message.extendedTextMessage.contextInfo.conversation ?? '',
          }
          : undefined,
        location: msg.message?.locationMessage
          ? {
            latitude: msg.message.locationMessage.degreesLatitude ?? 0,
            longitude: msg.message.locationMessage.degreesLongitude ?? 0,
            address: msg.message.locationMessage.address ?? undefined,
          }
          : undefined,
      };
    } catch {
      this.logger.warn(`Failed to map incoming message: ${String(msg)}`);
      return null;
    }
  }

  private async downloadAndPersistMedia(rawMsg: any, incoming: IncomingMessage): Promise<void> {
    if (!this.socket || !incoming.media) return;
    try {
      const { downloadContentFromMessage } = await import('@whiskeysockets/baileys');
      const msgProto = rawMsg.message;
      if (!msgProto) return;

      const mediaType = (incoming.type === 'image' ? 'image' : incoming.type === 'video' ? 'video'
        : incoming.type === 'audio' ? 'audio' : incoming.type === 'sticker' ? 'sticker'
          : 'document') as any;
      const stream = await downloadContentFromMessage(msgProto, mediaType);
      let buffer = Buffer.alloc(0);
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
      }
      if (buffer.length === 0) return;

      const ext = incoming.media.mimetype?.split('/')[1]?.split(';')[0] || 'bin';
      const mediaDir = path.join(this.authDir, 'media');
      await fs.mkdir(mediaDir, { recursive: true }).catch(() => { });
      const filePath = path.join(mediaDir, `${incoming.id}.${ext}`);
      await fs.writeFile(filePath, buffer);

      incoming.media.data = buffer.toString('base64');
      (incoming as any).mediaUrl = filePath;
      this.logger.debug(`Persisted media for ${incoming.id}: ${filePath} (${buffer.length} bytes)`);
    } catch (err) {
      this.logger.warn(`Media download failed for ${incoming.id}: ${(err as Error).message}`);
    }
  }

  public getMediaPath(messageId: string): string | null {
    const mediaDir = path.join(this.authDir, 'media');
    for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'ogg', 'opus', 'mp3', 'pdf', 'bin']) {
      const p = path.join(mediaDir, `${messageId}.${ext}`);
      try {
        if (require('fs').existsSync(p)) return p;
      } catch { /* ignore */ }
    }
    return null;
  }

  // ─── Chats & Message History ──────────────────────────────────────────────────

  async getChats(): Promise<any[]> {
    this.ensureReady();
    const chatsMap = this.store?.chats ?? {};
    const chats = Object.values(chatsMap);
    if (chats.length > 0) {
      return chats.map((c: any) => ({
        id: c.id,
        name: c.name ?? c.notify ?? c.id.replace(/@.*$/, ''),
        unreadCount: c.unreadCount ?? 0,
        timestamp: c.conversationTimestamp ?? Math.floor(Date.now() / 1000),
        isGroup: c.id?.endsWith('@g.us') ?? false,
      }));
    }
    const storeContacts = this.store?.contacts ?? {};
    return Object.entries(storeContacts).map(([id, data]: [string, any]) => ({
      id,
      name: data.name ?? data.notify ?? id.replace(/@.*$/, ''),
      unreadCount: 0,
      timestamp: Math.floor(Date.now() / 1000),
      isGroup: id.endsWith('@g.us'),
    }));
  }

  async getMessageHistory(chatId: string, limit = 50): Promise<IncomingMessage[]> {
    this.ensureReady();
    const resolved = this.resolveJid(chatId);
    const messages = this.store?.messages?.[resolved] ?? [];
    const list = Array.isArray(messages) ? messages.slice(-limit) : Object.values(messages).slice(-limit);
    return list.map((msg: any) => this.mapIncomingMessage(msg)).filter(Boolean) as IncomingMessage[];
  }

  // ─── Messaging: Basic ────────────────────────────────────────────────────────

  async sendTextMessage(chatId: string, text: string): Promise<MessageResult> {
    this.ensureReady();
    const jid = this.resolveJid(chatId);
    const result = await this.socket!.sendMessage(jid, { text });
    return {
      id: result?.key?.id ?? `fallback-${Date.now()}`,
      timestamp: result?.messageTimestamp ?? Math.floor(Date.now() / 1000),
    };
  }

  async sendImageMessage(chatId: string, media: MediaInput): Promise<MessageResult> {
    this.ensureReady();
    const jid = this.resolveJid(chatId);
    const buffer = await this.resolveMediaBuffer(media);
    const result = await this.socket!.sendMessage(jid, {
      image: buffer,
      caption: media.caption ?? '',
      mimetype: media.mimetype,
    });
    return {
      id: result?.key?.id ?? `fallback-${Date.now()}`,
      timestamp: result?.messageTimestamp ?? Math.floor(Date.now() / 1000),
    };
  }

  async sendVideoMessage(chatId: string, media: MediaInput): Promise<MessageResult> {
    this.ensureReady();
    const jid = this.resolveJid(chatId);
    const buffer = await this.resolveMediaBuffer(media);
    const result = await this.socket!.sendMessage(jid, {
      video: buffer,
      caption: media.caption ?? '',
      mimetype: media.mimetype,
    });
    return {
      id: result?.key?.id ?? `fallback-${Date.now()}`,
      timestamp: result?.messageTimestamp ?? Math.floor(Date.now() / 1000),
    };
  }

  async sendAudioMessage(chatId: string, media: MediaInput): Promise<MessageResult> {
    this.ensureReady();
    const jid = this.resolveJid(chatId);
    const buffer = await this.resolveMediaBuffer(media);
    const result = await this.socket!.sendMessage(jid, {
      audio: buffer,
      mimetype: media.mimetype,
      ptt: true, // push-to-talk / voice message
    });
    return {
      id: result?.key?.id ?? `fallback-${Date.now()}`,
      timestamp: result?.messageTimestamp ?? Math.floor(Date.now() / 1000),
    };
  }

  async sendDocumentMessage(chatId: string, media: MediaInput): Promise<MessageResult> {
    this.ensureReady();
    const jid = this.resolveJid(chatId);
    const buffer = await this.resolveMediaBuffer(media);
    const result = await this.socket!.sendMessage(jid, {
      document: buffer,
      fileName: media.filename ?? 'document',
      mimetype: media.mimetype,
      caption: media.caption,
    });
    return {
      id: result?.key?.id ?? `fallback-${Date.now()}`,
      timestamp: result?.messageTimestamp ?? Math.floor(Date.now() / 1000),
    };
  }

  private async resolveMediaBuffer(media: MediaInput): Promise<Buffer> {
    if (Buffer.isBuffer(media.data)) return media.data;
    if (typeof media.data === 'string' && media.data.startsWith('http')) {
      const res = await fetch(media.data);
      if (!res.ok) throw new Error(`Failed to fetch media: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    }
    if (typeof media.data === 'string') {
      return Buffer.from(media.data, 'base64');
    }
    throw new Error('Invalid media data: expected Buffer, URL string, or base64 string');
  }

  // ─── Messaging: Extended (Phase 3) ──────────────────────────────────────────

  async sendLocationMessage(chatId: string, location: LocationInput): Promise<MessageResult> {
    this.ensureReady();
    const jid = this.resolveJid(chatId);
    const result = await this.socket!.sendMessage(jid, {
      location: {
        degreesLatitude: location.latitude,
        degreesLongitude: location.longitude,
        name: location.description,
        address: location.address,
      },
    });
    return {
      id: result?.key?.id ?? `fallback-${Date.now()}`,
      timestamp: result?.messageTimestamp ?? Math.floor(Date.now() / 1000),
    };
  }

  async sendContactMessage(chatId: string, contact: ContactCard): Promise<MessageResult> {
    this.ensureReady();
    const jid = this.resolveJid(chatId);
    const result = await this.socket!.sendMessage(jid, {
      contacts: {
        displayName: contact.name,
        contacts: [{ vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${contact.name}\nTEL;type=CELL:${contact.number}\nEND:VCARD` }],
      },
    });
    return {
      id: result?.key?.id ?? `fallback-${Date.now()}`,
      timestamp: result?.messageTimestamp ?? Math.floor(Date.now() / 1000),
    };
  }

  async sendStickerMessage(chatId: string, media: MediaInput): Promise<MessageResult> {
    this.ensureReady();
    const jid = this.resolveJid(chatId);
    const buffer = await this.resolveMediaBuffer(media);
    const result = await this.socket!.sendMessage(jid, {
      sticker: buffer,
      mimetype: media.mimetype,
    });
    return {
      id: result?.key?.id ?? `fallback-${Date.now()}`,
      timestamp: result?.messageTimestamp ?? Math.floor(Date.now() / 1000),
    };
  }

  // ─── Reply & Forward ─────────────────────────────────────────────────────────

  async replyToMessage(chatId: string, quotedMsgId: string, text: string): Promise<MessageResult> {
    this.ensureReady();
    const jid = this.resolveJid(chatId);
    const result = await this.socket!.sendMessage(jid, {
      text,
      quoted: { key: { id: quotedMsgId, remoteJid: jid } },
    });
    return {
      id: result?.key?.id ?? `fallback-${Date.now()}`,
      timestamp: result?.messageTimestamp ?? Math.floor(Date.now() / 1000),
    };
  }

  async forwardMessage(fromChatId: string, toChatId: string, messageId: string): Promise<MessageResult> {
    this.ensureReady();
    const toJid = this.resolveJid(toChatId);
    const result = await this.socket!.forwardMessage(toJid, {
      key: { id: messageId, remoteJid: this.resolveJid(fromChatId) },
      message: {},
    } as any);
    return {
      id: result?.key?.id ?? `fallback-${Date.now()}`,
      timestamp: result?.messageTimestamp ?? Math.floor(Date.now() / 1000),
    };
  }

  // ─── Reactions ───────────────────────────────────────────────────────────────

  async reactToMessage(chatId: string, messageId: string, emoji: string): Promise<void> {
    this.ensureReady();
    const jid = this.resolveJid(chatId);
    await this.socket!.sendMessage(jid, {
      react: { text: emoji, key: { id: messageId, remoteJid: jid } },
    });
  }

  async getMessageReactions(chatId: string, messageId: string): Promise<MessageReaction[]> {
    // Baileys doesn't expose a direct API for fetching reactions on a message.
    // Reactions arrive as real-time events via `messages.update`. We can't
    // query them on demand without storing them. Return empty for now.
    return [];
  }

  // ─── Message Operations ──────────────────────────────────────────────────────

  async deleteMessage(chatId: string, messageId: string, forEveryone?: boolean): Promise<void> {
    this.ensureReady();
    const jid = this.resolveJid(chatId);
    await this.socket!.sendMessage(jid, {
      delete: { remoteJid: jid, fromMe: forEveryone, id: messageId },
    });
  }

  // ─── Contacts ────────────────────────────────────────────────────────────────

  async getContacts(): Promise<Contact[]> {
    this.ensureReady();
    const storeContacts = this.store?.contacts ?? this.socket?.store?.contacts ?? {};
    return Object.entries(storeContacts).map(([id, data]: [string, any]) => ({
      id,
      name: data.name ?? data.notify ?? undefined,
      pushName: data.notify ?? undefined,
      number: id.replace(/@.*$/, ''),
      isMyContact: data.isMyContact ?? false,
      isBlocked: data.isBlocked ?? false,
      profilePicUrl: data.profilePicUrl ?? undefined,
    }));
  }

  async getContactById(contactId: string): Promise<Contact | null> {
    this.ensureReady();
    const resolved = this.resolveJid(contactId);
    const storeContacts = this.store?.contacts ?? this.socket?.store?.contacts ?? {};
    const data = storeContacts[resolved];
    if (!data) {
      // Try to fetch from server
      try {
        const info = await this.socket!.onWhatsApp(contactId.replace(/@.*$/, ''));
        if (info?.[0]?.exists) {
          return {
            id: resolved,
            number: contactId.replace(/@.*$/, ''),
            isMyContact: false,
            isBlocked: false,
          };
        }
      } catch {
        // ignore
      }
      return null;
    }
    return {
      id: resolved,
      name: data.name ?? data.notify ?? undefined,
      pushName: data.notify ?? undefined,
      number: resolved.replace(/@.*$/, ''),
      isMyContact: data.isMyContact ?? false,
      isBlocked: data.isBlocked ?? false,
      profilePicUrl: data.profilePicUrl ?? undefined,
    };
  }

  async checkNumberExists(number: string): Promise<boolean> {
    this.ensureReady();
    try {
      const result = await this.socket!.onWhatsApp(number.replace(/\D/g, ''));
      return result?.[0]?.exists ?? false;
    } catch {
      return false;
    }
  }

  async getProfilePicture(contactId: string): Promise<string | null> {
    this.ensureReady();
    try {
      const resolved = this.resolveJid(contactId);
      const ppUrl = await this.socket!.profilePictureUrl(resolved, 'image');
      return ppUrl ?? null;
    } catch {
      return null;
    }
  }

  // ─── Contact Extended Operations ─────────────────────────────────────────────

  async blockContact(contactId: string): Promise<void> {
    this.ensureReady();
    const resolved = this.resolveJid(contactId);
    await this.socket!.updateBlockStatus(resolved, 'block');
  }

  async unblockContact(contactId: string): Promise<void> {
    this.ensureReady();
    const resolved = this.resolveJid(contactId);
    await this.socket!.updateBlockStatus(resolved, 'unblock');
  }

  // ─── Groups: Basic ───────────────────────────────────────────────────────────

  async getGroups(): Promise<Group[]> {
    this.ensureReady();
    try {
      const groupsMap = await this.socket!.groupFetchAllParticipating();
      return Object.entries(groupsMap).map(([id, meta]: [string, any]) => ({
        id,
        name: meta.subject ?? 'Unknown Group',
        participantsCount: meta.participants?.length ?? 0,
      }));
    } catch {
      const storeGroups = this.store?.groupMetadata ?? this.socket?.store?.groupMetadata ?? {};
      return Object.entries(storeGroups).map(([id, meta]: [string, any]) => ({
        id,
        name: meta.subject ?? 'Unknown Group',
        participantsCount: meta.participants?.length ?? 0,
      }));
    }
  }

  // ─── Groups: Extended (Phase 3) ─────────────────────────────────────────────

  async getGroupInfo(groupId: string): Promise<GroupInfo | null> {
    this.ensureReady();
    const resolved = this.resolveJid(groupId);
    if (!resolved.endsWith('@g.us')) throw new Error('Chat is not a group');
    try {
      const meta = await this.socket!.groupMetadata(resolved);
      return {
        id: resolved,
        name: meta.subject ?? '',
        description: meta.desc ?? undefined,
        owner: meta.owner ?? undefined,
        participants: (meta.participants ?? []).map((p: any) => ({
          id: p.id,
          number: p.id.replace(/@.*$/, ''),
          isAdmin: p.admin === 'admin' || p.admin === 'superadmin',
          isSuperAdmin: p.admin === 'superadmin',
        })),
        isReadOnly: meta.restrict ?? false,
        isAnnounce: meta.announce ?? false,
      };
    } catch {
      return null;
    }
  }

  async createGroup(name: string, participants: string[]): Promise<Group> {
    this.ensureReady();
    const resolved = participants.map(p => this.resolveJid(p));
    const result = await this.socket!.groupCreate(name, resolved);
    return {
      id: result.id,
      name: result.subject,
      participantsCount: result.participants?.length ?? 0,
    };
  }

  async addParticipants(groupId: string, participants: string[]): Promise<void> {
    this.ensureReady();
    const gJid = this.resolveJid(groupId);
    if (!gJid.endsWith('@g.us')) throw new Error('Chat is not a group');
    const pJids = participants.map(p => this.resolveJid(p));
    await this.socket!.groupParticipantsUpdate(gJid, pJids, 'add');
  }

  async removeParticipants(groupId: string, participants: string[]): Promise<void> {
    this.ensureReady();
    const gJid = this.resolveJid(groupId);
    if (!gJid.endsWith('@g.us')) throw new Error('Chat is not a group');
    const pJids = participants.map(p => this.resolveJid(p));
    await this.socket!.groupParticipantsUpdate(gJid, pJids, 'remove');
  }

  async promoteParticipants(groupId: string, participants: string[]): Promise<void> {
    this.ensureReady();
    const gJid = this.resolveJid(groupId);
    if (!gJid.endsWith('@g.us')) throw new Error('Chat is not a group');
    const pJids = participants.map(p => this.resolveJid(p));
    await this.socket!.groupParticipantsUpdate(gJid, pJids, 'promote');
  }

  async demoteParticipants(groupId: string, participants: string[]): Promise<void> {
    this.ensureReady();
    const gJid = this.resolveJid(groupId);
    if (!gJid.endsWith('@g.us')) throw new Error('Chat is not a group');
    const pJids = participants.map(p => this.resolveJid(p));
    await this.socket!.groupParticipantsUpdate(gJid, pJids, 'demote');
  }

  async leaveGroup(groupId: string): Promise<void> {
    this.ensureReady();
    const gJid = this.resolveJid(groupId);
    if (!gJid.endsWith('@g.us')) throw new Error('Chat is not a group');
    await this.socket!.groupLeave(gJid);
  }

  async setGroupSubject(groupId: string, subject: string): Promise<void> {
    this.ensureReady();
    const gJid = this.resolveJid(groupId);
    if (!gJid.endsWith('@g.us')) throw new Error('Chat is not a group');
    await this.socket!.groupUpdateSubject(gJid, subject);
  }

  async setGroupDescription(groupId: string, description: string): Promise<void> {
    this.ensureReady();
    const gJid = this.resolveJid(groupId);
    if (!gJid.endsWith('@g.us')) throw new Error('Chat is not a group');
    await this.socket!.groupUpdateDescription(gJid, description);
  }

  async getGroupInviteCode(groupId: string): Promise<string> {
    this.ensureReady();
    const gJid = this.resolveJid(groupId);
    if (!gJid.endsWith('@g.us')) throw new Error('Chat is not a group');
    return this.socket!.groupInviteCode(gJid);
  }

  async revokeGroupInviteCode(groupId: string): Promise<string> {
    this.ensureReady();
    const gJid = this.resolveJid(groupId);
    if (!gJid.endsWith('@g.us')) throw new Error('Chat is not a group');
    return this.socket!.groupRevokeInvite(gJid);
  }

  // ─── Labels, Channels, Status, Catalog — stubs ──────────────────────────────

  async getLabels(): Promise<Label[]> {
    throw new Error('getLabels not yet implemented in baileys adapter');
  }

  async getLabelById(labelId: string): Promise<Label | null> {
    throw new Error('getLabelById not yet implemented in baileys adapter');
  }

  async getChatLabels(chatId: string): Promise<Label[]> {
    throw new Error('getChatLabels not yet implemented in baileys adapter');
  }

  async addLabelToChat(chatId: string, labelId: string): Promise<void> {
    throw new Error('addLabelToChat not yet implemented in baileys adapter');
  }

  async removeLabelFromChat(chatId: string, labelId: string): Promise<void> {
    throw new Error('removeLabelFromChat not yet implemented in baileys adapter');
  }

  async getSubscribedChannels(): Promise<Channel[]> {
    throw new Error('getSubscribedChannels not yet implemented in baileys adapter');
  }

  async getChannelById(channelId: string): Promise<Channel | null> {
    throw new Error('getChannelById not yet implemented in baileys adapter');
  }

  async subscribeToChannel(inviteCode: string): Promise<Channel> {
    throw new Error('subscribeToChannel not yet implemented in baileys adapter');
  }

  async unsubscribeFromChannel(channelId: string): Promise<void> {
    throw new Error('unsubscribeFromChannel not yet implemented in baileys adapter');
  }

  async getChannelMessages(channelId: string, limit?: number): Promise<ChannelMessage[]> {
    throw new Error('getChannelMessages not yet implemented in baileys adapter');
  }

  async getContactStatuses(): Promise<Status[]> {
    throw new Error('getContactStatuses not yet implemented in baileys adapter');
  }

  async getContactStatus(contactId: string): Promise<Status[]> {
    throw new Error('getContactStatus not yet implemented in baileys adapter');
  }

  async postTextStatus(text: string, options?: TextStatusOptions): Promise<StatusResult> {
    throw new Error('postTextStatus not yet implemented in baileys adapter');
  }

  async postImageStatus(media: MediaInput, caption?: string): Promise<StatusResult> {
    throw new Error('postImageStatus not yet implemented in baileys adapter');
  }

  async postVideoStatus(media: MediaInput, caption?: string): Promise<StatusResult> {
    throw new Error('postVideoStatus not yet implemented in baileys adapter');
  }

  async deleteStatus(statusId: string): Promise<void> {
    throw new Error('deleteStatus not yet implemented in baileys adapter');
  }

  async getCatalog(): Promise<Catalog | null> {
    throw new Error('getCatalog not yet implemented in baileys adapter');
  }

  async getProducts(options?: ProductQueryOptions): Promise<PaginatedProducts> {
    throw new Error('getProducts not yet implemented in baileys adapter');
  }

  async getProduct(productId: string): Promise<Product | null> {
    throw new Error('getProduct not yet implemented in baileys adapter');
  }

  async sendProduct(chatId: string, productId: string, body?: string): Promise<MessageResult> {
    throw new Error('sendProduct not yet implemented in baileys adapter');
  }

  async sendCatalog(chatId: string, body?: string): Promise<MessageResult> {
    throw new Error('sendCatalog not yet implemented in baileys adapter');
  }
}
