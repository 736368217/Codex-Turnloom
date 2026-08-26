# Codex Pocket Operations Record

Read this record before changing deployment, tunnel, reverse-proxy, or scheduled-task settings. It intentionally contains no passwords, access codes, private keys, or API tokens.

## Current topology

```text
Phone app / browser
  -> public HTTPS entry on Alibaba Cloud :18787
  -> Alibaba Cloud loopback 127.0.0.1:18786
  -> reverse SSH tunnel
  -> this computer 127.0.0.1:8787
  -> Codex Pocket service
  -> D:\codex\.codex
```

- Alibaba Cloud currently uses Nginx/OpenResty. Do not install Caddy or bind another service to `80`, `443`, or `18787` without first inspecting the existing proxy configuration.
- The reverse tunnel account is intentionally restricted. Its remote listener is loopback-only; public exposure is handled by the existing reverse proxy.
- The mobile service itself requires its access-code header. A public `401` response confirms the network path is healthy; it does not indicate an outage.

## Local persistent state

- Deployment configuration: `%LOCALAPPDATA%\CodexPocket\config.json` (secret, never commit or copy into docs).
- Logs: `%LOCALAPPDATA%\CodexPocket\logs`.
- Scheduled task: `Codex Pocket Supervisor`.
- The single hidden supervisor checks both the local service and reverse tunnel every 5 seconds and restarts either child when needed. A one-minute repeating task trigger restores the supervisor itself after an external stop; `IgnoreNew` prevents duplicate instances while it is healthy.

## Incident history

### 2026-08-26: phone app returned 502

- Symptom: public mobile endpoint returned `502 Bad Gateway`.
- Root cause: the local service was no longer listening on port `8787`; the reverse SSH tunnel and Alibaba Cloud listener remained healthy.
- Recovery: restarted `Codex Pocket Server Watchdog`; local health and authenticated public health both returned `200`.
- Prevention: consolidated supervision into one scheduled task that manages both child processes and has Task Scheduler failure-restart settings.

## Change rules

1. Read this file and inspect current health before modifying proxy, tunnel, port, or task settings.
2. Preserve `config.json`, existing SSH keys, and all Codex data. Never put secrets into this repository or this record.
3. Validate in order: local health, local thread list, tunnel process, public unauthenticated `401`, then public authenticated `200`.
4. Append a dated entry here after any server-side or connectivity change, including what changed, why, rollback, and verification result.
5. After every verified project change, commit it and push it to the private GitHub `origin`. Do not report completion while changes remain only on one computer; report any push blocker explicitly.
