/**
 * CommandDispatcher - Central command queue manager with extensible hook system
 *
 * This is the core orchestrator of VibeOS. It manages:
 * - Command queuing and sequential execution
 * - Plugin registration and lifecycle
 * - Hook-based extensibility (pre/post execution interception)
 *
 * ## Architecture
 * Commands flow through 4 hook phases:
 * 1. pre-shield: Initial validation
 * 2. post-shield: Security decision enforcement
 * 3. pre-execute: Final preparation
 * 4. post-execute: Logging/auditing
 *
 * ## Contributing
 * To add custom behavior, implement the {@link Hook} interface and register
 * via {@link registerHook}. To add new capabilities, create a {@link Plugin}.
 *
 * @example
 * ```typescript
 * const dispatcher = new CommandDispatcher({ maxQueueSize: 50 });
 * await dispatcher.initialize();
 * const result = await dispatcher.dispatch({ action: 'ping', params: {} });
 * ```
 */

import type {
  CommandPayload,
  ExecutionResult,
  ModuleHandler,
  Hook,
  HookPhase,
  HookContext,
  DispatcherConfig,
  LoadedPlugin,
} from '../types/index.js';
import { PluginLoader } from './plugin-loader.js';

/** Internal queued command structure */
interface QueuedCommand {
  readonly id: string;
  readonly payload: CommandPayload;
  readonly resolve: (result: ExecutionResult) => void;
  readonly reject: (error: Error) => void;
  readonly timestamp: number;
}

/** Central command orchestrator with plugin and hook support */
export class CommandDispatcher {
  readonly #handlers: Map<string, ModuleHandler> = new Map();
  readonly #hooks: Map<HookPhase, Hook[]> = new Map();
  readonly #queue: QueuedCommand[] = [];
  readonly #config: DispatcherConfig;
  readonly #pluginLoader: PluginLoader;
  #processing = false;
  #commandCounter = 0;

  constructor(config: Partial<DispatcherConfig> = {}) {
    this.#config = {
      maxQueueSize: 100,
      defaultTimeout: 5000,
      sandboxPath: './sandbox',
      ...config,
    };

    for (const phase of ['pre-shield', 'post-shield', 'pre-execute', 'post-execute'] as HookPhase[]) {
      this.#hooks.set(phase, []);
    }

    this.#pluginLoader = new PluginLoader({
      modulesPath: './src/modules',
      autoLoad: true,
      strictHealthCheck: true,
    });
  }

  /**
   * Initialize the dispatcher by loading all plugins from the modules directory.
   * Must be called before dispatching commands.
   * @returns Array of loaded plugins
   */
  async initialize(): Promise<readonly LoadedPlugin[]> {
    const plugins = await this.#pluginLoader.loadAll();

    for (const plugin of plugins) {
      for (const action of plugin.manifest.actions) {
        this.registerHandler(action, plugin.instance);
      }

      const hooks = plugin.instance.getHooks?.() ?? [];
      for (const hook of hooks) {
        this.registerHook(hook);
      }
    }

    return plugins;
  }

  getPluginLoader(): PluginLoader {
    return this.#pluginLoader;
  }

  /**
   * Register a handler for a specific action type.
   * @param action - The action identifier (e.g., 'sh.exec', 'ping')
   * @param handler - The module handler that will execute this action
   * @returns this (for chaining)
   */
  registerHandler(action: string, handler: ModuleHandler): this {
    this.#handlers.set(action, handler);
    return this;
  }

  unregisterHandler(action: string): boolean {
    return this.#handlers.delete(action);
  }

  /**
   * Register a hook to intercept commands at a specific phase.
   * Hooks are executed in priority order (lower number = earlier).
   * @param hook - The hook to register
   * @returns this (for chaining)
   * @see HookPhase for available interception points
   */
  registerHook(hook: Hook): this {
    const phaseHooks = this.#hooks.get(hook.phase) ?? [];
    phaseHooks.push(hook);
    phaseHooks.sort((a, b) => a.priority - b.priority);
    this.#hooks.set(hook.phase, phaseHooks);
    return this;
  }

  unregisterHook(hookName: string, phase: HookPhase): boolean {
    const phaseHooks = this.#hooks.get(phase) ?? [];
    const index = phaseHooks.findIndex((h) => h.name === hookName);
    if (index >= 0) {
      phaseHooks.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Dispatch a command for execution.
   * The command is queued and processed sequentially through all hook phases.
   * @param payload - The command payload with action and params
   * @returns Execution result with status, data, and logs
   */
  async dispatch(payload: CommandPayload): Promise<ExecutionResult> {
    if (this.#queue.length >= this.#config.maxQueueSize) {
      return this.#createErrorResult('Queue overflow - max capacity reached');
    }

    const id = this.#generateCommandId();

    return new Promise((resolve, reject) => {
      const command: QueuedCommand = {
        id,
        payload,
        resolve,
        reject,
        timestamp: Date.now(),
      };

      this.#queue.push(command);
      this.#processQueue();
    });
  }

  async #processQueue(): Promise<void> {
    if (this.#processing || this.#queue.length === 0) return;

    this.#processing = true;

    while (this.#queue.length > 0) {
      const command = this.#queue.shift()!;
      const result = await this.#executeCommand(command);
      command.resolve(result);
    }

    this.#processing = false;
  }

  async #executeCommand(command: QueuedCommand): Promise<ExecutionResult> {
    const startTime = Date.now();
    let context: HookContext = {
      payload: command.payload,
      metadata: { commandId: command.id, startTime },
    };

    try {
      context = await this.#runHooks('pre-shield', context);

      const handler = this.#handlers.get(command.payload.action);
      if (!handler) {
        return this.#createErrorResult(
          `No handler registered for action: ${command.payload.action}`
        );
      }

      context = await this.#runHooks('post-shield', context);

      if (context.decision?.allowed === false) {
        return {
          status: 'blocked',
          error: context.decision.reason ?? 'Blocked by security policy',
          logs: [],
          executionTime: Date.now() - startTime,
        };
      }

      context = await this.#runHooks('pre-execute', context);

      const result = await handler.execute(command.payload);

      context = { ...context, result };
      context = await this.#runHooks('post-execute', context);

      return {
        ...result,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return this.#createErrorResult(errorMessage);
    }
  }

  async #runHooks(phase: HookPhase, context: HookContext): Promise<HookContext> {
    const hooks = this.#hooks.get(phase) ?? [];
    let currentContext = context;

    for (const hook of hooks) {
      currentContext = await hook.execute(currentContext);
    }

    return currentContext;
  }

  #generateCommandId(): string {
    return `cmd-${++this.#commandCounter}-${Date.now()}`;
  }

  #createErrorResult(error: string): ExecutionResult {
    return {
      status: 'error',
      error,
      logs: [],
    };
  }

  getQueueStats(): { size: number; processing: boolean; config: DispatcherConfig } {
    return {
      size: this.#queue.length,
      processing: this.#processing,
      config: { ...this.#config },
    };
  }

  listHandlers(): string[] {
    return Array.from(this.#handlers.keys());
  }

  listHooks(phase?: HookPhase): Hook[] | Map<HookPhase, Hook[]> {
    if (phase) {
      return [...(this.#hooks.get(phase) ?? [])];
    }
    return new Map(this.#hooks);
  }
}

export function createDispatcher(config?: Partial<DispatcherConfig>): CommandDispatcher {
  return new CommandDispatcher(config);
}
