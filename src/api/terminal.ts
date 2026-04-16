/**
 * Interactive Terminal Interface
 * Real-time command loop with colored prompts
 */

import { createInterface } from 'readline/promises';
import type { CommandDispatcher } from '../core/dispatcher.js';
import type { CommandPayload } from '../types/index.js';

/** Colors for terminal output */
const COLOR = {
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  reset: '\x1b[0m',
};

/**
 * Interactive terminal for real-time VibeOS command input
 *
 * @example
 * ```typescript
 * const terminal = new TerminalInterface();
 * await terminal.start(dispatcher);
 * // VibeOS > ping
 * // { status: 'success', data: { message: 'pong: ping' } }
 * ```
 */
export class TerminalInterface {
  /**
   * Start the interactive command loop
   * @param dispatcher - The initialized CommandDispatcher
   */
  async start(dispatcher: CommandDispatcher): Promise<void> {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log(`${COLOR.gray}Type a command or 'exit' to quit${COLOR.reset}\n`);

    while (true) {
      const input = await rl.question(`${COLOR.yellow}VibeOS > ${COLOR.reset}`);
      const trimmed = input.trim();

      if (trimmed === 'exit') {
        console.log(`${COLOR.green}Shutting down VibeOS...${COLOR.reset}`);
        rl.close();
        process.exit(0);
      }

      if (!trimmed) {
        continue;
      }

      try {
        // Parse simple command or JSON
        const payload = this.#parseInput(trimmed);
        const result = await dispatcher.dispatch(payload);

        // Display result
        if (result.status === 'success') {
          console.log(`${COLOR.green}✓ ${JSON.stringify(result.data)}${COLOR.reset}`);
        } else if (result.status === 'blocked') {
          console.log(`${COLOR.red}✗ Blocked: ${result.error}${COLOR.reset}`);
        } else {
          console.log(`${COLOR.red}✗ Error: ${result.error}${COLOR.reset}`);
        }

        if (result.logs && result.logs.length > 0) {
          console.log(`${COLOR.gray}${result.logs.join('\n')}${COLOR.reset}`);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.log(`${COLOR.red}✗ Parse error: ${msg}${COLOR.reset}`);
      }
    }
  }

  /**
   * Parse user input into CommandPayload
   * Supports: simple commands like "ping" or JSON like {"action":"ping"}
   */
  #parseInput(input: string): CommandPayload {
    const trimmed = input.trim();

    // Try JSON parsing first
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        if (typeof parsed.action !== 'string') {
          throw new Error('JSON must have an "action" field');
        }
        return {
          action: parsed.action,
          params: (parsed.params as Record<string, unknown>) ?? {},
        };
      } catch (e) {
        if (e instanceof SyntaxError) {
          throw new Error(`Invalid JSON: ${e.message}`);
        }
        throw e;
      }
    }

    // Simple command format: "action" or "action param1 param2"
    const parts = trimmed.split(/\s+/);
    const action = parts[0]!;
    const params: Record<string, unknown> = {};

    // If there are additional args, treat them as message/command parameter
    if (parts.length > 1) {
      params.message = parts.slice(1).join(' ');
    }

    return { action, params };
  }
}
