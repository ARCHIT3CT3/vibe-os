/**
 * Example Plugin - Hello World
 * Demonstrates the standard plugin structure for contributors
 */

import type {
  Plugin,
  PluginManifest,
  PluginHealth,
  PluginPermission,
} from '../types/plugin.js';
import type { CommandPayload, ExecutionResult, Hook, HookContext } from '../types/index.js';

const MANIFEST: PluginManifest = {
  name: 'hello',
  version: '1.0.0',
  description: 'A simple greeting plugin demonstrating the plugin architecture',
  author: 'ARCHIT3CT3',
  license: 'MIT',
  permissions: ['fs.read'] as PluginPermission[],
  actions: ['hello.greet', 'hello.bye'],
  hooks: ['post-execute'],
};

export class HelloPlugin implements Plugin {
  readonly name = 'hello';
  readonly manifest = MANIFEST;
  readonly #greeting: string;

  constructor(greeting: string = 'Hello') {
    this.#greeting = greeting;
  }

  async execute(payload: CommandPayload): Promise<ExecutionResult> {
    const startTime = Date.now();
    const logs: string[] = [];

    try {
      switch (payload.action) {
        case 'hello.greet': {
          const name = (payload.params.name as string) ?? 'World';
          const message = `${this.#greeting}, ${name}!`;
          logs.push(`[HELLO] Generated greeting for: ${name}`);

          return {
            status: 'success',
            data: { message, greeting: this.#greeting, name },
            logs,
            executionTime: Date.now() - startTime,
          };
        }

        case 'hello.bye': {
          const name = (payload.params.name as string) ?? 'Friend';
          const message = `Goodbye, ${name}! See you soon.`;
          logs.push(`[HELLO] Generated farewell for: ${name}`);

          return {
            status: 'success',
            data: { message, name },
            logs,
            executionTime: Date.now() - startTime,
          };
        }

        default:
          return {
            status: 'error',
            error: `Unknown action: ${payload.action}`,
            logs: [...logs, `[HELLO] Unknown action requested: ${payload.action}`],
          };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        status: 'error',
        error: errorMsg,
        logs: [...logs, `[HELLO] Error: ${errorMsg}`],
      };
    }
  }

  getHooks(): readonly Hook[] {
    return [
      {
        name: 'hello-logger',
        phase: 'post-execute',
        priority: 10,
        execute: (context: HookContext) => {
          if (context.payload.action.startsWith('hello.')) {
            console.error(`[HELLO HOOK] Action ${context.payload.action} completed`);
          }
          return context;
        },
      },
    ];
  }

  healthCheck(): PluginHealth {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (this.#greeting.length === 0) {
      errors.push('Greeting cannot be empty');
    }

    if (this.#greeting.length > 100) {
      warnings.push('Greeting is unusually long');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}

export default HelloPlugin;

export function createPlugin(): HelloPlugin {
  return new HelloPlugin();
}
