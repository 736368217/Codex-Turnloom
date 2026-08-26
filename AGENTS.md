# Codex Pocket deployment guidance

When the user asks to deploy this repository on a Windows computer:

0. Before changing a deployment, tunnel, proxy, or scheduled task, read `docs/OPERATIONS.md` and preserve its incident history.
1. Preserve the repository and existing Codex data. Never copy `.codex`, credentials, access codes, SSH keys, or generated local configuration into Git.
2. Use `scripts/install-windows.ps1` for the persistent server and watchdog tasks. Do not recreate one-off VBS launchers.
3. Detect the active Codex data directory, but pass `-CodexHome` explicitly when more than one valid directory exists.
4. For remote access, allocate a unique remote port and public URL for this computer. Never reuse another computer's reverse-forward port.
5. SSH keys and remote-server authorization are machine-local prerequisites. Store them under the user's `.ssh` directory with restrictive permissions.
6. After installation, verify `/api/health`, `/api/threads`, watchdog recovery, and the public URL before showing the device QR.
7. Run `npm test`, `npm run check`, and the PowerShell compatibility parser before changing deployment scripts.
8. The Android app imports `codexpocket://add?name=...&url=...&token=...`, HTTP(S) login URLs, or JSON device records. Use `npm run device:qr` to print the supported QR payload.

The machine-local config is `%LOCALAPPDATA%\CodexPocket\config.json`. It contains secrets and must remain untracked.
