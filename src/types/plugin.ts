/**
 * Plugin Interface - Standard for all modules
 * Plug-and-Play architecture for third-party contributors
 */

import type { CommandPayload, ExecutionResult, Hook } from './index.js';

export type PluginPermission =
  | 'fs.read'
  | 'fs.write'
  | 'fs.delete'
  | 'sh.exec'
  | 'net.request'
  | 'env.read'
  | 'env.write'
  | 'process.spawn';

export interface PluginManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author: string;
  readonly license: string;
  readonly permissions: readonly PluginPermission[];
  readonly actions: readonly string[];
  readonly hooks?: readonly string[];
}

export interface PluginHealth {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export interface Plugin {
  readonly name: string;
  readonly manifest: PluginManifest;
  execute(payload: CommandPayload): Promise<ExecutionResult>;
  getHooks?(): readonly Hook[];
  healthCheck?(): Promise<PluginHealth> | PluginHealth;
}

export interface LoadedPlugin {
  readonly manifest: PluginManifest;
  readonly instance: Plugin;
  readonly loadedAt: Date;
  readonly health: PluginHealth;
}

export interface PluginLoaderConfig {
  readonly modulesPath: string;
  readonly autoLoad: boolean;
  readonly strictHealthCheck: boolean;
  readonly allowedPermissions: readonly PluginPermission[];
}
