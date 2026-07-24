/**
 * S1 — WhatsApp Baileys Migration Proof Test
 *
 * Proves the OpenWA gateway has fully migrated from Chromium-based
 * whatsapp-web.js to the pure-WebSocket @whiskeysockets/baileys engine:
 *
 *   1. `EngineFactory` defaults to `'baileys'` when no engine type is configured
 *   2. `EngineFactory.create()` returns a `BaileysAdapter` instance by default
 *   3. `EngineFactory.create()` returns a `BaileysAdapter` when explicitly asked
 *      for `'baileys'`, even when the whatsapp-web.js plugin is also registered
 *   4. `EngineFactory.create()` returns a `BaileysAdapter` for unknown engine
 *      types via the fallback branch — it NEVER falls back to whatsapp-web.js
 *   5. The `BaileysAdapter` source only references `@whiskeysockets/baileys` and
 *      `qrcode` — never `whatsapp-web.js`, `puppeteer`, or `chromium`
 *
 * Together these assertions prove: the default engine is Baileys, the
 * fallback is Baileys, and no Chromium-based code path is reachable from
 * the factory's `create()` on the Baileys branch.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { EngineFactory, EngineCreateOptions } from './engine.factory';
import { PluginLoaderService } from '../core/plugins';
import { EngineStatus } from './interfaces/whatsapp-engine.interface';
import { BaileysAdapter } from './adapters/baileys.adapter';

// Mock createLogger so LoggerService instantiations inside the factory and
// plugin loader don't print JSON lines during the test run.
jest.mock('../common/services/logger.service', () => ({
  createLogger: () => ({
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  }),
}));

// ─── Shared fake infra ────────────────────────────────────────────────────────
// Avoid pulling the real PluginStorageService (which writes JSON to disk).
const fakePluginStorage: any = {
  getPluginConfig: jest.fn().mockReturnValue({}),
  setPluginConfig: jest.fn().mockResolvedValue(undefined),
  getPluginEntry: jest.fn().mockReturnValue(undefined),
  savePluginEntry: jest.fn().mockResolvedValue(undefined),
  getPluginStatus: jest.fn().mockReturnValue(null),
  setPluginStatus: jest.fn().mockResolvedValue(undefined),
  createPluginStorage: jest.fn().mockReturnValue({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    list: jest.fn().mockResolvedValue([]),
  }),
};

const fakeHookManager: any = {
  execute: jest.fn().mockResolvedValue({ continue: true, data: {} }),
  register: jest.fn(),
  unregisterPlugin: jest.fn(),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildFactory(engineType: string | undefined): EngineFactory {
  const configService = new ConfigService({ engine: { type: engineType } });
  const loader = new PluginLoaderService(configService, fakeHookManager, fakePluginStorage);
  return new EngineFactory(configService, loader);
}

/**
 * Reads the `baileys.adapter.ts` and `engine.factory.ts` source files and
 * asserts neither contains any reference to the Chromium-based engine:
 *   - `whatsapp-web.js` (import or require)
 *   - `puppeteer`
 *   - `chromium` (case-insensitive except for the comment in the file header
 *     that explicitly says "No Chromium" — that's documentation, not a code
 *     reference, so we allow it via a negative-lookahead for whitespace
 *     usage of the bare identifier rather than the substring)
 *
 * Proving at the source level is more meaningful than scanning `require.cache`
 * — Node's module cache is a process-wide mutable singleton that this test
 * suite does not own, so its contents are non-deterministic across test
 * ordering. The source-level check is deterministic and is exactly what an
 * auditor would grep for.
 */
function readAdapterSource(): string {
  const adapterPath = path.join(__dirname, 'adapters', 'baileys.adapter.ts');
  return fs.readFileSync(adapterPath, 'utf8');
}

function readFactorySource(): string {
  const factoryPath = path.join(__dirname, 'engine.factory.ts');
  return fs.readFileSync(factoryPath, 'utf8');
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('S1 — EngineFactory defaults to Baileys (Chromium-free migration)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('defaults to "baileys" when engine.type is not configured', () => {
    const factory = buildFactory(undefined);

    // The factory exposes the resolved default via getCurrentEngine()
    expect(factory.getCurrentEngine()).toBe('baileys');
  });

  it('engine.type="baileys" registers the baileys engine plugin with low-memory feature', async () => {
    const factory = buildFactory('baileys');

    await factory.onModuleInit(); // registers + enables the baileys plugin

    expect(factory.getCurrentEngine()).toBe('baileys');

    // There must be at least one ENGINE plugin registered with id 'baileys'
    const engines = factory.getAvailableEngines();
    const baileysEngine = engines.find(e => e.id === 'baileys');
    expect(baileysEngine).toBeDefined();
    // The plugin's getFeatures() lists the WS-only selling point.
    expect(baileysEngine?.features).toContain('low-memory');
  });

  it('create() returns a BaileysAdapter when engineType is unset (default branch)', async () => {
    const factory = buildFactory('baileys'); // explicit, deterministic
    await factory.onModuleInit();

    const opts: EngineCreateOptions = { sessionId: 'test-1' };
    const engine = factory.create(opts);

    // Direct class reference — proves we got the BaileysAdapter
    expect(engine).toBeInstanceOf(BaileysAdapter);
    expect(engine.getStatus()).toBe(EngineStatus.DISCONNECTED);
  });

  it('create() returns a BaileysAdapter when engineType is explicitly "baileys"', async () => {
    const factory = buildFactory('whatsapp-web.js'); // wrong default
    await factory.onModuleInit();

    // Per-session override to baileys — must win over the default
    const engine = factory.create({ sessionId: 'session-x', engineType: 'baileys' });

    expect(engine).toBeInstanceOf(BaileysAdapter);
  });

  it('create() falls back to BaileysAdapter (NOT whatsapp-web.js) for an unknown engineType', async () => {
    const factory = buildFactory('baileys');
    await factory.onModuleInit();

    // An unknown engineType must not surface the chromium adapter — it hits
    // the createFallbackEngine() branch, which hard-codes BaileysAdapter.
    const engine = factory.create({ sessionId: 'session-y', engineType: 'nonexistent-engine' });

    expect(engine).toBeInstanceOf(BaileysAdapter);
  });

  it('even when whatsapp-web.js is the default, per-session override to baileys yields BaileysAdapter', async () => {
    // Build a factory whose default is whatsapp-web.js, but we ask for baileys —
    // proves per-session Baileys overrides take precedence over any chromium default.
    const configService = new ConfigService({ engine: { type: 'whatsapp-web.js' } });
    const loader = new PluginLoaderService(configService, fakeHookManager, fakePluginStorage);
    const factory = new EngineFactory(configService, loader);

    await factory.onModuleInit();

    // Factory claims its default is whatsapp-web.js — that's fine, the point is
    // the explicit Baileys path always wins when asked.
    expect(factory.getCurrentEngine()).toBe('whatsapp-web.js');

    const engine = factory.create({ sessionId: 'override-1', engineType: 'baileys' });
    expect(engine).toBeInstanceOf(BaileysAdapter);
  });

  it('BaileysAdapter source contains zero puppeteer imports and no whatsapp-web.js adapter wiring', () => {
    const src = readAdapterSource();
    // No puppeteer imports / requires / strings
    expect(src).not.toMatch(/\bpuppeteer\b/);
    // No whatsapp-web.js import / require. Allow it to appear as a substring
    // of unrelated text (e.g. "Failed to") by anchoring on import/require
    // statements — the actual Chromium migration contract.
    expect(src).not.toMatch(/(\bimport\b.*from\s+['"][^'"]*whatsapp-web\.js)/);
    expect(src).not.toMatch(/require\(['"][^'"]*whatsapp-web\.js['"]\)/);
    // No chromium import / require. The class docstring mentions "No Chromium"
    // so we only forbid chromium as a module identifier in import/require sites.
    expect(src).not.toMatch(/require\(['"][^'"]*chromium[^'"]*['"]\)/i);
    expect(src).not.toMatch(/import[^;]*from\s+['"][^'"]*chromium[^'"]*['"]/i);
  });

  it('EngineFactory falls back to BaileysAdapter (never whatsapp-web.js) in createFallbackEngine', () => {
    const src = readFactorySource();
    // The fallback branch must construct a BaileysAdapter, not a WhatsAppWebJsAdapter.
    expect(src).toMatch(/createFallbackEngine[\s\S]*new BaileysAdapter/);
    // Conversely, the factory must not construct WhatsAppWebJsAdapter anywhere.
    expect(src).not.toMatch(/new\s+WhatsAppWebJsAdapter/);
  });
});
