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

export class ControlClient {
  private ws: WebSocket | null = null;
  private sequence = 0;
  private heartbeatTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private backoffMs = 1000;
  private closedByUs = false;
  private readonly log: Logger;

  constructor(private readonly opts: ControlClientOptions) {
    this.log = opts.log;
  }

  connect(): void {
    this.closedByUs = false;
    this.open();
  }

  private open(): void {
    const token = makeAuthToken(this.opts.secret, this.opts.engineId);
    const ws = new WebSocket(this.opts.brainControlUrl, {
      headers: { authorization: `Bearer ${token}` },
      handshakeTimeout: 10_000,
    });
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
          void this.opts.onCommand(env as CommandEnvelope);
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
    this.stopTimers();
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;
  }
}