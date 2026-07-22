import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IWhatsAppEngine } from './interfaces/whatsapp-engine.interface';
import { WhatsAppWebJsAdapter } from './adapters/whatsapp-web-js.adapter';
import { PluginLoaderService, PluginType, IEnginePlugin, PluginManifest } from '../core/plugins';
import { WhatsAppWebJsPlugin } from '../plugins/engines/whatsapp-web-js';
import { createLogger } from '../common/services/logger.service';

export interface EngineCreateOptions {
  sessionId: string;
  /**
   * Optional per-session override for engine type. If unset, falls back to the
   * global `engine.type` env / config setting. Allows one Space to host both
   * whatsapp-web.js and baileys sessions side-by-side during migration.
   */
  engineType?: string;
  proxyUrl?: string;
  proxyType?: 'http' | 'https' | 'socks4' | 'socks5';
}

@Injectable()
export class EngineFactory implements OnModuleInit {
  private readonly logger = createLogger('EngineFactory');
  private defaultEngineType: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly pluginLoader: PluginLoaderService,
  ) {
    this.defaultEngineType = this.configService.get<string>('engine.type') ?? 'baileys';
  }

  async onModuleInit(): Promise<void> {
    // Register built-in engine plugins
    await this.registerBuiltInEngines();
  }

  private async registerBuiltInEngines(): Promise<void> {
    // Register WhatsApp-web.js as built-in plugin
    const wwjsManifest: PluginManifest = {
      id: 'whatsapp-web.js',
      name: 'WhatsApp Web.js Engine',
      version: '1.0.0',
      type: PluginType.ENGINE,
      description: 'Official WhatsApp-web.js engine adapter',
      main: 'index.ts',
      provides: ['whatsapp-engine'],
    };

    const wwjsPlugin = new WhatsAppWebJsPlugin();
    this.pluginLoader.registerBuiltInPlugin(wwjsManifest, wwjsPlugin);

    // Register Baileys as built-in plugin (no-op until `engineType=baileys`
    // is selected via env or per-session override).
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { BaileysPlugin } = require('../plugins/engines/baileys') as {
        BaileysPlugin: { new (): unknown };
      };
      const baileysPlugin = new BaileysPlugin();
      const baileysManifest: PluginManifest = {
        id: 'baileys',
        name: 'Baileys Engine',
        version: '1.0.0',
        type: PluginType.ENGINE,
        description: 'Pure WebSocket WhatsApp engine (no Chromium)',
        main: 'index.ts',
        provides: ['whatsapp-engine', 'text-messages', 'media-messages', 'group-management', 'low-memory'],
      };
      this.pluginLoader.registerBuiltInPlugin(baileysManifest, baileysPlugin as never);
    } catch (err) {
      this.logger.warn(
        `Skipping baileys plugin registration (not yet available): ${String(err)}`,
        { action: 'baileys_register_skipped' },
      );
    }

    // Auto-enable the default engine
    try {
      await this.pluginLoader.enablePlugin(this.defaultEngineType);
      this.logger.log(`Engine plugin enabled: ${this.defaultEngineType}`, {
        action: 'engine_enabled',
        engineType: this.defaultEngineType,
      });
    } catch (error) {
      this.logger.error(
        `Failed to enable engine plugin: ${this.defaultEngineType}`,
        error instanceof Error ? error.message : String(error),
        { action: 'engine_enable_failed' },
      );
    }
  }

  create(options: EngineCreateOptions): IWhatsAppEngine {
    const engineType = options.engineType || this.defaultEngineType;

    // Try to get engine from plugin system
    const enginePlugin = this.pluginLoader.getPlugin(engineType);

    if (enginePlugin?.instance && this.isEnginePlugin(enginePlugin.instance)) {
      return enginePlugin.instance.createEngine({
        sessionId: options.sessionId,
        proxyUrl: options.proxyUrl,
        proxyType: options.proxyType,
      }) as IWhatsAppEngine;
    }

    // Special-case: baileys wasn't registered (module missing). Fall back to
    // the direct constructor path if executable.
    if (engineType === 'baileys') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { BaileysAdapter } = require('../engine/adapters/baileys.adapter') as {
          BaileysAdapter: { new (cfg: unknown): IWhatsAppEngine };
        };
        const dataDir =
          (this.configService.get<string>('dataDatabase.database') ?? './data') + '/sessions';
        return new BaileysAdapter({
          sessionId: options.sessionId,
          authDir: dataDir + '/' + options.sessionId,
          proxyUrl: options.proxyUrl ?? undefined,
          proxyType: options.proxyType ?? undefined,
        });
      } catch (err) {
        this.logger.error(`BaileysPlugin.requested but BaileysAdapter not built: ${String(err)}`);
        throw err;
      }
    }

    // Fallback to direct adapter creation (legacy support)
    this.logger.warn(`Engine plugin ${engineType} not available, using fallback`, {
      action: 'engine_fallback',
    });

    return this.createFallbackEngine(options);
  }

  private isEnginePlugin(instance: unknown): instance is IEnginePlugin {
    return (
      typeof instance === 'object' &&
      instance !== null &&
      'type' in instance &&
      (instance as { type: unknown }).type === PluginType.ENGINE &&
      'createEngine' in instance &&
      typeof (instance as { createEngine: unknown }).createEngine === 'function'
    );
  }

  private createFallbackEngine(options: EngineCreateOptions): IWhatsAppEngine {
    // Legacy direct creation (fallback)
    return new WhatsAppWebJsAdapter({
      sessionId: options.sessionId,
      sessionDataPath: this.configService.get<string>('engine.sessionDataPath') ?? './data/sessions',
      puppeteer: {
        headless: this.configService.get<boolean>('engine.puppeteer.headless') ?? true,
        args: this.configService.get<string[]>('engine.puppeteer.args') ?? ['--no-sandbox', '--disable-setuid-sandbox'],
      },
      proxy: options.proxyUrl
        ? {
            url: options.proxyUrl,
            type: options.proxyType ?? 'http',
          }
        : undefined,
    });
  }

  // ============================================================================
  // Query Methods for API/Dashboard
  // ============================================================================

  getAvailableEngines(): Array<{ id: string; name: string; enabled: boolean; features: string[] }> {
    const enginePlugins = this.pluginLoader.getPluginsByType(PluginType.ENGINE);

    return enginePlugins.map(plugin => {
      const features = plugin.instance && this.isEnginePlugin(plugin.instance) ? plugin.instance.getFeatures() : [];

      return {
        id: plugin.manifest.id,
        name: plugin.manifest.name,
        enabled: this.pluginLoader.isPluginEnabled(plugin.manifest.id),
        features,
      };
    });
  }

  getCurrentEngine(): string {
    return this.defaultEngineType;
  }

  setDefaultEngine(engineType: string): void {
    this.defaultEngineType = engineType;
    this.logger.log(`Default engine changed to: ${engineType}`, {
      action: 'engine_switched',
      engineType,
    });
  }
}
