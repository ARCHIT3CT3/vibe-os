/**
 * System Info Plugin - Resource monitoring for VibeOS
 *
 * Displays CPU and RAM usage statistics in real-time.
 *
 * ## Usage
 * ```bash
 * VibeOS > status
 * [SYSTEM] RAM: 8.2GB / 16.0GB (51%)
 * [SYSTEM] CPU: Intel(R) Core(TM) i7-9700K
 * [SYSTEM] Load: 1.2% (1m), 1.5% (5m), 1.3% (15m)
 * ```
 */

import { totalmem, freemem, cpus, loadavg, platform, release } from 'os';
import type {
  Plugin,
  PluginManifest,
  PluginHealth,
} from '../types/plugin.js';
import type { CommandPayload, ExecutionResult } from '../types/index.js';

/** Plugin manifest */
const MANIFEST: PluginManifest = {
  name: 'system-info',
  version: '1.0.0',
  description: 'System resource monitoring (RAM, CPU, load)',
  author: 'ARCHIT3CT3',
  license: 'MIT',
  permissions: [], // os module is built-in, no special permissions needed
  actions: ['status', 'sys', 'system'],
};

/** Format bytes to GB with 1 decimal */
function formatGB(bytes: number): string {
  return (bytes / 1024 / 1024 / 1024).toFixed(1);
}

/** Calculate percentage */
function percentage(used: number, total: number): number {
  return Math.round((used / total) * 100);
}

/**
 * SystemInfoPlugin - Monitor system resources
 *
 * Actions:
 * - status, sys, system: Display full system stats
 */
export class SystemInfoPlugin implements Plugin {
  readonly name = 'system-info';
  readonly manifest = MANIFEST;

  /**
   * Execute system monitoring commands
   * @param payload - Command with action (status|sys|system)
   * @returns Execution result with formatted system stats
   */
  async execute(payload: CommandPayload): Promise<ExecutionResult> {
    const startTime = Date.now();
    const logs: string[] = [];

    try {
      const action = payload.action;
      if (action === 'status' || action === 'sys' || action === 'system') {
        return this.#getSystemStats(startTime, logs);
      }

      return {
        status: 'error',
        error: `Unknown action: ${action}`,
        logs: [...logs, `[SYSTEM] Unknown action: ${action}`],
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        status: 'error',
        error: errorMsg,
        logs: [...logs, `[SYSTEM] Error: ${errorMsg}`],
      };
    }
  }

  /**
   * Gather and format system statistics
   */
  #getSystemStats(startTime: number, logs: string[]): ExecutionResult {
    // RAM stats
    const totalRAM = totalmem();
    const freeRAM = freemem();
    const usedRAM = totalRAM - freeRAM;
    const ramPercent = percentage(usedRAM, totalRAM);

    // CPU info
    const cpuInfo = cpus();
    const cpuModel = cpuInfo[0]?.model ?? 'Unknown';
    const cpuCount = cpuInfo.length;

    // Load average
    const loads = loadavg();

    // Platform
    const osPlatform = platform();
    const osRelease = release();

    // Format output
    const ramStr = `${formatGB(usedRAM)}GB / ${formatGB(totalRAM)}GB (${ramPercent}%)`;
    const loadStr = `Load: ${loads.map(l => l.toFixed(2)).join(', ')} (1m, 5m, 15m)`;

    logs.push(`[SYSTEM] RAM: ${ramStr}`);
    logs.push(`[SYSTEM] CPU: ${cpuModel} (${cpuCount} cores)`);
    logs.push(`[SYSTEM] ${loadStr}`);
    logs.push(`[SYSTEM] Platform: ${osPlatform} ${osRelease}`);

    return {
      status: 'success',
      data: {
        ram: {
          totalGB: parseFloat(formatGB(totalRAM)),
          usedGB: parseFloat(formatGB(usedRAM)),
          freeGB: parseFloat(formatGB(freeRAM)),
          percentUsed: ramPercent,
        },
        cpu: {
          model: cpuModel,
          cores: cpuCount,
        },
        load: loads,
        platform: osPlatform,
        release: osRelease,
      },
      logs,
      executionTime: Date.now() - startTime,
    };
  }

  /**
   * Health check - verify system info access
   */
  healthCheck(): PluginHealth {
    try {
      // Test basic os functions
      totalmem();
      cpus();
      loadavg();

      return {
        valid: true,
        errors: [],
        warnings: [],
      };
    } catch (error) {
      return {
        valid: false,
        errors: ['Failed to access system information'],
        warnings: [],
      };
    }
  }
}

/** Default export for auto-discovery */
export default SystemInfoPlugin;

/** Factory function */
export function createPlugin(): SystemInfoPlugin {
  return new SystemInfoPlugin();
}
