# Changelog

## Unreleased

- Show the complete skill picker in stable Desktop-like priority order, including a built-in Compact Context action.
- Surface Codex Desktop goals in the mobile conversation header with edit, status, budget, and clear controls.
- Render ContextCompaction rollout events as safe, visible timeline notices instead of silently dropping them.
- Resolve duplicate Codex project roots by Desktop registration order instead of project-name suffixes, preventing Hermes conversations from being misclassified under 阿里云\\腾讯云.
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
