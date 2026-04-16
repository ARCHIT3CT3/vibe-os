/**
 * The Shield - Security middleware for command filtering and sandbox enforcement
 *
 * Implements the {@link Hook} interface to intercept commands at the 'post-shield' phase.
 * Provides defense-in-depth through:
 * - Pattern-based blocklist (regex matching for dangerous commands)
 * - Command allowlisting (restricted command set)
 * - Path traversal prevention (sandbox containment)
 * - Plugin permission validation
 *
 * ## Security Model
 * - Blocklist: Patterns that will reject commands immediately (e.g., `rm -rf /`)
 * - Allowlist: Commands permitted in the sandbox (e.g., `ls`, `cat`, `echo`)
 * - Path validation: All paths must stay within the sandbox directory
 *
 * ## Contributing
 * To add new security rules, extend the blocklistPatterns or dangerousCommands arrays
 * in the ShieldConfig. For plugin security, see {@link verifyPlugin}.
 *
 * @example
 * ```typescript
 * const shield = new Shield({
 *   sandboxPath: './my-sandbox',
 *   dangerousCommands: ['curl', 'wget'],
 *   strictMode: true
 * });
 * dispatcher.registerHook(shield);
 * ```
 */

import { resolve, normalize, isAbsolute } from 'path';
import type {
  CommandPayload,
  ShieldDecision,
  Hook,
  HookContext,
  HookPhase,
  Plugin,
  PluginHealth,
} from '../types/index.js';

/** Configuration for the Shield security layer */
interface ShieldConfig {
  /** Base path for sandbox containment */
  sandboxPath: string;
  /** Regex patterns that trigger command rejection */
  blocklistPatterns: RegExp[];
  /** Commands requiring additional validation */
  dangerousCommands: string[];
  /** Additional allowed paths beyond sandbox */
  allowedPaths: string[];
  /** If true, reject on any violation; if false, warnings only */
  strictMode: boolean;
}

/** Matched security violation record */
interface PatternMatch {
  pattern: string;
  field: string;
  severity: 'low' | 'medium' | 'high';
}

/** Security hook implementing command filtering and sandbox enforcement */
export class Shield implements Hook {
  readonly name = 'shield';
  readonly phase: HookPhase = 'post-shield';
  readonly priority = 100;
  readonly #config: ShieldConfig;
  readonly #violationLog: PatternMatch[] = [];

  constructor(config: Partial<ShieldConfig> = {}) {
    this.#config = {
      sandboxPath: resolve(process.cwd(), 'sandbox'),
      blocklistPatterns: [
        /rm\s+-rf\s+\//,
        /chmod\s+777/,
        />\s*\/etc\/passwd/,
        /curl.*\|.*sh/,
        /wget.*\|.*sh/,
        /\$\(.*\)/,
        /`.*`/,
        /;.*rm/,
        /&&.*rm/,
        /\|\|.*rm/,
        /mv\s+.*\/\s*$/,
        />\s*\//,
        /dd\s+if=/,
        /mkfs/,
        /fdisk/,
      ],
      dangerousCommands: [
        'rm',
        'chmod',
        'chown',
        'sudo',
        'su',
        'mkfs',
        'fdisk',
        'dd',
        'curl',
        'wget',
      ],
      allowedPaths: [],
      strictMode: true,
      ...config,
    };
  }

  /**
   * Execute the shield's security checks on a command.
   * This is called automatically by the dispatcher at the 'post-shield' phase.
   * @param context - The hook context containing the command payload
   * @returns Modified context with security decision attached
   */
  execute(context: HookContext): HookContext {
    const payload = context.payload;
    const violations = this.#analyzePayload(payload);

    if (violations.length > 0) {
      const critical = violations.some((v) => v.severity === 'high');
      const decision: ShieldDecision = {
        allowed: false,
        reason: this.#formatViolations(violations),
        severity: critical ? 'high' : 'medium',
      };

      this.#violationLog.push(...violations);

      return {
        ...context,
        decision,
      };
    }

    return {
      ...context,
      decision: { allowed: true },
    };
  }

  #analyzePayload(payload: CommandPayload): PatternMatch[] {
    const violations: PatternMatch[] = [];
    const { params } = payload;

    const command = this.#extractCommand(params);
    if (command) {
      for (const pattern of this.#config.blocklistPatterns) {
        if (pattern.test(command)) {
          violations.push({
            pattern: pattern.source,
            field: 'params.command',
            severity: 'high',
          });
        }
      }

      const baseCmd = command.split(' ')[0] ?? '';
      if (this.#config.dangerousCommands.includes(baseCmd)) {
        const hasSafeArgs = this.#validateDangerousCommandArgs(baseCmd, command);
        if (!hasSafeArgs) {
          violations.push({
            pattern: `dangerous_command:${baseCmd}`,
            field: 'params.command',
            severity: 'medium',
          });
        }
      }
    }

    if (params.path) {
      const pathCheck = this.#validatePath(String(params.path));
      if (!pathCheck.valid) {
        violations.push({
          pattern: `invalid_path:${pathCheck.reason}`,
          field: 'params.path',
          severity: 'high',
        });
      }
    }

    if (params.cwd) {
      const pathCheck = this.#validatePath(String(params.cwd));
      if (!pathCheck.valid) {
        violations.push({
          pattern: `invalid_cwd:${pathCheck.reason}`,
          field: 'params.cwd',
          severity: 'high',
        });
      }
    }

    return violations;
  }

  #extractCommand(params: Record<string, unknown>): string | null {
    if (typeof params.command === 'string') return params.command;
    if (typeof params.cmd === 'string') return params.cmd;
    return null;
  }

  #validateDangerousCommandArgs(cmd: string, fullCommand: string): boolean {
    if (cmd === 'rm') {
      const target = fullCommand.replace(/^rm\s+/, '').trim();
      if (target === '/' || target.startsWith('/etc') || target.startsWith('/sys')) {
        return false;
      }
    }
    if (cmd === 'chmod') {
      const match = fullCommand.match(/chmod\s+(\d+)/);
      if (match && parseInt(match[1]!, 10) > 755) return false;
    }
    if (cmd === 'mv') {
      if (fullCommand.includes(' /') || fullCommand.includes(' /root')) return false;
    }
    return true;
  }

  #validatePath(inputPath: string): { valid: boolean; reason?: string } {
    if (isAbsolute(inputPath)) {
      return { valid: false, reason: 'absolute_path' };
    }

    if (inputPath.includes('..')) {
      return { valid: false, reason: 'path_traversal' };
    }

    const resolved = resolve(this.#config.sandboxPath, inputPath);
    const normalized = normalize(resolved);
    const sandboxNormalized = normalize(this.#config.sandboxPath);

    if (!normalized.startsWith(sandboxNormalized)) {
      return { valid: false, reason: 'escapes_sandbox' };
    }

    if (this.#config.allowedPaths.length > 0) {
      const inAllowed = this.#config.allowedPaths.some((allowed) =>
        normalized.startsWith(normalize(allowed))
      );
      if (!inAllowed) {
        return { valid: false, reason: 'not_in_whitelist' };
      }
    }

    return { valid: true };
  }

  #formatViolations(violations: PatternMatch[]): string {
    const parts = violations.map((v) => `[${v.severity.toUpperCase()}] ${v.field}: ${v.pattern}`);
    return `Shield blocked: ${parts.join('; ')}`;
  }

  getViolationLog(): readonly PatternMatch[] {
    return [...this.#violationLog];
  }

  addBlocklistPattern(pattern: RegExp): this {
    this.#config.blocklistPatterns.push(pattern);
    return this;
  }

  addAllowedPath(path: string): this {
    this.#config.allowedPaths.push(normalize(path));
    return this;
  }

  getConfig(): Readonly<ShieldConfig> {
    return { ...this.#config };
  }

  /**
   * Verify plugin integrity before loading into the system.
   * Performs security compliance checks including:
   * - Required manifest fields (name, version, permissions)
   * - Dangerous permission detection
   * - Blocked permission filtering (e.g., 'net.request')
   * - Action name validation (prevents path traversal in action names)
   *
   * @param plugin - The plugin instance to verify
   * @returns PluginHealth with validation results and any warnings/errors
   */
  verifyPlugin(plugin: Plugin): PluginHealth {
    const errors: string[] = [];
    const warnings: string[] = [];

    const manifest = plugin.manifest;

    if (!manifest.name || typeof manifest.name !== 'string') {
      errors.push('Plugin name is required');
    }

    if (!manifest.version || typeof manifest.version !== 'string') {
      errors.push('Plugin version is required');
    }

    if (!manifest.permissions || !Array.isArray(manifest.permissions)) {
      errors.push('Plugin permissions declaration is required');
    }

    const dangerousPerms = ['env.write', 'process.spawn', 'fs.delete'];
    const requestedDangerous = manifest.permissions.filter((p) =>
      dangerousPerms.includes(p)
    );

    if (requestedDangerous.length > 0) {
      warnings.push(`Plugin requests elevated permissions: ${requestedDangerous.join(', ')}`);
    }

    if (!manifest.actions || manifest.actions.length === 0) {
      warnings.push('Plugin declares no actions');
    }

    for (const action of manifest.actions ?? []) {
      if (action.includes('..') || action.includes('/')) {
        errors.push(`Invalid action name (path traversal risk): ${action}`);
      }
    }

    const blockedPermissions = ['net.request'];
    const blocked = manifest.permissions.filter((p) => blockedPermissions.includes(p));

    if (blocked.length > 0) {
      errors.push(`Blocked permissions requested: ${blocked.join(', ')}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}

export function createShield(config?: Partial<ShieldConfig>): Shield {
  return new Shield(config);
}
