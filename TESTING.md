# Testing

Run all automated checks from the repository root:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

The Vitest suite covers:

- configuration defaults and validation
- database initialization and migration version
- Office Manager seeding
- agent creation, editing, archival, and protected defaults
- task creation, assignment, legal transitions, parent/child relations, and retry
- approval creation, one-time decisions, denial enforcement, and approved execution
- approval replay prevention, immutable approved arguments, command cancellation, and exit capture
- permission-profile enforcement
- trusted paths and traversal rejection
- spaces, Unicode, long paths, missing files, and symbolic-link escape rejection
- memory indexing, search, and deletion
- provider failure isolation and credential redaction
- restart persistence and interrupted-task recovery
- bounded Office Manager delegation, duplicate-task prevention, and provider concurrency
- live backup, integrity validation, restore, and corrupted-backup rejection
- Windows package metadata and repeatable artifact workflow

The compiler checks both Electron and renderer contracts. ESLint checks TypeScript and React hooks. The production build compiles the main, preload, and renderer bundles.

## Manual Windows checks

Before a release, use Windows 10 and Windows 11 x64 virtual machines to verify installation, Start Menu and desktop shortcuts, first-run flow, provider connection, agent/task CRUD, approval decisions, emergency stop, restart recovery, backup creation, upgrade, and uninstall data retention. Include a Windows user profile with spaces and Unicode characters and test a non-system data drive when available.

The cloud Linux runner cannot prove native Windows installer launch behavior. The Windows GitHub Actions job builds the installer; a release still requires the manual smoke checks above.
