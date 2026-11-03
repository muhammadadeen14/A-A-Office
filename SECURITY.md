# Security model

The model proposes and reasons. The application decides whether anything executes.

## Renderer isolation

- `nodeIntegration: false`
- `contextIsolation: true`
- Chromium sandbox enabled
- explicit preload API only
- strict IPC schemas with Zod
- Content Security Policy applied to renderer responses
- arbitrary navigation and new windows denied

## Credentials

Provider keys are encrypted with Electron `safeStorage`. Windows uses the operating system's DPAPI-backed protection. Only ciphertext is stored under the application data directory. Keys are never stored in SQLite, returned to the renderer, written to logs, or included in error messages.

## Tools and permissions

Models cannot execute arbitrary output. Every capability is represented as a typed tool call. `PermissionService` applies the agent's profile and classifies risk. `ToolRegistry` executes only validated calls.

Research-only agents cannot write files or run commands. Standard agents may create new files inside trusted workspaces. File overwrites, process execution, and external side effects require an approval record first. A denied approval never invokes the tool.

Approved process execution uses an executable and argument array with `execFile`; it does not concatenate a model-generated shell string. Execution has a timeout and output limit.

## Path safety

Paths are resolved canonically against application-managed workspace and export roots. Relative traversal and prefix-lookalike paths are rejected. The design supports spaces, Unicode, alternate drives, and long paths because it uses platform path APIs and argument arrays.

## Emergency stop

**Stop all agents** rejects new work, aborts active provider calls, clears queued work, pauses recoverable tasks, and preserves their database state. Resuming permits new work but does not silently restart paused tasks.

## Network and external actions

Provider requests use configured HTTPS endpoints. Non-TLS endpoints are accepted only for loopback development providers. Browser research is read-only. Form submission, publishing, messaging, uploads, purchasing, account changes, and financial operations require new typed tools and explicit approval; they are not implemented as generic web access.

## Reporting security issues

Do not include API keys, private files, or database contents in a public issue. Revoke any credential that may have been exposed and report the minimum reproducible details through a private repository security advisory.
