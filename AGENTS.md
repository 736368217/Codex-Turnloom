# codex-Turnloom deployment guidance

When the user asks to deploy this repository on a Windows computer:

0. Before changing a deployment, tunnel, proxy, or scheduled task, read `docs/OPERATIONS.md` and preserve its incident history.
1. Preserve the repository and existing Codex data. Never copy `.codex`, credentials, access codes, SSH keys, or generated local configuration into Git.
2. Use `scripts/install-windows.ps1` for the persistent server and watchdog tasks. Do not recreate one-off VBS launchers; use the repository-managed windowless supervisor launcher.
3. Persistent background services, watchdogs, tunnels, and keepalive processes must run silently without visible console or PowerShell windows. Preserve file-based logs for diagnostics instead of showing background consoles.
4. Detect the active Codex data directory, but pass `-CodexHome` explicitly when more than one valid directory exists.
5. For remote access, allocate a unique remote port and public URL for this computer. Never reuse another computer's reverse-forward port.
6. SSH keys and remote-server authorization are machine-local prerequisites. Store them under the user's `.ssh` directory with restrictive permissions.
7. After installation, verify `/api/health`, `/api/threads`, watchdog recovery, and the public URL before showing the device QR.
8. Run `npm test`, `npm run check`, and the PowerShell compatibility parser before changing deployment scripts.
9. The Android app imports `codexpocket://add?name=...&url=...&token=...`, HTTP(S) login URLs, or JSON device records. Use `npm run device:qr` to print the supported QR payload.

The machine-local config is `%LOCALAPPDATA%\CodexPocket\config.json`. It contains secrets and must remain untracked.

## Repository synchronization

- This project is maintained in the private GitHub repository configured as `origin`.
- After making and verifying any project change, commit the scoped changes and push the current branch to `origin` before reporting completion.
- If a push fails, diagnose it using the configured local credentials and the Clash proxy at `http://127.0.0.1:7897` when needed. Never silently leave verified changes only on this computer.
- If synchronization still cannot be completed, clearly report the unpushed commit and the blocking reason.
- Never commit or push machine-local configuration, access codes, credentials, private keys, tokens, Codex data, or logs containing secrets.

## Android release delivery

- Whenever an APK is rebuilt or updated, stage the latest artifact at `public/downloads/CodexPocket.apk`.
- In the completion message, always include both the public mobile download URL and a clickable local APK file link so the user can install it directly from the current conversation.
- Keep APK binaries out of Git; only commit source, build scripts, and release instructions.
