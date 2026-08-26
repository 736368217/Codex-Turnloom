# Changelog

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
