/**
 * Baileys Engine Plugin
 * Pure WebSocket engine wrapping @whiskeysockets/baileys.
 * No Chromium. No browser. 30-80 MB per session vs 250-400 MB for whatsapp-web.js.
 */

import { PluginContext, PluginType, IEnginePlugin } from '../../../core/plugins';
import { IWhatsAppEngine } from '../../../engine/interfaces/whatsapp-engine.interface';
import { BaileysAdapter } from '../../../engine/adapters/baileys.adapter';

export interface BaileysPluginConfig {
  authDir?: string;
  printQR?: boolean;
}

export class BaileysPlugin implements IEnginePlugin {
  type = PluginType.ENGINE as const;
  private context?: PluginContext;

  onLoad(context: PluginContext): Promise<void> {
    this.context = context;
    context.logger.log('Baileys engine plugin loaded');
    return Promise.resolve();
  }

  onEnable(context: PluginContext): Promise<void> {
    context.logger.log('Baileys engine plugin enabled');
    return Promise.resolve();
  }

  onDisable(context: PluginContext): Promise<void> {
    context.logger.log('Baileys engine plugin disabled');
    return Promise.resolve();
  }

  createEngine(config: Record<string, unknown>): IWhatsAppEngine {
    const sessionId = config.sessionId as string;
    const authDir =
      (config.authDir as string) ?? (this.context?.config.authDir as string) ?? `./data/sessions/${sessionId}`;
    const printQR = (config.printQR as boolean) ?? (this.context?.config.printQR as boolean) ?? false;

    return new BaileysAdapter({
      sessionId,
      authDir,
      printQR,
    });
  }

  getFeatures(): string[] {
    return [
      'text-messages',
      'media-messages',
      'location-messages',
      'contact-messages',
      'group-management',
      'message-reactions',
      'message-replies',
      'message-forwarding',
      'message-deletion',
      'low-memory',
    ];
  }

  healthCheck(): Promise<{ healthy: boolean; message?: string }> {
    return Promise.resolve({
      healthy: true,
      message: 'Baileys engine is available (pure WebSocket, no Chromium)',
    });
  }
}

export default BaileysPlugin;
