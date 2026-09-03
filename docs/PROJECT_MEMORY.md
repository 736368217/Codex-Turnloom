# codex-Turnloom Shared Project Memory

This file is the compact, durable context shared by Codex tasks working on this repository. Read it before project work and update it only when a decision, deployment fact, compatibility constraint, or verified incident outcome changes.

Do not copy credentials, access codes, tokens, private URLs containing secrets, raw conversation transcripts, or personal data into this file. Do not send routine cross-task synchronization messages; use this document instead.

## Product identity

- Product name: `Codex-Turnloom`.
- Chinese positioning: 把正在电脑上运行的 Codex，完整延续到你的手机里。
- Official logo: the blue rounded-square mark with two open white rings, a mint node, and a coral node.
- Canonical logo asset: `docs/assets/turnloom-logo.png`.
- Web mark: `public/assets/companion-mark.svg`.
- Social preview: `docs/assets/promo-turnloom.png`.

## Product shape

- Codex-Turnloom is a private, self-hosted mobile control desk for an already-running Codex Desktop installation.
- The computer remains the source of truth. The phone app and mobile web UI display conversations and send controls through the local companion service.
- Supported workflows include conversation pagination and caching, message send/queue/insert/stop, model and reasoning-effort selection, image/file upload, local-file download, tool visibility, reminders, QR pairing, and multiple saved computers.
- The interface uses a restrained Apple-influenced product UI: neutral white/gray surfaces, a single action blue, clear typographic hierarchy, stable touch targets, no decorative gradients, and guidance tied to real tasks.
- Android provides the authoritative computer picker and encrypted device store. First use explains the connection model and leads to QR scanning; saved computers show identity, address, and live connection state. The connected web workspace provides a one-time quick guide that remains available from the conversation sidebar.

## Source and release layout

- Primary repository: `C:\Users\WIN10\Documents\Codex\2026-08-21\a\work\codex-lan-companion`.
- The authoritative Android project is the repository's `android/` directory.
- The separate `codex-pocket-apk` directory is an older divergent copy and must not be treated as the release source.
- Android builds are staged by `scripts/stage-apk.js` for mobile download. APK binaries remain untracked.

## Compatibility constraints

- Keep Android application ID and Java package `com.codexpocket.mobile` so existing installations can update in place and retain saved devices.
- Keep the WebView bridge name `CodexPocket` unless web and Android changes are released atomically with a migration path.
- Continue accepting `codexpocket://` QR links.
- Keep `%LOCALAPPDATA%\CodexPocket`, Android keystore aliases, WorkManager identifiers, notification-channel identifiers, and existing Windows scheduled-task names until an explicit migration is implemented.
- Old CLI aliases remain available alongside the new `codex-turnloom` commands.

## Current deployment

- Local service: Windows host port `8787`, managed by the hidden `Codex Pocket Supervisor` compatibility task.
- Public mobile entry: Alibaba Cloud HTTPS port `18787`.
- Reverse path: public Nginx -> Alibaba loopback port `18786` -> reverse SSH tunnel -> Windows port `8787`.
- Machine-local secrets and configuration live outside Git. Read `docs/OPERATIONS.md` before changing the service, tunnel, certificate, reverse proxy, or scheduled tasks.

## Certificate automation

- The public endpoint uses a short-lived Let's Encrypt IP certificate.
- `openclaw-ip-cert-renew.timer` is enabled and checks twice daily: every 12 hours with up to 20 minutes randomized delay, and it is persistent across reboots.
- Renewal command: `/usr/local/sbin/renew-openclaw-ip-cert.sh`.
- Deployment hook: `/usr/local/sbin/deploy-openclaw-ip-cert.sh`.
- On September 3, 2026, the certificate renewed on disk but host Nginx continued serving the expired certificate because the old reload command did not reach the daemon-off master and runtime configuration had drifted from disk.
- Recovery completed on September 3, 2026: the host proxy was restarted once, the deployment hook was changed to signal the exact host Nginx master PID, and the public endpoint was verified with a certificate valid through September 8, 2026 at 18:47 China Standard Time plus authenticated HTTP `200` health.
- Backup of the previous hook: `/usr/local/sbin/deploy-openclaw-ip-cert.sh.bak-20260903-turnloom`.

## Working protocol

1. Read this file and the relevant source before changing the project.
2. Read `docs/OPERATIONS.md` for deployment, networking, certificate, or background-service work.
3. Preserve compatibility identifiers unless a tested migration is part of the task.
4. Run the relevant checks and tests; Android-facing changes require an Android build.
5. Update this file only with durable, verified information. Put detailed incident timelines in `docs/OPERATIONS.md`.
6. Commit and push verified repository changes to `origin`.
7. Do not send routine status or memory messages to other Codex tasks. Other tasks should synchronize through this document.
