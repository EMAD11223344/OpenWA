/**
 * Local mock Brain for engine development (Phase 1 exit criteria):
 * - listens on ws://127.0.0.1:PORT, verifies the engine's Bearer token
 * - accepts one live connection per engineId (plan §7.2)
 * - logs every envelope received from the engine to a protocol trace file
 * - replies to 'engine.hello' with a START_SESSION command for the test account
 */
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { createHmac, timingSafeEqual } from 'crypto';
import fs from 'fs';
import { ControlEnvelope } from '../envelope';

const PORT = parseInt(process.env.MOCK_BRAIN_PORT || '9810', 10);
const SECRET = process.env.MOCK_BRAIN_SECRET || 'mock-secret';
const TEST_ACCOUNT = process.env.MOCK_TEST_ACCOUNT || 'ws-test-1';
const TRACE_FILE = process.env.MOCK_TRACE_FILE || 'protocol-trace.mock.log';

/** Verify token: ts.exp.engineId.hmac — 60s window. */
function validToken(raw: string | undefined, engineId: string): boolean {
  if (!raw?.startsWith('Bearer ')) return false;
  const token = raw.slice(7);
  const parts = token.split('.');
  if (parts.length !== 4) return false;
  const [ts, exp, id, mac] = parts;
  const now = Math.floor(Date.now() / 1000);
  if (Number(ts) > now + 30 || Number(exp) < now) return false;
  if (id !== engineId) return false;
  const expected = createHmac('sha256', SECRET).update(`${ts}.${exp}.${id}`).digest('hex');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const server = createServer();
const wss = new WebSocketServer({ server, path: '/whatsapp-engine/control' });

const trace = fs.createWriteStream(TRACE_FILE, { flags: 'a' });
function logTrace(line: string): void {
  trace.write(`[${new Date().toISOString()}] ${line}\n`);
  console.log(line);
}

const liveClients = new Map<string, import('ws').WebSocket>();

wss.on('connection', (ws, req) => {
  const token = (req.headers.authorization as string | undefined) ?? undefined;
  const engineIdHdr = token?.split('.').slice(-2)?.[0] ?? '';
  const engineId = token?.split('.')[2] || 'unknown';
  logTrace(`connection request engineId=${engineId} auth=${validToken(token, engineId) ? 'VALID' : 'INVALID'}`);

  if (!validToken(token, engineId)) {
    ws.close(4401, 'unauthorized');
    return;
  }
  const prev = liveClients.get(engineId);
  if (prev && prev.readyState === prev.OPEN) {
    logTrace(`engineId=${engineId} duplicate connection — closing older`);
    prev.close(4403, 'connection replaced');
  }
  liveClients.set(engineId, ws);
  ws.on('close', () => {
    if (liveClients.get(engineId) === ws) liveClients.delete(engineId);
  });

  logTrace(`engineId=${engineId} authenticated — connected`);
  ws.send(JSON.stringify({ kind: 'ack', type: 'connection', engineId, sequence: 1, createdAt: new Date().toISOString() }));

  const scheduleStart = () => {
    setTimeout(() => {
      if (ws.readyState !== ws.OPEN) return;
      const start: ControlEnvelope = {
        id: 'mock-start-1',
        kind: 'command',
        type: 'START_SESSION',
        engineId,
        sequence: 10,
        createdAt: new Date().toISOString(),
        payload: { accountId: TEST_ACCOUNT, epoch: 1 },
      };
      ws.send(JSON.stringify(start));
      logTrace(`sent command START_SESSION account=${TEST_ACCOUNT} epoch=1`);
    }, 500);
  };

  // platform runtime capacity control (plan §4.2): brain pushes SET_CAPACITY,
  // engine updates its cap without restart and re-advertises via engine.health
  const scheduleCapacity = (value: number) => {
    setTimeout(() => {
      if (ws.readyState !== ws.OPEN) return;
      const cap: ControlEnvelope = {
        id: 'mock-capacity-1',
        kind: 'command',
        type: 'SET_CAPACITY',
        engineId,
        sequence: 11,
        createdAt: new Date().toISOString(),
        payload: { maxSessions: value },
      };
      ws.send(JSON.stringify(cap));
      logTrace(`sent command SET_CAPACITY maxSessions=${value}`);
    }, 2500);
  };

  // Wait for engine.hello before autonomous commands
  ws.on('message', (raw) => {
    try {
      const env: ControlEnvelope = JSON.parse(String(raw));
      logTrace(`event kind=${env.kind} type=${env.type} seq=${env.sequence} ${JSON.stringify(env.payload ?? {})}`);
      if (env.type === 'engine.hello') {
        scheduleStart();
        scheduleCapacity(Number(process.env.MOCK_CAPACITY || 40));
      }
      if (env.type === 'pairing.qr') {
        logTrace(`QR received for ${String(env.payload?.accountId)} — length ${String(env.payload?.qr).length}`);
      }
    } catch (e) {
      logTrace(`bad frame: ${String(e)}`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`[mock-brain] listening ws://127.0.0.1:${PORT}/whatsapp-engine/control secret="${SECRET}" trace=${TRACE_FILE}`);
});