# Changelog

## Unreleased

## 1.16.0 - 2026-10-23

- Ship the Loom Studio V2 mobile redesign: cool-slate surfaces (`#F4F5F8`), white cards and a single action blue (`#0066CC`) replace every legacy teal and warm-gray token.
- Put a semantic status pill in front of the conversation header (`思考中 · 01:18` / `待确认权限` / `已结束`) and show the same pill plus elapsed time on every conversation row.
- Replace the solid-blue wrench emoji toggle with a 40dp line-icon button; the enabled state is a soft blue tile with a 6px accent dot, so the send button keeps the only solid-blue focus.
- Rebuild the composer as one 16dp unified pod, move the running send mode to its own full-width strip with explicit `排队（完成后发）` / `插入（立即打断）` labels, and keep the model, plugin and skill capsules on one line from 360dp to 430dp.
- Turn permission requests into a security decision card: white body, 4px red top bar, monospace path sandbox and three 44dp anti-mispress buttons (允许本次 / 始终允许 / 拒绝) with bilingual sub-labels.
- Restyle the queued-message panel to a light-blue card with white queue rows and an accent `⚡ 插入` action, and trim message metadata to one lightweight eyebrow line that hides the redundant “已发送” status.
- Give tool records a compact single-line step card, and refine the access gate (22dp card, 24px single-line brand title, online host pill) plus a 338dp drawer with 12dp conversation rows.
- Upgrade the Android computer picker to standalone 16dp device cards with 44dp icon tiles, online/offline/detecting status pills and monospace host addresses.
- Bump the mobile app to `1.16.0` (`versionCode` 20) and archive the V2 design package under `docs/design/mobile-v2/`.
- Ship the Windows tray console: silent tray startup, service/tunnel supervision, onboarding, settings, logs, pairing QR, restart/stop controls, and an NSIS installer.
- Add the dependency-free HTTP backend (`--backend http`) and token-routed profiles (`--profiles`) so Codex and third-party agents can share one port without mirroring `CODEX_HOME`.
- Harden thread loading with per-thread rollout isolation and `/api/admin/diagnostics`, and add optional adapter `status_*` columns plus `/api/adapters/status` for exact running/waiting/ended states.
- Prefer `node:sqlite`, cache rollout status, add thread-list pagination/ETag, and rate-limit model fallback logs.
- Scope remembered access codes by device and dedupe Android scanned devices by origin plus token.

### Additional fixes in 1.16.0

- Keep the mobile model and reasoning picker visible above the composer instead of clipping it inside the narrow-screen toolbar.
- Isolate rollout-path failures per thread: one bad or missing rollout now leaves that thread at `unknown` instead of failing the whole `/api/threads` response, and the new authenticated `/api/admin/diagnostics` endpoint lists every missing or out-of-home rollout for repair.
- Add an adapter status channel: optional `threads.status_state`, `status_turn_id`, `status_started_ms`, and `status_updated_ms` columns, plus `POST /api/adapters/status` with TTL overrides, so non-Codex backends can report `running`/`waiting`/`ended` directly and avoid rollout inference. `--status-max-age-minutes` controls trust; `--active-turn-stale-minutes` makes the rollout fallback threshold configurable.
- Prefer `node:sqlite` for state reads with a `sqlite3` CLI fallback (`--sqlite-driver auto|node|cli`), eliminating a child process per database query on modern Node.js.
- Cache per-file rollout status by `(size, mtimeMs)` and bound status parsing to 12 concurrent files, reducing repeat `/api/threads` scans.
- Support `?limit=&cursor=` and `ETag`/`304` on `/api/threads`; the web client revalidates cached thread lists instead of downloading them again unchanged.
- Rate-limit the `[models] Using fallback model list` log so a missing `config.toml` cannot flood the service log.
- Route every `execFile`/`spawn` call through Windows-hidden helpers, keeping the child-process guard on the SQLite CLI and app-server fallback in one place.
- Add a dependency-free HTTP backend (`--backend http`) and token-routed profiles (`--profiles`) so Turnloom can serve Codex and third-party agents on one port without mirroring `CODEX_HOME`.
- Deduplicate Android scanned devices by origin plus token instead of the full URL, so two same-origin devices with different access codes can coexist.
- Restore mobile sending with Codex Desktop 26.901 by discovering the open conversation owner and routing start/stop retries directly to that Desktop client; keep local follower requests on the local protocol envelope.
- Open conversations at the latest message even when hydrating from the offline cache, load only the latest 40 messages initially, and fetch older history in bounded pages while preserving the reading position.
- Redesign the Android computer picker and connected web workspace with a restrained Apple-influenced visual system, clearer computer identity and live connection states, first-use guidance, and a persistent quick-guide entry.
- Stage every Android build under the `Codex-Turnloom.apk` release name; the old `CodexPocket.apk` release filename is no longer generated.
- Keep the Windows supervisor alive across idle and power-state changes, enforce a single supervisor instance, and recreate damaged scheduled-task state without opening a console window.
- Match Desktop conversation visibility more strictly: archived threads and all detected spawned-agent records are excluded, including rows identified by spawn edges, `agent_path`, or `agent_created_thread` metadata. Label the ungrouped section as “Other conversations” so it cannot be mistaken for the preceding project.
- Treat the Desktop state database as authoritative for the sidebar; stale session-index and IPC-only rows are no longer appended as phantom conversations when state metadata is available.
- Add long-press “Copy deep link” to conversation actions, using the native `codex://threads/<thread-id>` scheme.
- Require Desktop stop requests to be confirmed by the original turn ending; an `ok` response with no `interruptedTurnId` now retries without a stale turn id, polls bounded status, and returns a real conflict instead of falsely clearing the mobile running state.
- Restore project grouping from the longest unique Desktop project root, while leaving duplicate roots shared by different projects ungrouped to avoid cross-project misclassification.
- Move goal editing into a standalone mobile-friendly dialog opened from the long-press goal menu, keeping the conversation header compact while supporting cancel, save, status changes, and clear.
- Read Codex Desktop goals from `goals_1.sqlite` when the Desktop IPC owner is unavailable, preserving paused/blocked goals on mobile instead of treating them as missing.
- Normalize Desktop goal status names and use rollout file freshness alongside the state database timestamp so newly written mobile/desktop messages are not hidden behind a stale thread snapshot.
- Clear the composer immediately when sending and show one chat bubble with delivery state: sending, sent, or failed with a retry action.
- Keep routine Desktop `no-client-found` refresh deferrals in logs instead of showing a repeated `Desktop refresh delayed` notice in the conversation.
- Keep queued-message previews compact and single-line, with narrow-screen actions moved below the preview so edit/cancel buttons remain reachable.
- Open conversation HTTP/HTTPS links in the Android system browser instead of navigating the Codex-Turnloom WebView away from the current task.
- Keep the Desktop goal surface to one compact objective/status line; long-press opens pause, edit, and delete actions, and empty goal controls no longer occupy reading space.
- Remove the companion-only token budget from Desktop goal IPC writes so mobile goal behavior matches Codex Desktop's objective/status model.
- Keep ordinary conversations ungrouped unless Desktop explicitly assigns a project; working directories are never used as an inferred project category.
- Show the complete skill picker in stable Desktop-like priority order, including a built-in Compact Context action.
- Surface Codex Desktop goals in the mobile conversation header with compact objective, status, edit, and clear controls; hide the panel when no goal exists.
- Render ContextCompaction rollout events as safe, visible timeline notices instead of silently dropping them.
- Resolve duplicate Codex project roots by Desktop registration order instead of project-name suffixes, preventing conversations from being assigned to an unrelated project.
- Wait for a mobile-sent turn to persist before attempting the Desktop refresh/open fallback, preventing the Desktop conversation view from lagging until restart.
- Keep the thinking indicator on one fixed line and restore Desktop project grouping from the explicit `project_roots` registry, leaving ordinary conversations ungrouped.
- Match Codex Desktop grouping by showing only explicit projects; ordinary conversations remain in one unlabeled list instead of being grouped by working directory.
- Make Android system Back return from an active computer to the computer picker instead of navigating into stale WebView authentication history.
- Restore the saved Android device access code through the native bridge when a refreshed or restored page has no login parameter.
- Replace the Android foreground reminder service with WorkManager so idle monitoring no longer leaves a permanent notification.
- Detect newly completed turns by completion timestamp, including tasks that start and finish between background checks.
- Hide Codex subagent threads from the normal mobile list while preserving a directly selected legacy subagent URL.
- Group mobile conversations into Desktop-compatible pinned and project sections, with pin/unpin in the long-press menu.
- Stop the exact previously managed Node server during Windows reinstall so verified updates cannot leave stale code serving the phone.
- Launch the Windows supervisor through a windowless host so watchdog recovery never flashes a PowerShell console.
- Render full GFM Markdown in conversation messages, including headings, emphasis, links, lists, code blocks, and tables.
- Sanitize message HTML and unsafe URLs before rendering while retaining supported plugin references and local generated images.
- Keep wide Markdown tables horizontally scrollable inside the mobile message bubble.

## 1.10.2

- Replace the persistent "正在监测" reminder notification with a silent, minimum-priority monitor notification.
- Keep completion notifications separate and active so the phone only alerts when a monitored Codex task finishes.

## 1.10.1

- Clear the composer text, selections, attachments, and browser form state after an accepted send.
- Make the cleanup idempotent across asynchronous refreshes so sent text is not restored in the Android WebView.

## 1.10.0

- Replace the conversation-list reminder bell with a long-press, right-click, or keyboard context menu.
- Show reminder state as lightweight text without consuming a separate action column.
- Add phone-local notes for saved computers and preserve notes when rescanning an existing device.
- Show computer notes in the machine picker, active-machine header, and completion notifications.

## 0.1.0

Initial public release.

- View Codex Desktop conversations from another device on the same LAN.
- Mobile-friendly conversation list, drawer behavior, and message view.
- Near-real-time conversation refresh with thinking/status indicators.
- Writable by default for sending messages from the web UI to Codex Desktop, with optional `--readonly` mode.
- Plugin picker, skill picker, image attachments, interruption support, and approval display where detectable.
- Account and local plan-usage display when available from Codex local state.
- Short 6-digit access code and terminal QR sign-in for local browser access.
- Documentation screenshots for desktop and mobile browser UI.
- macOS LaunchAgent install/uninstall commands for running the companion as a background service.
- Clear fatal startup logs for port conflicts, permission errors, uncaught exceptions, and unhandled promise rejections.

Compatibility note: this release was verified only with Codex Desktop `26.601.21317` on macOS. Codex Desktop local storage and IPC are private implementation details and may change in future builds.
