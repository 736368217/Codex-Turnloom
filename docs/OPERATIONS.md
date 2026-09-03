# codex-Turnloom Operations Record

Read this record before changing deployment, tunnel, reverse-proxy, or scheduled-task settings. It intentionally contains no passwords, access codes, private keys, or API tokens.

## Current topology

```text
Phone app / browser
  -> public HTTPS entry on Alibaba Cloud :18787
  -> Alibaba Cloud loopback 127.0.0.1:18786
  -> reverse SSH tunnel
  -> this computer 127.0.0.1:8787
  -> codex-Turnloom service
  -> D:\codex\.codex
```

- Alibaba Cloud currently uses Nginx/OpenResty. Do not install Caddy or bind another service to `80`, `443`, or `18787` without first inspecting the existing proxy configuration.
- The reverse tunnel account is intentionally restricted. Its remote listener is loopback-only; public exposure is handled by the existing reverse proxy.
- The mobile service itself requires its access-code header. A public `401` response confirms the network path is healthy; it does not indicate an outage.

## Local persistent state

- Deployment configuration: `%LOCALAPPDATA%\CodexPocket\config.json` (legacy-compatible internal path; secret, never commit or copy into docs).
- Logs: `%LOCALAPPDATA%\CodexPocket\logs`.
- Scheduled task: `Codex Pocket Supervisor` (legacy-compatible internal name).
- The single hidden supervisor checks both the local service and reverse tunnel every 5 seconds and restarts either child when needed. A one-minute repeating task trigger restores the supervisor itself after an external stop; `IgnoreNew` prevents duplicate instances while it is healthy.

## Incident history

### 2026-08-26: phone app returned 502

- Symptom: public mobile endpoint returned `502 Bad Gateway`.
- Root cause: the local service was no longer listening on port `8787`; the reverse SSH tunnel and Alibaba Cloud listener remained healthy.
- Recovery: restarted `Codex Pocket Server Watchdog`; local health and authenticated public health both returned `200`.
- Prevention: consolidated supervision into one scheduled task that manages both child processes and has Task Scheduler failure-restart settings.

### 2026-08-27: phone app could not connect over HTTPS

- Symptom: the desktop service and reverse tunnel were healthy, but Android WebView rejected the public mobile endpoint.
- Root cause: the host Nginx listener on `18787` was still serving the previous short-lived IP certificate, which expired at `2026-08-27 03:05:36` China Standard Time. The certificate files had already been renewed, but the renewal hook only reloaded the OpenResty container and not the host Nginx process.
- Recovery: validated `/etc/nginx/clawpanel-nginx.conf`, reloaded host Nginx, and confirmed the public certificate now expires at `2026-08-30 16:32:30` China Standard Time. MuMu Android verification completed without WebView TLS errors.
- Prevention: updated `/usr/local/sbin/deploy-openclaw-ip-cert.sh` on Alibaba Cloud to validate and reload host Nginx, then keep the existing OpenResty reload. A backup was kept as `deploy-openclaw-ip-cert.sh.bak-20260827`.
- Rollback: restore that backup and reload host Nginx with `/usr/sbin/nginx -s reload -c /etc/nginx/clawpanel-nginx.conf`.

### 2026-08-27: supervisor PowerShell window appeared in the foreground

- Symptom: the persistent Windows keepalive task periodically flashed a PowerShell console that provided no useful controls or status.
- Root cause: Task Scheduler launched the console-subsystem `powershell.exe` directly. `-WindowStyle Hidden` is applied after process creation and therefore cannot reliably prevent the initial console window from appearing.
- Recovery: changed `Codex Pocket Supervisor` to launch through the repository-managed `windows-supervisor-launcher.vbs` using the GUI-subsystem `wscript.exe`, and marked the scheduled task itself hidden.
- Prevention: the installer now enforces the windowless launcher and includes a regression test that rejects direct scheduled-task launches through `powershell.exe`.
- Verification: terminated the active supervisor and observed automatic recovery for 90 seconds; no visible background windows were detected, the task returned to `Running`, and local and public health checks both returned `200`.
- Rollback: reinstall the previous commit's scheduled-task action. This restores direct PowerShell launch behavior and may restore the console flash.

### 2026-08-27: mobile list used stale server code after an update

- Symptom: the updated APK still displayed 59 conversations, including subagent tasks, even though the new server returned only 30 main tasks in an isolated test.
- Root cause: reinstalling the scheduled task stopped the supervisor but left its detached Node child alive, so port `8787` continued serving the previous `server.js` in both local and public requests.
- Recovery: stopped only the Node process whose command line matched this repository's `server.js` and configured port; the hidden supervisor restarted it from the updated files.
- Prevention: `scripts/install-windows.ps1` now stops that exact managed server process before registering and starting the replacement task. It does not stop unrelated Node processes.
- Verification: authenticated local and public `/api/threads` both returned 30 main tasks with zero sampled subagent rows; MuMu showed the pinned and project-grouped list.
- Rollback: revert the installer process-stop helper, then reinstall the scheduled task. This may allow stale server children to survive future updates.

### 2026-09-03: mobile showed the computer as offline

- Symptom: the Android app marked the saved computer offline even though the local codex-Turnloom service was healthy.
- Root cause: the public IP certificate had renewed on disk, but the host Nginx process was still serving the certificate that expired on September 3, 2026 at 05:32 China Standard Time. The reload command also collided with an already-running listener on port `1420`, so the new certificate was not loaded.
- Recovery: restarted `clawpanel-proxy.service` after validating `/etc/nginx/clawpanel-nginx.conf`, then verified the public certificate is valid through September 8, 2026 at 18:47 China Standard Time and the authenticated health endpoint returns `200`.
- Prevention: updated `/usr/local/sbin/deploy-openclaw-ip-cert.sh` to signal the exact host Nginx master process instead of relying on the missing default PID file. A backup was kept as `deploy-openclaw-ip-cert.sh.bak-20260903-turnloom`.

## Change rules

1. Read this file and inspect current health before modifying proxy, tunnel, port, or task settings.
2. Preserve `config.json`, existing SSH keys, and all Codex data. Never put secrets into this repository or this record.
3. Validate in order: local health, local thread list, tunnel process, public unauthenticated `401`, then public authenticated `200`.
4. Append a dated entry here after any server-side or connectivity change, including what changed, why, rollback, and verification result.
5. After every verified project change, commit it and push it to the private GitHub `origin`. Do not report completion while changes remain only on one computer; report any push blocker explicitly.
