# Release process

1. Update the version in `package.json` and user-facing release notes.
2. Run `npm ci`, lint, type checking, tests, and the production build.
3. Run the Windows packaging workflow or `npm run dist:win` on Windows x64.
4. Install `A&A-Office-Setup.exe` on clean Windows 10 and Windows 11 machines.
5. Complete the manual checks in `TESTING.md`, including upgrade and uninstall data retention.
6. Code-sign the executable with the release certificate. Signing credentials must live in the CI secret store, never the repository.
7. Generate checksums, publish the installer and checksum, and record known limitations.

Version `0.1.0` is not code-signed. `signAndEditExecutable` is disabled only for Linux cross-build diagnosis; the Windows workflow enables executable metadata editing. Add certificate secrets to that Windows job before public distribution.
