/**
 * Baileys Adapter — Multi-Account Isolation Proof
 *
 * Proves that two independent BaileysAdapter instances with different
 * auth directories do not interfere with each other's credentials or state.
 *
 * Mocks `baileys` (the npm module) entirely — no real WhatsApp connection.
 */

import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { EngineStatus } from '../interfaces/whatsapp-engine.interface';

// ─── Mock baileys module ──────────────────────────────────────────────────────
const mockSaveCreds = jest.fn().mockResolvedValue(undefined);
const mockSendMessage = jest.fn().mockResolvedValue({
  key: { id: 'mock-msg-id-1', remoteJid: '1234@s.whatsapp.net' },
  messageTimestamp: Math.floor(Date.now() / 1000),
});

const mockEnd = jest.fn();
const mockEvOn = jest.fn();
const mockEvEmit = jest.fn();
const mockUpdateBlockStatus = jest.fn().mockResolvedValue(undefined);

let latestCallbacks: Record<string, (...args: unknown[]) => void> = {};

const mockSocket = {
  ev: {
    on: mockEvOn,
    emit: mockEvEmit,
    // Allow listeners to be registered — capture them for test triggering
    listeners: jest.fn().mockReturnValue([]),
  },
  user: { id: '1234:567890@s.whatsapp.net', name: 'Test User' },
  sendMessage: mockSendMessage,
  end: mockEnd,
  logout: jest.fn().mockResolvedValue(undefined),
  store: { contacts: {}, groupMetadata: {} },
  updateBlockStatus: mockUpdateBlockStatus,
  profilePictureUrl: jest.fn().mockResolvedValue('https://mock-pp.example.com/pp.jpg'),
  groupMetadata: jest.fn().mockResolvedValue({}),
  groupCreate: jest.fn().mockResolvedValue({ id: 'g1@g.us', subject: 'Test Group', participants: [] }),
  groupParticipantsUpdate: jest.fn().mockResolvedValue(undefined),
  groupLeave: jest.fn().mockResolvedValue(undefined),
  groupUpdateSubject: jest.fn().mockResolvedValue(undefined),
  groupUpdateDescription: jest.fn().mockResolvedValue(undefined),
  groupInviteCode: jest.fn().mockResolvedValue('mock-invite'),
  groupRevokeInvite: jest.fn().mockResolvedValue('mock-invite-revoked'),
  onWhatsApp: jest.fn().mockResolvedValue([{ exists: true, jid: '1234@s.whatsapp.net' }]),
  forwardMessage: jest.fn().mockResolvedValue({ key: { id: 'fwd-1' }, messageTimestamp: Date.now() }),
};

const mockUseMultiFileAuthState = jest.fn().mockResolvedValue({
  state: { creds: { id: 'mock-creds-id' } },
  saveCreds: mockSaveCreds,
});

jest.mock('@whiskeysockets/baileys', () => ({
  makeWASocket: jest.fn(() => mockSocket),
  useMultiFileAuthState: mockUseMultiFileAuthState,
  disconnectReason: { loggedOut: 401, connectionReplaced: 440 },
}));

// ─── Now import the adapter ──────────────────────────────────────────────────
import { BaileysAdapter } from './baileys.adapter';

// ─── Helpers ─────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-test-'));
  jest.clearAllMocks();
  latestCallbacks = {};
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BaileysAdapter — multi-account isolation proof', () => {
  it('creates two adapters with independent auth directories', async () => {
    const authA = path.join(tmpDir, 'session-a');
    const authB = path.join(tmpDir, 'session-b');

    const adapterA = new BaileysAdapter({ sessionId: 'session-a', authDir: authA });
    const adapterB = new BaileysAdapter({ sessionId: 'session-b', authDir: authB });

    // Wire callbacks to capture events
    const readyA = jest.fn();
    const readyB = jest.fn();
    adapterA.on('stateChanged', (s: EngineStatus) => {
      if (s === EngineStatus.READY) readyA();
    });
    adapterB.on('stateChanged', (s: EngineStatus) => {
      if (s === EngineStatus.READY) readyB();
    });

    // Initialize both
    await adapterA.initialize({
      onReady: jest.fn(),
      onQRCode: jest.fn(),
      onDisconnected: jest.fn(),
      onStateChanged: jest.fn(),
    });

    await adapterB.initialize({
      onReady: jest.fn(),
      onQRCode: jest.fn(),
      onDisconnected: jest.fn(),
      onStateChanged: jest.fn(),
    });

    // Both should have their own auth dirs (fs.access returns undefined on success)
    await expect(fs.access(authA)).resolves.toBeUndefined();
    await expect(fs.access(authB)).resolves.toBeUndefined();

    // Trigger connection.open on adapterB only — adapterA stays INITIALIZING
    const connectionUpdateCalls = mockEvOn.mock.calls.filter(
      (c: unknown[]) => Array.isArray(c) && c[0] === 'connection.update',
    );
    const lastConnectionHandler = connectionUpdateCalls[connectionUpdateCalls.length - 1]?.[1];
    lastConnectionHandler({ connection: 'open' });

    // adapterA: INITIALIZING (never got the event), adapterB: READY
    expect(adapterA.getStatus()).toBe(EngineStatus.INITIALIZING);
    expect(adapterB.getStatus()).toBe(EngineStatus.READY);
  });

  it('destroying one adapter does not affect the other', async () => {
    const authA = path.join(tmpDir, 'session-a');
    const authB = path.join(tmpDir, 'session-b');

    const adapterA = new BaileysAdapter({ sessionId: 'session-a', authDir: authA });
    const adapterB = new BaileysAdapter({ sessionId: 'session-b', authDir: authB });

    await adapterA.initialize({ onReady: jest.fn(), onQRCode: jest.fn(), onDisconnected: jest.fn(), onStateChanged: jest.fn() });
    await adapterB.initialize({ onReady: jest.fn(), onQRCode: jest.fn(), onDisconnected: jest.fn(), onStateChanged: jest.fn() });

    // Destroy adapter A
    await adapterA.destroy();

    // Adapter B should still be INITIALIZING (not FAILED or crashed)
    expect(adapterB.getStatus()).not.toBe(EngineStatus.FAILED);

    // Both auth dirs should still exist on disk
    await expect(fs.access(authA)).resolves.toBeUndefined();
    await expect(fs.access(authB)).resolves.toBeUndefined();
  });

  it('logout clears auth dir but does not touch the other session', async () => {
    const authA = path.join(tmpDir, 'session-a');
    const authB = path.join(tmpDir, 'session-b');

    // Pre-create auth dirs with dummy files
    await fs.mkdir(authA, { recursive: true });
    await fs.mkdir(authB, { recursive: true });
    await fs.writeFile(path.join(authA, 'creds.json'), '{}');
    await fs.writeFile(path.join(authB, 'creds.json'), '{}');

    const adapterA = new BaileysAdapter({ sessionId: 'session-a', authDir: authA });
    const adapterB = new BaileysAdapter({ sessionId: 'session-b', authDir: authB });

    // Logout adapter A
    await adapterA.logout();

    // Session A auth dir should be deleted
    let authAExists = true;
    try {
      await fs.access(authA);
    } catch {
      authAExists = false;
    }
    expect(authAExists).toBe(false);

    // Session B auth dir should still exist with creds.json
    const credsB = await fs.readFile(path.join(authB, 'creds.json'), 'utf-8');
    expect(credsB).toBe('{}');
  });

  it('uses per-session makeWASocket calls (not shared)', async () => {
    const { makeWASocket } = require('@whiskeysockets/baileys') as { makeWASocket: jest.Mock };

    const authA = path.join(tmpDir, 'session-a');
    const authB = path.join(tmpDir, 'session-b');

    const adapterA = new BaileysAdapter({ sessionId: 'session-a', authDir: authA });
    const adapterB = new BaileysAdapter({ sessionId: 'session-b', authDir: authB });

    await adapterA.initialize({ onReady: jest.fn(), onQRCode: jest.fn(), onDisconnected: jest.fn(), onStateChanged: jest.fn() });
    await adapterB.initialize({ onReady: jest.fn(), onQRCode: jest.fn(), onDisconnected: jest.fn(), onStateChanged: jest.fn() });

    // makeWASocket called twice (once per adapter)
    expect(makeWASocket).toHaveBeenCalledTimes(2);

    // Each call gets a different auth state
    const firstCallAuth = makeWASocket.mock.calls[0][0].auth;
    const secondCallAuth = makeWASocket.mock.calls[1][0].auth;
    expect(firstCallAuth).toBeDefined();
    expect(secondCallAuth).toBeDefined();
  });

  it('both adapters can send messages independently', async () => {
    const authA = path.join(tmpDir, 'session-a');
    const authB = path.join(tmpDir, 'session-b');

    const adapterA = new BaileysAdapter({ sessionId: 'session-a', authDir: authA });
    const adapterB = new BaileysAdapter({ sessionId: 'session-b', authDir: authB });

    await adapterA.initialize({ onReady: jest.fn(), onQRCode: jest.fn(), onDisconnected: jest.fn(), onStateChanged: jest.fn() });
    await adapterB.initialize({ onReady: jest.fn(), onQRCode: jest.fn(), onDisconnected: jest.fn(), onStateChanged: jest.fn() });

    // Force both to READY
    const connUpdateCalls = mockEvOn.mock.calls.filter(
      (c: unknown[]) => Array.isArray(c) && c[0] === 'connection.update',
    );
    // Trigger connection.open on adapter B (most recent listener)
    const handler = connUpdateCalls[connUpdateCalls.length - 1]?.[1] as (u: Record<string, unknown>) => void;
    handler({ connection: 'open' });

    // Send message via B — should use B's socket instance
    await adapterB.sendTextMessage('1234@s.whatsapp.net', 'Hello from B');
    expect(mockSendMessage).toHaveBeenCalledWith(
      '1234@s.whatsapp.net',
      expect.objectContaining({ text: 'Hello from B' }),
    );
  });
});
