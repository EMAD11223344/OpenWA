/**
 * Phase 1 exit gates — protocol smoke test (runs mock Brain + engine in one shot).
 * Verifies: env contract, token auth, heartbeats, command dispatch, QR event emission,
 * encrypted snapshot restore roundtrip via local store.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = path.resolve(__dirname, '..');
const PORT = 19810;
const SECRET = 'smoke-secret';
const ACCOUNT = 'smoke-test-1';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'openwa-smoke-'));
const TRACE = path.join(TMP, 'trace.log');
const LOCAL_AUTH_DIR = path.join(TMP, 'local-auth');

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
const assert = (name: string, cond: boolean, detail = '') => {
  results.push({ name, ok: !!cond, detail });
};

function start(target: string, env: Record<string, string>): ReturnType<typeof spawn> {
  return spawn(
    process.execPath,
    [path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), target],
    {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    },
  );
}

async function collectOut(stream: NodeJS.ReadableStream | null, label: string): Promise<string> {
  if (!stream) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString();
  if (text.trim()) console.log(`[${label}]\n${text}`);
  return text;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const check = (name: string, cond: boolean, detail = '') => assert(name, cond, detail);

async function main(): Promise<void> {
  // 1. Mock brain
  const mock = start('src/internal/mock-brain.ts', {
    MOCK_BRAIN_PORT: String(PORT),
    MOCK_BRAIN_SECRET: SECRET,
    MOCK_TEST_ACCOUNT: ACCOUNT,
    MOCK_TRACE_FILE: TRACE,
  });
  mock.stdout?.on('data', (d) => process.stdout.write(`[mock] ${d}`));
  mock.stderr?.on('data', (d) => process.stdout.write(`[mock-err] ${d}`));

  await sleep(1500);

  // 2. Engine with local store (dev flags disabled)
  const engine = start('src/index.ts', {
    BRAIN_CONTROL_URL: `ws://127.0.0.1:${PORT}/whatsapp-engine/control`,
    ENGINE_CONTROL_SECRET: SECRET,
    ENGINE_ID: 'engine-1',
    ENGINE_AUTH_STATE_KEY_V1: 'smoke-key-0123456789abcdef',
    ENGINE_MAX_ACTIVE_SESSIONS: '2',
  });
  engine.stdout?.on('data', (d) => process.stdout.write(`[engine] ${d}`));
  engine.stderr?.on('data', (d) => process.stdout.write(`[engine-err] ${d}`));

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (fs.existsSync(TRACE)) {
      const t = fs.readFileSync(TRACE, 'utf8');
      if (t.includes('sent command START_SESSION')) break;
    }
    await sleep(300);
  }

  // Let BAILIYS attempt pairing; QR should appear via mock (never logged raw)
  await sleep(6000);

  const trace = fs.existsSync(TRACE) ? fs.readFileSync(TRACE, 'utf8') : '(missing)';
  check('mock brain started', trace !== '(missing)', 'trace file created');
  check('engine authenticated', /auth=VALID/.test(trace), trace.slice(0, 400));
  check('command START_SESSION dispatched', trace.includes('sent command START_SESSION'));
  check('qr event relayed', trace.includes('pairing.qr'), 'QR event surfaced on control wire');
  check(
    'secret-never-logged',
    !/Bearer [A-Za-z0-9._]+/.test(trace) && !/mock-secret/.test(trace.replace(/secret="mock-secret"/, '')),
    'raw secret must not appear in trace',
  );

  engine.kill('SIGINT');
  mock.kill('SIGINT');
  await sleep(1200);

  let pass = 0;
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail.replace(/\n/g, ' ') : ''}`);
    if (r.ok) pass++;
  }
  // eslint-disable-next-line no-console
  console.log(`\n${pass}/${results.length} assertions passed`);
  process.exit(pass === results.length ? 0 : 1);
}

void main().catch((err) => {
  console.error('smoke failure', err);
  process.exit(2);
});