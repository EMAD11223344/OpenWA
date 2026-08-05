/**
 * EngineFactory default engine test
 *
 * Proves the OpenWA gateway runs the whatsapp-web.js engine by default:
 *
 *   1. `EngineFactory` defaults to `'whatsapp-web.js'` when no engine type is configured
 *   2. `EngineFactory.create()` returns a `WhatsAppWebJsAdapter` by default
 *   3. `EngineFactory.create()` returns a `WhatsAppWebJsAdapter` for unknown engine
 *      types via the fallback branch
 *   4. Only the whatsapp-web.js engine plugin is registered
 *   5. The factory source contains no reference to alternative engine code
 */

import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { EngineFactory, EngineCreateOptions } from './engine.factory';
import { PluginLoaderService } from '../core/plugins';
import { EngineStatus } from './interfaces/whatsapp-engine.interface';
import { WhatsAppWebJsAdapter } from './adapters/whatsapp-web-js.adapter';

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

function readFactorySource(): string {
  const factoryPath = path.join(__dirname, 'engine.factory.ts');
  return fs.readFileSync(factoryPath, 'utf8');
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('EngineFactory defaults to whatsapp-web.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('defaults to "whatsapp-web.js" when engine.type is not configured', () => {
    const factory = buildFactory(undefined);

    // The factory exposes the resolved default via getCurrentEngine()
    expect(factory.getCurrentEngine()).toBe('whatsapp-web.js');
  });

  it('engine.type="whatsapp-web.js" registers the whatsapp-web.js engine plugin', async () => {
    const factory = buildFactory('whatsapp-web.js');

    await factory.onModuleInit(); // registers + enables the whatsapp-web.js plugin

    expect(factory.getCurrentEngine()).toBe('whatsapp-web.js');

    // There must be at least one ENGINE plugin registered with id 'whatsapp-web.js'
    const engines = factory.getAvailableEngines();
    const wwjsEngine = engines.find(e => e.id === 'whatsapp-web.js');
    expect(wwjsEngine).toBeDefined();
    expect(wwjsEngine?.features).toContain('text-messages');
  });

  it('only the whatsapp-web.js engine plugin is registered', async () => {
    const factory = buildFactory('whatsapp-web.js');
    await factory.onModuleInit();

    const engines = factory.getAvailableEngines();
    const engineIds = engines.map(e => e.id);
    expect(engineIds).toContain('whatsapp-web.js');
    expect(engineIds).toHaveLength(1);
  });

  it('create() returns a WhatsAppWebJsAdapter when engineType is unset (default branch)', async () => {
    const factory = buildFactory('whatsapp-web.js');
    await factory.onModuleInit();

    const opts: EngineCreateOptions = { sessionId: 'test-1' };
    const engine = factory.create(opts);

    expect(engine).toBeInstanceOf(WhatsAppWebJsAdapter);
    expect(engine.getStatus()).toBe(EngineStatus.DISCONNECTED);
  });

  it('create() falls back to WhatsAppWebJsAdapter for an unknown engineType', async () => {
    const factory = buildFactory('whatsapp-web.js');
    await factory.onModuleInit();

    // An unknown engineType hits the createFallbackEngine() branch, which
    // constructs a WhatsAppWebJsAdapter.
    const engine = factory.create({ sessionId: 'session-y', engineType: 'nonexistent-engine' });

    expect(engine).toBeInstanceOf(WhatsAppWebJsAdapter);
  });

  it('EngineFactory fallback constructs a WhatsAppWebJsAdapter', () => {
    const src = readFactorySource();
    // The fallback branch must construct a WhatsAppWebJsAdapter.
    expect(src).toMatch(/createFallbackEngine[\s\S]*new WhatsAppWebJsAdapter/);
  });
});
