/**
 * Ping Example Plugin - Minimal reference implementation for contributors
 *
 * This plugin demonstrates the essential structure required for all VibeOS plugins.
 * Use this as a template when creating new extensions.
 *
 * ## Minimal Requirements
 * 1. Implement the {@link Plugin} interface
 * 2. Export a manifest with name, version, permissions, and actions
 * 3. Implement the execute() method to handle your actions
 *
 * ## Testing Your Plugin
 * ```bash
 * echo '{"action":"ping","params":{"message":"hello"}}' | npm start
 * ```
 */

import type {
  Plugin,
  PluginManifest,
  PluginHealth,
} from '../types/plugin.js';
import type { CommandPayload, ExecutionResult } from '../types/index.js';

/** Plugin manifest defining metadata and capabilities */
const MANIFEST: PluginManifest = {
  name: 'ping',
  version: '1.0.0',
  description: 'Minimal example plugin responding to ping commands',
  author: 'Contributor',
  license: 'MIT',
  permissions: [], // No special permissions needed
  actions: ['ping'], // Single action this plugin handles
};

/**
 * PingPlugin - A minimal reference implementation
 *
 * @example
 * ```typescript
 * // Usage via CLI
 * echo '{"action":"ping","params":{"message":"hello"}}' | node dist/api/terminal.js
 *
 * // Response
 * { "status": "success", "data": { "message": "pong: hello" }, "logs": [...] }
 * ```
 */
export class PingPlugin implements Plugin {
  readonly name = 'ping';
  readonly manifest = MANIFEST;

  /**
   * Execute a command payload.
   * @param payload - The command with action and params
   * @returns Execution result with status and data
   */
  async execute(payload: CommandPayload): Promise<ExecutionResult> {
    const startTime = Date.now();
    const logs: string[] = [];

    try {
      switch (payload.action) {
        case 'ping': {
          // Extract optional message parameter
          const message = (payload.params.message as string) ?? 'ping';
          const response = `pong: ${message}`;

          logs.push(`[PING] Received: ${message}`);

          return {
            status: 'success',
            data: { message: response, timestamp: new Date().toISOString() },
            logs,
            executionTime: Date.now() - startTime,
          };
        }

        default:
          return {
            status: 'error',
            error: `Unknown action: ${payload.action}`,
            logs: [...logs, `[PING] Unknown action: ${payload.action}`],
          };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        status: 'error',
        error: errorMsg,
        logs: [...logs, `[PING] Error: ${errorMsg}`],
      };
    }
  }

  /**
   * Health check - verify the plugin is functioning correctly.
   * @returns Plugin health status
   */
  healthCheck(): PluginHealth {
    return {
      valid: true,
      errors: [],
      warnings: [],
    };
  }
}

/** Default export for auto-discovery */
export default PingPlugin;

/** Factory function for programmatic instantiation */
export function createPlugin(): PingPlugin {
  return new PingPlugin();
}
