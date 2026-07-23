import { Injectable, NotFoundException } from '@nestjs/common';
import { PluginLoaderService, PluginStatus, PluginType } from '../../core/plugins';
import { PluginDto } from './dto/plugin.dto';
import { EngineFactory } from '../../engine/engine.factory';

@Injectable()
export class PluginsService {
  constructor(
    private readonly pluginLoader: PluginLoaderService,
    private readonly engineFactory: EngineFactory,
  ) {}

  findAll(): PluginDto[] {
    const plugins = this.pluginLoader.getAllPlugins();
    const currentEngine = this.engineFactory.getCurrentEngine();

    return plugins.map(plugin => ({
      id: plugin.manifest.id,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      type: plugin.manifest.type,
      description: plugin.manifest.description,
      author: plugin.manifest.author,
      status: plugin.status,
      config: plugin.config,
      builtIn: plugin.manifest.id === 'whatsapp-web.js' || plugin.manifest.id === 'baileys',
      isActive: plugin.manifest.type === PluginType.ENGINE && plugin.manifest.id === currentEngine,
      provides: plugin.manifest.provides ?? [],
      configSchema: plugin.manifest.configSchema,
      loadedAt: plugin.loadedAt?.toISOString(),
      enabledAt: plugin.enabledAt?.toISOString(),
      error: plugin.error,
    }));
  }

  findOne(id: string): PluginDto {
    const plugin = this.pluginLoader.getPlugin(id);

    if (!plugin) {
      throw new NotFoundException(`Plugin ${id} not found`);
    }

    const currentEngine = this.engineFactory.getCurrentEngine();

    return {
      id: plugin.manifest.id,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      type: plugin.manifest.type,
      description: plugin.manifest.description,
      author: plugin.manifest.author,
      status: plugin.status,
      config: plugin.config,
      builtIn: plugin.manifest.id === 'whatsapp-web.js' || plugin.manifest.id === 'baileys',
      isActive: plugin.manifest.type === PluginType.ENGINE && plugin.manifest.id === currentEngine,
      provides: plugin.manifest.provides ?? [],
      configSchema: plugin.manifest.configSchema,
      loadedAt: plugin.loadedAt?.toISOString(),
      enabledAt: plugin.enabledAt?.toISOString(),
      error: plugin.error,
    };
  }

  async enable(id: string): Promise<{ success: boolean; message: string }> {
    const plugin = this.pluginLoader.getPlugin(id);

    if (!plugin) {
      throw new NotFoundException(`Plugin ${id} not found`);
    }

    // Engine mutex: when enabling an engine, disable all other engines
    if (plugin.manifest.type === PluginType.ENGINE) {
      const otherEngines = this.pluginLoader.getPluginsByType(PluginType.ENGINE).filter(p => p.manifest.id !== id);

      for (const other of otherEngines) {
        if (other.status === PluginStatus.ENABLED) {
          try {
            await this.pluginLoader.disablePlugin(other.manifest.id);
          } catch {
            // Best-effort disable — don't block the primary enable
          }
        }
      }

      // Update the in-memory default engine for new sessions
      this.engineFactory.setDefaultEngine(id);
    }

    if (plugin.status === PluginStatus.ENABLED) {
      return { success: true, message: `Plugin ${id} is already enabled` };
    }

    try {
      await this.pluginLoader.enablePlugin(id);
      return { success: true, message: `Plugin ${id} enabled successfully` };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async disable(id: string): Promise<{ success: boolean; message: string }> {
    const plugin = this.pluginLoader.getPlugin(id);

    if (!plugin) {
      throw new NotFoundException(`Plugin ${id} not found`);
    }

    if (plugin.status !== PluginStatus.ENABLED) {
      return { success: true, message: `Plugin ${id} is not enabled` };
    }

    try {
      await this.pluginLoader.disablePlugin(id);
      return { success: true, message: `Plugin ${id} disabled successfully` };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  updateConfig(id: string, config: Record<string, unknown>): { success: boolean; message: string } {
    const plugin = this.pluginLoader.getPlugin(id);

    if (!plugin) {
      throw new NotFoundException(`Plugin ${id} not found`);
    }

    try {
      this.pluginLoader.updatePluginConfig(id, config);
      return { success: true, message: `Plugin ${id} configuration updated` };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async healthCheck(id: string): Promise<{ healthy: boolean; message?: string }> {
    const plugin = this.pluginLoader.getPlugin(id);

    if (!plugin) {
      throw new NotFoundException(`Plugin ${id} not found`);
    }

    if (!plugin.instance?.healthCheck) {
      return { healthy: true, message: 'Plugin does not implement health check' };
    }

    try {
      return await plugin.instance.healthCheck();
    } catch (error) {
      return {
        healthy: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
