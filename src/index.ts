/**
 * Engine entry: env config, control client wiring, command dispatch, graceful shutdown.
 * Secrets per migration plan §4.3: ENGINE_ID, BRAIN_CONTROL_URL, ENGINE_CONTROL_SECRET,
 * ENGINE_AUTH_STATE_KEY_V1, HF_BUCKET_*, ENGINE_MAX_ACTIVE_SESSIONS.
 */
import path from 'path';
import { createServer, Server } from 'http';
import { CommandEnvelope } from './envelope';
import { ControlClient } from './control-client';
import { Engine } from './engine';
import { LocalAuthStore, AuthSnapshotStore } from './storage';
import { S3AuthSnapshotStore } from './s3store';
import { Logger } from './logger';

export interface RuntimeConfig {
  engineId: string;
  brainControlUrl: string;
  controlSecret: string;
  authStateKey: Buffer;
  authStore: AuthSnapshotStore;
  maxActiveSessions: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const log = new Logger('bootstrap');
  const engineId = env.ENGINE_ID || 'engine-1';
  const brainControlUrl = env.BRAIN_CONTROL_URL || '';
  const controlSecret = env.ENGINE_CONTROL_SECRET || '';
  const maxSessions = parseInt(env.ENGINE_MAX_ACTIVE_SESSIONS || '1', 10);

  if (!brainControlUrl.startsWith('wss://')) {
    log.warn({}, 'BRAIN_CONTROL_URL missing/not wss:// — engine will idle until configured');
  }

  let authStore: AuthSnapshotStore;
  if (env.HF_BUCKET_NAME) {
    authStore = new S3AuthSnapshotStore({
      endpoint: env.HF_BUCKET_ENDPOINT || '',
      region: env.HF_BUCKET_REGION || 'us-east-1',
      bucket: env.HF_BUCKET_NAME,
      accessKeyId: env.HF_BUCKET_ACCESS_KEY_ID || env.HF_BUCKET_ACCESS_TOKEN || '',
      secretAccessKey: env.HF_BUCKET_SECRET_ACCESS_KEY || '',
    });
    log.info(`auth store: private S3 bucket "${env.HF_BUCKET_NAME}"`);
  } else {
    authStore = new LocalAuthStore(path.join(process.cwd(), '.local-auth-dev'));
    log.warn({}, 'no HF_BUCKET_NAME — LOCAL store active (dev/test only, NOT production)');
  }

  const authStateKey = deriveKey(env.ENGINE_AUTH_STATE_KEY_V1 || '');
  return {
    engineId,
    brainControlUrl,
    controlSecret,
    authStateKey,
    authStore,
    maxActiveSessions: Math.max(1, maxSessions),
  };
}

function deriveKey(secret: string): Buffer {
  const { createHash } = require('crypto');
  if (secret) {
    return createHash('sha256').update(secret).digest(); // 32-byte key from any-length secret
  }
  return createHash('sha256').update('OPENWA_DEV_KEY_LEGACY_FALLBACK_DO_NOT_USE_IN_PROD').digest();
}

export function buildEngine(cfg: RuntimeConfig): {
  control: ControlClient;
  engine: Engine;
  start: () => void;
  stop: () => Promise<void>;
} {
  const log = new Logger('engine');
  let control: ControlClient;
  let engine: Engine;

  function dispatch(eng: Engine, cmd: CommandEnvelope): Promise<void> {
    const payload = cmd.payload as Record<string, any>;
    switch (cmd.type) {
      case 'START_SESSION':
        return eng.startSession(payload.accountId, payload.epoch ?? 0);
      case 'DISCONNECT_SESSION':
        return eng.disconnectSession(payload.accountId);
      case 'REVOKE_SESSION':
        return eng.revokeSession(payload.accountId);
      case 'SEND_MESSAGE':
        return eng.sendMessage(payload.accountId, payload.toJid, payload.text);
      case 'HEALTH_CHECK':
        control.emit('engine.health', { active: eng.activeCount, capacity: eng.capacity, state: 'OK' });
        return Promise.resolve();
      default:
        control.emit('command.error', { op: cmd.type, reason: 'unknown_command' });
        return Promise.resolve();
    }
  }

  control = new ControlClient({
    brainControlUrl: cfg.brainControlUrl,
    engineId: cfg.engineId,
    secret: cfg.controlSecret,
    log,
    onOpen: () => {
      control.emit('engine.hello', {
        engineId: cfg.engineId,
        version: '0.1.0',
        capacity: cfg.maxActiveSessions,
        abilities: ['start_session', 'disconnect', 'revoke', 'send_message'],
        stateKeyFingerprint: cfg.authStateKey.slice(0, 6).toString('hex'),
      });
    },
    onCommand: (cmd: CommandEnvelope) => dispatch(engine, cmd),
  });
  // eslint-disable-next-line prefer-const
  engine = new Engine({
    engineId: cfg.engineId,
    authStateKey: cfg.authStateKey,
    authStore: cfg.authStore,
    control,
    maxActiveSessions: cfg.maxActiveSessions,
    log,
  });

  function stop(): Promise<void> {
    return engine.stopAll().then(() => control.close());
  }

  return { control, engine, start: () => control.connect(), stop };
}

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const cfg = loadConfig(env);
  const runtime = buildEngine(cfg);
  runtime.start();

  const port = parseInt(env.PORT || env.APP_PORT || '7860', 10);
  let healthServer: Server | null = null;
  try {
    healthServer = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'OK', engineId: cfg.engineId }));
    });
    healthServer.listen(port, () => {
      console.log(`[engine] HTTP health server listening on port ${port}`);
    });
  } catch (err) {
    console.warn('[engine] Failed to start HTTP health server:', err);
  }

  const graceful = async (signal: string) => {
    console.log(`[engine] ${signal} — shutting down`);
    if (healthServer) {
      healthServer.close();
    }
    await runtime.stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => void graceful('SIGTERM'));
  process.on('SIGINT', () => void graceful('SIGINT'));
}

if (require.main === module) {
  void main(process.env);
}