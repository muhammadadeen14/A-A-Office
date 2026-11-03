# Building

## Development requirements

- Node.js 22 or newer
- npm 10 or newer
- platform build tools when a native dependency must compile

Installed users do not need Node.js, npm, Git, Python, PowerShell setup, or developer tools. Electron and the SQLite native module are packaged with the application.

## Install and run

```bash
npm install
npm run dev
```

Electron Builder rebuilds native dependencies for the Electron ABI when packaging. If a local Node test run follows an Electron native rebuild, run `npm rebuild better-sqlite3` before `npm test`.

## Production bundle

```bash
npm run build
```

This creates `out/main`, `out/preload`, and `out/renderer`.

## Windows installer

Run on Windows x64:

```powershell
npm ci
npm run dist:win
```

The NSIS output is `release/A&A-Office-Setup.exe`. It offers an install directory, creates Start Menu and desktop shortcuts, can launch after installation, and retains user data during uninstall.

`dist:win` supports unsigned cross-build diagnosis. The Windows release workflow uses `dist:win:release` so Electron Builder applies executable metadata and the packaged application icon on Windows.

The repository workflow `.github/workflows/windows.yml` performs the same build on `windows-latest` and uploads the installer artifact.

The workflow pins Python 3.12 and Visual Studio 2022 to rebuild `better-sqlite3` for Electron. These are CI build tools only; installed users do not need them.
