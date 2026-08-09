/**
 * Outbound authenticated control-plane client (migration plan §6).
 * The engine NEVER accepts inbound connections; it dials the Brain.
 */
import WebSocket from 'ws';
import { randomUUID, createHmac } from 'crypto';
import { ControlEnvelope, CommandEnvelope } from './envelope';
import { Logger } from './logger';

export interface ControlClientOptions {
  brainControlUrl: string;   // wss://brain.internal/whatsapp-engine/control
  engineId: string;
  secret: string;            // shared HMAC secret (ENGINE_CONTROL_SECRET)
  log: Logger;
  onCommand: (cmd: CommandEnvelope) => Promise<void>;
  onOpen?: () => void;
  onClose?: () => void;
}

/** Short-lived signed token: ts.exp.engineId.hmac(ts.exp.engineId) — replay-window ~60s. */
function makeAuthToken(secret: string, engineId: string): string {
  const ts = Math.floor(Date.now() / 1000);
  const exp = ts + 60;
  const mac = createHmac('sha256', secret)
    .update(`${ts}.${exp}.${engineId}`)
    .digest('hex');
  return `${ts}.${exp}.${engineId}.${mac}`;
}

export function normalizeControlUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  try {
    let s = rawUrl.trim();
    if (s.startsWith('http://')) s = s.replace('http://', 'ws://');
    else if (s.startsWith('https://')) s = s.replace('https://', 'wss://');
    else if (!s.startsWith('ws://') && !s.startsWith('wss://')) s = `wss://${s}`;

    const u = new URL(s);
    if (!u.pathname || u.pathname === '/') {
      u.pathname = '/internal/whatsapp-engine/control';
    } else if (u.pathname === '/whatsapp-engine/control') {
      u.pathname = '/internal/whatsapp-engine/control';
    }
    return u.toString();
  } catch {
    return rawUrl;
  }
}

/** A dial-able control URL must be an absolute http(s)/ws(s) URL with a host. */
function isHttpWsUrl(url: string): boolean {
  try {
    if (!url) return false;
    const u = new URL(url);
    return (u.protocol === 'wss:' || u.protocol === 'ws:') && !!u.host;
  } catch {
    return false;
  }
}

/** Log a URL without leaking credentials or query secrets. */
function redactUrl(url: string): string {
  if (!url) return '(empty)';
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    if (u.password) u.username = u.username ? `${u.username}:***` : '***';
    return u.toString();
  } catch {
    return '(invalid)';
  }
}

export class ControlClient {
  private ws: WebSocket | null = null;
  private sequence = 0;
  private heartbeatTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private retryConfigTimer?: NodeJS.Timeout;
  private backoffMs = 1000;
  private closedByUs = false;
  private readonly log: Logger;

  constructor(private readonly opts: ControlClientOptions) {
    this.log = opts.log;
  }

  connect(): void {
    this.closedByUs = false;
    this.opts.brainControlUrl = normalizeControlUrl(this.opts.brainControlUrl);
    // Missing/inexpressive BRAIN control URL is a config-not-ready state, not a
    // crash: idle (health server stays up) and re-probe in case it appears later.
    if (!isHttpWsUrl(this.opts.brainControlUrl)) {
      this.log.warn({ url: redactUrl(this.opts.brainControlUrl) }, 'control URL invalid — idle until configured, re-probing every 30s');
      clearTimeout(this.retryConfigTimer);
      this.retryConfigTimer = setTimeout(() => this.connect(), 30_000);
      return;
    }
    this.open();
  }

  private open(): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.opts.brainControlUrl, {
        headers: { authorization: `Bearer ${makeAuthToken(this.opts.secret, this.opts.engineId)}` },
        handshakeTimeout: 10_000,
      });
    } catch (err) {
      // e.g. malformed URL — treat as retryable, never crash the container.
      this.log.warn({ err: String(err) }, 'control socket open failed — scheduling reconnect');
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.on('open', () => {
      this.backoffMs = 1000;
      this.sequence = 0;
      this.log.info('control channel open');
      this.opts.onOpen?.();
      this.startHeartbeat();
    });

    ws.on('message', (raw) => {
      try {
        const env: ControlEnvelope = JSON.parse(String(raw));
        if (env.kind === 'command') {
          const cmd = env as CommandEnvelope;
          const commandId = String((cmd.payload as Record<string, unknown> | undefined)?.commandId ?? '');
          // Ack every accepted command so the Brain can release its concurrency
          // credit (inFlight pool) — without an ack, statements stay DISPATCHED
          // forever and the engine stops receiving new commands once the pool
          // fills up (plan §6.3 credit ledger).
          Promise.resolve()
            .then(() => this.opts.onCommand(cmd))
            .then(() => {
              if (commandId) this.ack(commandId, 'accepted');
            })
            .catch((err: unknown) => {
              this.log.warn({ err: String(err), commandId, type: cmd.type }, 'command failed');
              if (commandId) this.ack(commandId, 'rejected');
            });
        }
      } catch (e) {
        this.log.warn({ err: String(e), msg: 'invalid control frame' });
      }
    });

    ws.on('close', () => {
      this.stopTimers();
      this.opts.onClose?.();
      if (!this.closedByUs) this.scheduleReconnect();
    });

    ws.on('error', (err) => {
      this.log.warn({ error: String(err) }, 'control socket error');
    });
  }

  /** Emit event to Brain (engine→Brain events: message.inbound, session.status, pairing.qr, …). */
  emit(type: string, payload?: Record<string, unknown>): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const env: ControlEnvelope = {
      id: randomUUID(),
      kind: 'event',
      type,
      engineId: this.opts.engineId,
      sequence: ++this.sequence,
      createdAt: new Date().toISOString(),
      payload,
    };
    ws.send(JSON.stringify(env));
    return true;
  }

  /** Ack a command so the Brain releases its concurrency credit (plan §6.3). */
  private ack(commandId: string, status: 'accepted' | 'rejected'): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const env: ControlEnvelope = {
      id: randomUUID(),
      kind: 'ack',
      type: 'command.ack',
      engineId: this.opts.engineId,
      sequence: ++this.sequence,
      createdAt: new Date().toISOString(),
      payload: { commandId, status },
    };
    ws.send(JSON.stringify(env));
    return true;
  }

  private scheduleReconnect(): void {
    this.ws = null;
    clearTimeout(this.reconnectTimer);
    const delay = this.backoffMs;
    this.log.warn({ delayMs: delay }, 'scheduling reconnect');
    this.reconnectTimer = setTimeout(() => this.open(), delay);
    this.backoffMs = Math.min(Math.floor(this.backoffMs * 2 * (0.6 + Math.random() * 0.8)), 30_000);
  }

  private startHeartbeat(): void {
    this.stopTimers();
    this.heartbeatTimer = setInterval(() => {
      this.emit('engine.heartbeat');
    }, 30_000);
  }

  private stopTimers(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  close(): void {
    this.closedByUs = true;
    clearTimeout(this.retryConfigTimer);
    this.stopTimers();
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;
  }
}