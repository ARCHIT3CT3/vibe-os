/**
 * Sandboxed Shell Executor
 * Uses child_process.spawn with 5s timeout and restricted working directory
 */

import { spawn, type SpawnOptions } from 'child_process';
import { resolve, normalize, isAbsolute } from 'path';
import type { CommandPayload, ExecutionResult, ModuleHandler } from '../types/index.js';

interface ExecutorConfig {
  sandboxPath: string;
  timeoutMs: number;
  maxBufferSize: number;
  allowedCommands: string[];
  shell: string;
}

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export class SandboxedExecutor implements ModuleHandler {
  readonly name = 'shell-executor';
  readonly #config: ExecutorConfig;

  constructor(config: Partial<ExecutorConfig> = {}) {
    this.#config = {
      sandboxPath: resolve(process.cwd(), 'sandbox'),
      timeoutMs: 5000,
      maxBufferSize: 1024 * 1024,
      allowedCommands: ['cat', 'echo', 'ls', 'pwd', 'head', 'tail', 'grep', 'wc'],
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
      ...config,
    };
  }

  async execute(payload: CommandPayload): Promise<ExecutionResult> {
    const { command, args = [], cwd } = payload.params as {
      command: string;
      args?: string[];
      cwd?: string;
    };

    if (!command || typeof command !== 'string') {
      return this.#createErrorResult('Missing or invalid command parameter');
    }

    const baseCmd = command.split(' ')[0] ?? '';
    if (!this.#config.allowedCommands.includes(baseCmd)) {
      return this.#createErrorResult(`Command "${baseCmd}" not in allowed list`);
    }

    const workingDir = this.#resolveWorkingDirectory(cwd);
    if (!this.#isWithinSandbox(workingDir)) {
      return this.#createErrorResult(`Working directory "${workingDir}" escapes sandbox`);
    }

    const logs: string[] = [];
    const startTime = Date.now();

    try {
      const result = await this.#spawnWithTimeout(command, args, {
        cwd: workingDir,
        timeout: this.#config.timeoutMs,
      });

      logs.push(`[EXEC] ${command} ${args.join(' ')}`);
      logs.push(`[CWD] ${workingDir}`);
      logs.push(`[EXIT] code=${result.exitCode}, signal=${result.signal}`);

      if (result.stderr) {
        logs.push(`[STDERR] ${result.stderr.slice(0, 500)}`);
      }

      const executionTime = Date.now() - startTime;

      if (result.exitCode !== 0) {
        return {
          status: 'error',
          error: `Process exited with code ${result.exitCode}`,
          data: { stderr: result.stderr, stdout: result.stdout },
          logs,
          executionTime,
        };
      }

      return {
        status: 'success',
        data: { stdout: result.stdout, stderr: result.stderr },
        logs,
        executionTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return this.#createErrorResult(errorMsg, logs);
    }
  }

  #spawnWithTimeout(
    command: string,
    args: string[],
    options: { cwd: string; timeout: number }
  ): Promise<SpawnResult> {
    return new Promise((resolve, reject) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      const spawnOptions: SpawnOptions = {
        cwd: options.cwd,
        shell: this.#config.shell,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      };

      const child = spawn(command, args, spawnOptions);
      const timeoutId = setTimeout(() => {
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 1000);
        reject(new Error(`Execution timeout after ${options.timeout}ms`));
      }, options.timeout);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk);
        const currentSize = stdoutChunks.reduce((sum, c) => sum + c.length, 0);
        if (currentSize > this.#config.maxBufferSize) {
          child.kill('SIGTERM');
          reject(new Error('Output buffer exceeded maximum size'));
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });

      child.on('error', (err) => {
        clearTimeout(timeoutId);
        reject(err);
      });

      child.on('close', (code, signal) => {
        clearTimeout(timeoutId);
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
          exitCode: code,
          signal,
        });
      });
    });
  }

  #resolveWorkingDirectory(cwd?: string): string {
    if (!cwd) return this.#config.sandboxPath;
    if (isAbsolute(cwd)) {
      return this.#config.sandboxPath;
    }
    return resolve(this.#config.sandboxPath, cwd);
  }

  #isWithinSandbox(path: string): boolean {
    const normalizedPath = normalize(path);
    const normalizedSandbox = normalize(this.#config.sandboxPath);
    return normalizedPath.startsWith(normalizedSandbox);
  }

  #createErrorResult(error: string, logs: string[] = []): ExecutionResult {
    return {
      status: 'error',
      error,
      logs,
    };
  }

  getConfig(): Readonly<ExecutorConfig> {
    return { ...this.#config };
  }

  extendAllowedCommands(commands: string[]): this {
    this.#config.allowedCommands.push(...commands);
    return this;
  }
}

export function createExecutor(config?: Partial<ExecutorConfig>): SandboxedExecutor {
  return new SandboxedExecutor(config);
}
