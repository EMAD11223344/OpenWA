/**
 * Engine → Brain control-plane envelope (migration plan §6.2).
 * Every command/event/ack/credit/error crosses the wire as one of these.
 */
export type EnvelopeKind = 'command' | 'event' | 'ack' | 'credit' | 'error';

export interface ControlEnvelope {
  id: string;                     // globally-unique-id
  kind: EnvelopeKind;
  type: string;
  engineId: string;
  sequence: number;               // engine-local monotonic; acked by Brain
  createdAt: string;              // ISO-8601
  payload?: Record<string, unknown>;
}

export interface CommandEnvelope extends ControlEnvelope {
  kind: 'command';
  payload: CommandPayload;
}

export type CommandPayload =
  | { op: 'START_SESSION'; accountId: string; epoch: number }
  | { op: 'DISCONNECT_SESSION'; accountId: string }
  | { op: 'REVOKE_SESSION'; accountId: string }
  | { op: 'HEALTH_CHECK' }
  | { op: 'SEND_MESSAGE'; accountId: string; toJid: string; text?: string };

export const kAESGCM = 'aes-256-gcm';
export const AUTH_SNAPSHOT_MAGIC = 'OPENWA_AUTH_V1';

export type SessionState =
  | 'STARTING'
  | 'PAIRING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'THROTTLED'
  | 'DISCONNECTED'
  | 'REVOKED'
  | 'FAILED';