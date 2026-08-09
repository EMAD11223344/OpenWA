/**
 * Baileys session driver (migration plan §3, §5, §6).
 * - one session per account, isolated WASocket + isolated temp auth dir
 * - auth persisted ONLY as one encrypted AES-256-GCM snapshot per (account, epoch)
 *   in the private bucket; the temp dir on disk is ephemeral and wiped on revoke/shutdown
 * - NO full history sync, NO global in-memory message store
 * - emits neutral events to the control client; Brain persists + dedupes
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import makeWASocket, {
  WASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { ControlClient } from './control-client';
import { AuthSnapshotStore } from './storage';
import { encryptAuthSnapshot, decryptAuthSnapshot, keyFingerprint } from './authcrypto';
import { Logger } from './logger';

export interface EngineConfig {
  engineId: string;
  authStateKey: Buffer;           // ENGINE_AUTH_STATE_KEY_V1 (32 bytes)
  authStore: AuthSnapshotStore;   // S3 bucket (prod) / local fake (tests)
  control: ControlClient;
  maxActiveSessions: number;
  log: Logger;
}

export type WSState = 'STARTING' | 'PAIRING' | 'CONNECTED' | 'RECONNECTING' | 'THROTTLED' | 'DISCONNECTED' | 'REVOKED' | 'FAILED';

interface SessionHandle {
  accountId: string;
  epoch: number;
  disconnected: boolean;
  dir: string;
  socket: WASocket;
}

const tmpBase = () => path.join(os.tmpdir(), 'openwa-engine');

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
}

/** Serialize the whole multi-file auth dir into one JSON blob (files are JSON). */
function snapshotFromDir(dir: string): string {
  const out: Record<string, string> = {};
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (!fs.statSync(p).isFile()) continue;
    out[f] = fs.readFileSync(p, 'utf8');
  }
  return JSON.stringify(out);
}

function restoreDirFromSnapshot(dir: string, blobText: string): void {
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, content] of Object.entries(JSON.parse(blobText) as Record<string, string>)) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(f)) continue;
    fs.writeFileSync(path.join(dir, f), content, 'utf8');
  }
}

const gracefulEnd = () => new Error('graceful engine disconnect');

export class Engine {
  private sessions = new Map<string, SessionHandle>();
  private qrWatchdogs = new Map<string, NodeJS.Timeout>();
  private lastConnError = new Map<string, string>();

  constructor(private cfg: EngineConfig) {}

  get activeCount(): number {
    return this.sessions.size;
  }
  get capacity(): number {
    return this.cfg.maxActiveSessions;
  }

  /**
   * SET_CAPACITY handler (platform runtime control, plan §4.2): change the
   * active-session cap without restarting the container. The Brain persists
   * the value and the engine re-advertises it via engine.health.
   * Raising is always allowed; lowering warns but kills no live session.
   */
  async setCapacity(value: number): Promise<void> {
    const n = Math.max(1, Math.floor(Number(value) || 1));
    this.cfg.maxActiveSessions = n;
    this.cfg.log.info(`capacity updated at runtime — maxActiveSessions=${n}`);
    this.emit('engine.health', { active: this.activeCount, capacity: n, state: 'OK' });
    if (this.sessions.size > n) {
      this.cfg.log.warn(
        { active: this.sessions.size, capacity: n },
        'capacity lowered below active sessions — excess sessions remain until end/disconnect',
      );
    }
  }

  /**
   * START_SESSION handler. `epoch` comes from the Brain lease; stale epochs
   * (crash-resumed old engine) are rejected by the Brain BEFORE dispatch — we
   * additionally stamp the epoch into the temp dir + snapshot key so a restored
   * session is only ever loaded under the epoch it was created with.
   */
  async startSession(accountId: string, epoch: number): Promise<void> {
    const log = this.cfg.log;
    if (this.sessions.has(accountId)) {
      this.emit('command.error', { op: 'START_SESSION', accountId, reason: 'already_active' });
      return;
    }
    if (this.sessions.size >= this.cfg.maxActiveSessions) {
      this.emit('command.error', { op: 'START_SESSION', accountId, reason: 'capacity_exhausted' });
      return;
    }

    this.emit('session.status', { accountId, state: 'STARTING' });
    const dir = path.join(tmpBase(), `${sanitize(accountId)}_e${epoch}`);
    fs.rmSync(dir, { recursive: true, force: true });

    // Boot: restore encrypted snapshot → temp dir if one exists (plan §5.2 step 6).
    let restored = false;
    try {
      const blob = await this.cfg.authStore.load(accountId, epoch);
      if (blob) {
        const plain = decryptAuthSnapshot(blob, this.cfg.authStateKey);
        restoreDirFromSnapshot(dir, plain.toString('utf8'));
        restored = true;
      }
    } catch (err: any) {
      log.warn({ accountId, err: log.redact(String(err)) }, 'snapshot decrypt failed — starting fresh pairing');
    }

    const { state, saveCreds } = await useMultiFileAuthState(dir);
    log.info(`session ${accountId} ${restored ? 'restored' : 'fresh'} (epoch=${epoch})`);

    let version: any;
    try {
      const latest = await fetchLatestBaileysVersion();
      version = latest.version;
    } catch {
      // keep lib-default version pinned by the installed package
    }

    const sock = makeWASocket({
      version,
      auth: { creds: state.creds, keys: state.keys },
      syncFullHistory: false,
      markOnlineOnConnect: false,
      // Cloud runtimes (HF Spaces, containers) can be slow to reach
      // WhatsApp's gateways; default 20-30s timeouts abort before the QR
      // challenge arrives. Generous timeouts + more retries keep the pairing
      // window open long enough for a QR to appear.
      connectTimeoutMs: 60_000,
      retryRequestDelayMs: 2_000,
    });

    const handle: SessionHandle = { accountId, epoch, disconnected: false, dir, socket: sock };
    this.sessions.set(accountId, handle);

    sock.ev.on('creds.update', async () => {
      await saveCreds();
      try {
        const enc = encryptAuthSnapshot(Buffer.from(snapshotFromDir(dir), 'utf8'), this.cfg.authStateKey);
        await this.cfg.authStore.save(accountId, epoch, enc);
        this.emit('auth.snapshot_saved', {
          accountId,
          epoch,
          objectKey: this.cfg.authStore.objectKey(accountId, epoch),
          keyFingerprint: keyFingerprint(this.cfg.authStateKey),
        });
      } catch (err: any) {
        log.warn({ accountId, err: log.redact(String(err)) }, 'snapshot persist failed');
      }
    });

    sock.ev.on('connection.update', (update) => {
      if (update.qr) {
        // QR is short-lived, owner/admin-only, never logged or retained (plan §6.4)
        this.clearWatchdog(accountId);
        this.emit('pairing.qr', { accountId, qr: update.qr });
      }
      const status = update.connection;
      if (!status) return;
      if (status === 'close') {
        const reason = (update.lastDisconnect?.error as any)?.output?.status;
        const errMsg = String(update.lastDisconnect?.error?.message ?? '');
        this.lastConnError.set(accountId, errMsg);
        log.warn(
          { accountId, status, reason, err: errMsg.slice(0, 200) },
          'whatsapp connection closed — retrying (pairing QR will appear once the handshake completes)',
        );
      }
      if (status === 'open') {
        // Fully linked + WebSocket open — pairing no longer expected.
        this.clearWatchdog(accountId);
        this.lastConnError.delete(accountId);
      }
      this.mapState(accountId, status, update.lastDisconnect?.error);
    });

    // Pairing watchdog: if no QR arrived within 150s (cloud runtime IPs are
    // often rate-limited/blocked by WhatsApp — TLS handshakes abort with
    // SSL alert 0), report FAILED so the Brain records the real network error
    // and the pairing UI stops the infinite spinner instead of hanging.
    this.qrWatchdogs.set(
      accountId,
      setTimeout(() => {
        const h = this.sessions.get(accountId);
        if (!h || h.disconnected) return;
        if (h.socket.user?.id) return; // already linked
        const lastErr = this.lastConnError.get(accountId) ?? '';
        this.emit('session.status', {
          accountId,
          state: 'FAILED',
          reason: `pairing_timeout_no_qr${lastErr ? ` (${lastErr.slice(0, 120)})` : ''}`,
          epoch,
        });
        log.warn(
          { accountId, lastErr: lastErr.slice(0, 160) },
          'no pairing QR within 150s — reported FAILED (WhatsApp may be blocking this runtime IP; try restarting the space to rotate the IP)',
        );
      }, 150_000),
    );

    sock.ev.on('messages.upsert', (m) => {
      for (const msg of m.messages ?? []) {
        const key = msg?.key;
        if (!key?.id || !key?.remoteJid) continue;
        if (key.fromMe) continue;
        const body =
          msg.message?.conversation ??
          msg.message?.extendedTextMessage?.text ??
          (msg.message?.imageMessage ? '<image>' : msg.message?.videoMessage ? '<video>' : undefined);
        this.emit('message.inbound', {
          accountId,
          externalId: key.id,
          fromJid: key.remoteJid,
          timestamp: msg.messageTimestamp ?? Math.floor(Date.now() / 1000),
          body,
          type: msg.message?.imageMessage ? 'image' : msg.message?.videoMessage ? 'video' : 'text',
        });
      }
    });
  }

  /** Cancel a session's pairing watchdog (QR received / linked / session ended). */
  private clearWatchdog(accountId: string): void {
    const t = this.qrWatchdogs.get(accountId);
    if (t) {
      clearTimeout(t);
      this.qrWatchdogs.delete(accountId);
    }
  }

  async sendMessage(accountId: string, toJid: string, text?: string): Promise<void> {
    const h = this.sessions.get(accountId);
    if (!h || h.disconnected) {
      this.emit('command.error', { op: 'SEND_MESSAGE', accountId, reason: 'session_inactive' });
      return;
    }
    try {
      await h.socket.sendMessage(toJid, { text: text ?? '' });
      this.emit('message.receipt', { accountId, toJid, status: 'sent_to_provider' });
    } catch (err: any) {
      this.emit('command.error', { op: 'SEND_MESSAGE', accountId, err: this.cfg.log.redact(String(err)) });
    }
  }

/** Command: disconnect the transport but keep auth snapshot (plan §6.3). */
async disconnectSession(accountId: string): Promise<void> {
    const h = this.sessions.get(accountId);
    this.clearWatchdog(accountId);
    this.lastConnError.delete(accountId);
    if (!h) return;
    h.disconnected = true;
    try { h.socket.end(gracefulEnd()); } catch {}
    this.sessions.delete(accountId);
    this.emit('session.status', { accountId, state: 'DISCONNECTED' });
  }

  async revokeSession(accountId: string): Promise<void> {
    const h = this.sessions.get(accountId);
    this.clearWatchdog(accountId);
    this.lastConnError.delete(accountId);
    if (h) {
      try { await h.socket.logout(); } catch {}
      h.disconnected = true;
      this.sessions.delete(accountId);
    }
    try {
      await this.cfg.authStore.delete(accountId, h?.epoch ?? 0);
    } catch (err: any) {
      this.cfg.log.warn({ accountId, err: this.cfg.log.redact(String(err)) }, 'bucket delete failed on revoke');
    }
    if (h) fs.rmSync(h.dir, { recursive: true, force: true });
    this.emit('session.status', { accountId, state: 'REVOKED' });
  }

  /** Graceful shutdown: end sockets, wipe temp dirs, close control channel. */
  async stopAll(): Promise<void> {
    for (const t of this.qrWatchdogs.values()) clearTimeout(t);
    this.qrWatchdogs.clear();
    this.lastConnError.clear();
    for (const h of this.sessions.values()) {
      try { h.socket.end(gracefulEnd()); } catch {}
      try { fs.rmSync(h.dir, { recursive: true, force: true }); } catch {}
    }
    this.sessions.clear();
  }

  private mapState(accountId: string, status: 'connecting' | 'open' | 'close', error?: Error): void {
    let state: WSState;
    if (status === 'open') {
      state = 'CONNECTED';
    } else if (status === 'close') {
      const reason = (error as any)?.output?.status;
      if (reason === DisconnectReason.loggedOut) state = 'REVOKED';
      else if (reason === DisconnectReason.connectionReplaced) state = 'DISCONNECTED';
      else if (reason === DisconnectReason.badSession) state = 'FAILED';
      else state = 'RECONNECTING';
      this.sessions.get(accountId)!.disconnected = true;
      this.sessions.delete(accountId);
    } else {
      state = 'RECONNECTING';
    }
    this.emit('session.status', { accountId, state });
  }

  private emit(type: string, payload: Record<string, unknown>): void {
    this.cfg.control.emit(type, payload);
  }
}
