# ARCHIT3CT3

Modular TypeScript infrastructure with sandboxed execution and extensible hook system.

## Installation

```bash
npm install
npm run build
```

## Architecture

```
src/
├── core/           # Command dispatcher with promise queue
├── lib/            # Sandboxed execution modules
├── api/            # CLI entry point
├── security/       # Filtering middleware (The Shield)
└── types/          # Core type definitions
```

### Core (`/core`)

`CommandDispatcher` manages a promise queue and maps action types to registered modules. Supports async execution with configurable concurrency limits.

### Lib (`/lib`)

`SandboxedExecutor` wraps `child_process.spawn` with:
- 5-second execution timeout
- Sandbox-restricted working directory
- Output buffer limits
- Allowed command whitelist

### Security (`/security`)

`Shield` middleware implements:
- Blocklist patterns for dangerous commands (rm, chmod, mv to /, etc.)
- Path traversal prevention
- Sandbox boundary enforcement
- Violation audit logging

### API (`/api`)

`TerminalAPI` provides CLI interface:
- JSON input via stdin
- Structured JSON output: `{ status, data, logs, executionTime }`
- Debug and pretty-print modes

## Extensibility

Third-party extensions via the hook system:

```typescript
import type { Hook, HookContext, HookPhase } from 'archit3ct3';

const myHook: Hook = {
  name: 'my-plugin',
  phase: 'pre-execute',
  priority: 50,
  execute: async (context: HookContext) => {
    // Transform payload or add metadata
    return context;
  }
};

dispatcher.registerHook(myHook);
```

Hook phases: `pre-shield` → `post-shield` → `pre-execute` → `post-execute`

## Usage

```bash
echo '{"action":"sh.exec","params":{"command":"ls","args":["-la"]}}' | npm start
```

Output:
```json
{
  "status": "success",
  "data": { "stdout": "...", "stderr": "" },
  "logs": ["[EXEC] ls -la", "[EXIT] code=0"],
  "executionTime": 45
}
```
