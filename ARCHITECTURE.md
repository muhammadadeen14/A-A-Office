# Architecture

## Process boundaries

A&A Office uses three Electron layers:

1. The main process owns the window, SQLite database, credentials, providers, agent runtime, tools, backups, logs, and operating-system access.
2. The sandboxed preload exposes a narrow typed API through `contextBridge`.
3. The React renderer presents state and sends validated requests. It has no Node.js access.

`contextIsolation` and the Chromium sandbox are enabled. `nodeIntegration` is disabled. Navigation and new-window creation are blocked.

## Core services

- `OfficeDatabase` applies versioned SQLite migrations, creates the default Office Manager, stores application entities, and recovers interrupted tasks.
- `OfficeRuntime` enforces a bounded work queue, isolates each agent request with its own abort controller, calls providers, persists results, and implements the emergency stop.
- `TaskService` owns legal task state transitions and retry behavior.
- `ProviderService` implements the OpenAI-compatible chat-completions boundary. Provider-specific code remains outside agents and tasks.
- `PermissionService` decides whether a typed tool request is allowed, denied, or paused for approval.
- `ToolRegistry` is the only execution boundary for file, web, and process capabilities.
- `PathGuard` resolves canonical paths and rejects traversal outside trusted workspace roots.
- `CredentialStore` encrypts provider keys with Electron `safeStorage` and keeps ciphertext outside SQLite.
- `BackupService` creates timestamped copies and retains the seven newest backups.

## Data model

SQLite stores agents, tasks, approvals, activity events, memories, managed files, providers, and settings. Tasks reference optional parents and assigned agents. Memory has an FTS5 index. WAL mode permits responsive reads while the main process records progress.

Credentials are deliberately absent from this model. Provider records contain only display metadata and a `hasCredential` flag.

## Agent execution

The renderer creates a task through validated IPC. `OfficeRuntime` places it in a bounded queue and resolves its assigned agent and provider. The task moves through planning and running, while the agent moves through thinking and working. A successful answer is persisted as both task result and optional inspectable memory. A scoped provider or agent failure marks only that task and agent as failed.

The current build performs direct single-agent model calls. The schema supports parent/child tasks and structured specialist assignment; a future orchestration planner can create child tasks through the same service without changing persistence or UI contracts.

## Recovery

At startup, tasks left in planning, running, or waiting-for-approval are changed to paused with a user-readable recovery reason. Agent current-task pointers are cleared. Completed results, conversations represented as memory, approvals, and audit events remain intact.

## Extension points

New model vendors implement the provider boundary. New computer or browser capabilities register typed tool calls and use the same permission decision and approval record. New export formats write only through trusted workspaces and register their output in managed files.
