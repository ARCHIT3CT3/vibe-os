/**
 * CLI Entry Point
 * Accepts JSON via stdin, outputs structured JSON to stdout
 */

import { createInterface } from 'readline';
import { CommandDispatcher } from '../core/dispatcher.js';
import { SandboxedExecutor } from '../lib/executor.js';
import { Shield } from '../security/shield.js';
import type { CommandPayload, ExecutionResult, Hook } from '../types/index.js';

interface CLIConfig {
  debug: boolean;
  prettyPrint: boolean;
}

class TerminalAPI {
  readonly #dispatcher: CommandDispatcher;
  readonly #config: CLIConfig;

  constructor(config: Partial<CLIConfig> = {}) {
    this.#config = {
      debug: false,
      prettyPrint: false,
      ...config,
    };

    this.#dispatcher = new CommandDispatcher({
      maxQueueSize: 50,
      defaultTimeout: 5000,
    });
  }

  async init(): Promise<void> {
    await this.#initializeModules();
  }

  async #initializeModules(): Promise<void> {
    const executor = new SandboxedExecutor();
    const shield = new Shield();

    this.#dispatcher
      .registerHandler('sh.exec', executor)
      .registerHandler('shell.exec', executor)
      .registerHook(shield)
      .registerHook(this.#createAuditHook());

    const plugins = await this.#dispatcher.initialize();
    for (const plugin of plugins) {
      const shieldCheck = shield.verifyPlugin(plugin.instance);
      if (!shieldCheck.valid) {
        console.error(`[SHIELD] Plugin ${plugin.manifest.name} failed verification: ${shieldCheck.errors.join(', ')}`);
        continue;
      }
      console.error(`[PLUGIN] Loaded: ${plugin.manifest.name} v${plugin.manifest.version}`);
    }
  }

  #createAuditHook(): Hook {
    return {
      name: 'audit-logger',
      phase: 'post-execute',
      priority: 999,
      execute: (context) => {
        const result = context.result;
        if (this.#config.debug && result) {
          const timestamp = new Date().toISOString();
          console.error(`[AUDIT ${timestamp}] ${context.payload.action}: ${result.status}`);
        }
        return context;
      },
    };
  }

  async run(): Promise<void> {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    const lines: string[] = [];

    rl.on('line', (line) => {
      lines.push(line);
    });

    await new Promise<void>((resolve) => {
      rl.on('close', () => resolve());
    });

    const input = lines.join('\n');

    if (!input.trim()) {
      this.#outputResult({
        status: 'error',
        error: 'Empty input received',
        logs: [],
      });
      return;
    }

    try {
      const payload = this.#parseInput(input);
      const result = await this.#dispatcher.dispatch(payload);
      this.#outputResult(result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.#outputResult({
        status: 'error',
        error: `Failed to process input: ${errorMsg}`,
        logs: [],
      });
    }
  }

  #parseInput(input: string): CommandPayload {
    const trimmed = input.trim();

    if (trimmed === '--help' || trimmed === '-h') {
      this.#printHelp();
      process.exit(0);
    }

    if (trimmed === '--version' || trimmed === '-v') {
      console.log('0.1.0');
      process.exit(0);
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;

      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('Input must be a JSON object');
      }

      const obj = parsed as Record<string, unknown>;

      if (typeof obj.action !== 'string' || !obj.action) {
        throw new Error('Missing or invalid "action" field');
      }

      return {
        action: obj.action,
        params: (obj.params as Record<string, unknown>) ?? {},
      };
    } catch (e) {
      if (e instanceof SyntaxError) {
        throw new Error(`Invalid JSON: ${e.message}`);
      }
      throw e;
    }
  }

  #outputResult(result: ExecutionResult): void {
    const output = this.#config.prettyPrint
      ? JSON.stringify(result, null, 2)
      : JSON.stringify(result);
    console.log(output);
  }

  #printHelp(): void {
    console.log(`
ARCHIT3CT3 Terminal API

Usage:
  echo '{"action":"sh.exec","params":{"command":"ls"}}' | node terminal.js

Input Format:
  {
    "action": "sh.exec",
    "params": {
      "command": "ls",
      "args": ["-la"],
      "cwd": "./subdir"
    }
  }

Output Format:
  {
    "status": "success|error|blocked|timeout",
    "data": { ... },
    "logs": ["..."],
    "executionTime": 123
  }

Options:
  -h, --help     Show this help
  -v, --version  Show version
`);
  }

  getDispatcher(): CommandDispatcher {
    return this.#dispatcher;
  }
}

async function main(): Promise<void> {
  const debug = process.argv.includes('--debug') || process.env.DEBUG === '1';
  const pretty = process.argv.includes('--pretty');

  const terminal = new TerminalAPI({ debug, prettyPrint: pretty });
  await terminal.init();
  await terminal.run();
}

main().catch((err) => {
  console.error(JSON.stringify({
    status: 'error',
    error: err instanceof Error ? err.message : String(err),
    logs: [],
  }));
  process.exit(1);
});

export { TerminalAPI };
