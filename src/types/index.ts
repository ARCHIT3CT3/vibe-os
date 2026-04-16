/**
 * Core type definitions for ARCHIT3CT3 infrastructure
 */

export type ActionType = string;

export interface CommandPayload {
  action: ActionType;
  params: Record<string, unknown>;
}

export interface ExecutionResult<T = unknown> {
  status: 'success' | 'error' | 'blocked' | 'timeout';
  data?: T;
  error?: string;
  logs: string[];
  executionTime?: number;
}

export interface ShieldDecision {
  allowed: boolean;
  reason?: string;
  severity?: 'low' | 'medium' | 'high';
}

export interface HookContext {
  payload: CommandPayload;
  decision?: ShieldDecision;
  result?: ExecutionResult;
  metadata: Record<string, unknown>;
}

export type HookPhase = 'pre-shield' | 'post-shield' | 'pre-execute' | 'post-execute';

export interface Hook {
  readonly name: string;
  readonly phase: HookPhase;
  readonly priority: number;
  execute(context: HookContext): HookContext | Promise<HookContext>;
}

export interface ModuleHandler {
  readonly name: string;
  execute(payload: CommandPayload): Promise<ExecutionResult>;
}

export interface DispatcherConfig {
  maxQueueSize: number;
  defaultTimeout: number;
  sandboxPath: string;
}

export * from './plugin.js';
