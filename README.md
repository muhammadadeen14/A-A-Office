# A&A Office

A&A Office is a local-first Windows desktop application for running a supervised office of AI agents. Office Manager accepts objectives, specialists handle focused work, and every task, approval, memory, file, and status change remains visible to the user.

The product uses an original professional interface and an independent implementation.

## Current capabilities

- Original professional command-center UI with dark and light themes
- First-run setup for provider, model, and safety defaults
- Default Office Manager plus custom specialist-agent creation
- Persistent agents, parent/child tasks, progress, results, errors, and recovery state
- OpenAI and OpenAI-compatible provider abstraction
- OS-encrypted credential storage through Electron `safeStorage` (DPAPI on Windows)
- Central approval center with exact action, target, reason, payload, and risk
- Typed file, web-research, and controlled process tool registry
- Trusted workspace path enforcement and directory-traversal protection
- Emergency **Stop all agents** control
- Inspectable and removable local memory with full-text search
- Managed files, activity audit trail, backups, and rotating logs
- SQLite migrations, WAL mode, transactions, indexes, and restart recovery
- NSIS configuration for `A&A-Office-Setup.exe`
- Windows CI workflow that tests and packages the installer

## Development

Prerequisites: Node.js 22 or newer and npm. These are development requirements only; Electron bundles the runtime for installed users.

```bash
npm install
npm run dev
```

Run the complete verification suite:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Build the Windows installer on Windows:

```powershell
npm ci
npm run dist:win
```

The installer is written to `release/A&A-Office-Setup.exe`. The GitHub Actions workflow also produces it as a downloadable artifact.

## Data locations

The application resolves paths through Electron instead of assuming a drive letter or username. On Windows, data is stored beneath the current user's application-data directory:

```text
A&A Office/
  Data/aa-office.sqlite
  Secure Credentials/
  Workspaces/
  Exports/
  Backups/
  logs/
```

Uninstall does not silently remove this user data.

See [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md), [TESTING.md](TESTING.md), [BUILDING.md](BUILDING.md), and [RELEASE.md](RELEASE.md) for engineering details.

## Status

Version `0.1.0` is an initial functional build. The core local workflow is implemented and tested. Browser automation, multiple provider adapters beyond the OpenAI-compatible protocol, richer agent tool calling, signed releases, and installer testing on physical Windows machines remain future work.

## License

MIT
