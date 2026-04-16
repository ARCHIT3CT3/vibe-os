/**
 * Dynamic Plugin Loader
 * Scans src/modules/ and auto-loads all plugins at startup
 */

import { readdir } from 'fs/promises';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import type {
  Plugin,
  LoadedPlugin,
  PluginHealth,
  PluginLoaderConfig,
} from '../types/plugin.js';

interface LoadResult {
  readonly success: boolean;
  readonly plugin?: LoadedPlugin;
  readonly error?: string;
}

export class PluginLoader {
  readonly #config: PluginLoaderConfig;
  readonly #loadedPlugins: Map<string, LoadedPlugin> = new Map();

  constructor(config: Partial<PluginLoaderConfig> = {}) {
    this.#config = {
      modulesPath: resolve(process.cwd(), 'src/modules'),
      autoLoad: true,
      strictHealthCheck: true,
      allowedPermissions: ['fs.read', 'fs.write', 'sh.exec'],
      ...config,
    };
  }

  async loadAll(): Promise<readonly LoadedPlugin[]> {
    if (!this.#config.autoLoad) {
      return [];
    }

    const results: LoadedPlugin[] = [];
    const files = await this.#scanModulesDirectory();

    for (const file of files) {
      const result = await this.#loadPluginFile(file);
      if (result.success && result.plugin) {
        this.#loadedPlugins.set(result.plugin.manifest.name, result.plugin);
        results.push(result.plugin);
      } else if (result.error) {
        console.error(`[PLUGIN LOADER] Failed to load ${file}: ${result.error}`);
      }
    }

    console.error(`[PLUGIN LOADER] Loaded ${results.length} plugin(s)`);
    return results;
  }

  async #scanModulesDirectory(): Promise<readonly string[]> {
    try {
      const entries = await readdir(this.#config.modulesPath, { withFileTypes: true });
      const files: string[] = [];

      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
          files.push(resolve(this.#config.modulesPath, entry.name));
        }
      }

      return files;
    } catch (error) {
      console.error(`[PLUGIN LOADER] Cannot scan modules directory: ${error}`);
      return [];
    }
  }

  async #loadPluginFile(filePath: string): Promise<LoadResult> {
    try {
      const fileUrl = pathToFileURL(filePath).href;
      const module = await import(fileUrl);

      const PluginClass = module.default ?? module[Object.keys(module)[0]!];

      if (!PluginClass || typeof PluginClass !== 'function') {
        return { success: false, error: 'No valid plugin export found' };
      }

      const instance = new PluginClass() as Plugin;

      if (!this.#isValidPlugin(instance)) {
        return { success: false, error: 'Instance does not implement Plugin interface' };
      }

      const manifest = instance.manifest;
      if (this.#loadedPlugins.has(manifest.name)) {
        return { success: false, error: `Plugin "${manifest.name}" already loaded` };
      }

      const health = await this.#runHealthCheck(instance);
      if (!health.valid && this.#config.strictHealthCheck) {
        return {
          success: false,
          error: `Health check failed: ${health.errors.join(', ')}`,
        };
      }

      const permissionCheck = this.#validatePermissions(manifest.permissions);
      if (!permissionCheck.valid) {
        return {
          success: false,
          error: `Permission denied: ${permissionCheck.denied.join(', ')}`,
        };
      }

      const loaded: LoadedPlugin = {
        manifest,
        instance,
        loadedAt: new Date(),
        health,
      };

      return { success: true, plugin: loaded };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Import error: ${msg}` };
    }
  }

  #isValidPlugin(instance: unknown): instance is Plugin {
    if (typeof instance !== 'object' || instance === null) return false;

    const p = instance as Record<string, unknown>;

    if (!p.manifest || typeof p.manifest !== 'object') return false;
    const m = p.manifest as Record<string, unknown>;

    if (typeof m.name !== 'string') return false;
    if (typeof m.version !== 'string') return false;
    if (!Array.isArray(m.permissions)) return false;
    if (!Array.isArray(m.actions)) return false;

    if (typeof p.execute !== 'function') return false;

    return true;
  }

  async #runHealthCheck(instance: Plugin): Promise<PluginHealth> {
    if (instance.healthCheck) {
      return await instance.healthCheck();
    }

    return { valid: true, errors: [], warnings: [] };
  }

  #validatePermissions(
    requested: readonly string[]
  ): { valid: boolean; denied: readonly string[] } {
    const denied: string[] = [];

    for (const perm of requested) {
      if (!this.#config.allowedPermissions.includes(perm as never)) {
        denied.push(perm);
      }
    }

    return { valid: denied.length === 0, denied };
  }

  getPlugin(name: string): LoadedPlugin | undefined {
    return this.#loadedPlugins.get(name);
  }

  listPlugins(): readonly LoadedPlugin[] {
    return Array.from(this.#loadedPlugins.values());
  }

  async unloadPlugin(name: string): Promise<boolean> {
    return this.#loadedPlugins.delete(name);
  }

  getPluginActions(): readonly string[] {
    const actions: string[] = [];
    for (const loaded of this.#loadedPlugins.values()) {
      actions.push(...loaded.manifest.actions);
    }
    return actions;
  }
}

export function createPluginLoader(config?: Partial<PluginLoaderConfig>): PluginLoader {
  return new PluginLoader(config);
}
