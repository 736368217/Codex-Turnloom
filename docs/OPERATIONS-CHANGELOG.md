# Codex-Turnloom Operations Changelog

This is a concise, secret-free record for humans and future agents. Detailed topology and guardrails are in `OPERATIONS.md`.

## 2026-09-02

- Conversation listings now exclude archived and spawned-agent records across all metadata paths, including `thread_spawn_edges`; ungrouped conversations are explicitly separated from project groups. Long-press conversation actions can copy a native Codex Desktop deep link.
- When the Desktop state database is available, it is the sole sidebar membership source; session-index and IPC records may refresh detail data but cannot create stale or unclassified sidebar entries.

## 2026-08-30

- Stop requests now require a confirmed Desktop state transition. Empty `interruptedTurnId` acknowledgements trigger a no-turn-id retry, and the service reports a conflict if the original turn is still running instead of claiming success.
- Project grouping uses the longest unique Desktop root; roots registered under multiple projects remain ungrouped and are recorded as ambiguous rather than guessed.

## 2026-08-30

- Goal editing now opens in a standalone modal from the long-press menu, so the compact goal row and conversation reading area keep their size while editing on mobile.
- Fixed mobile goal visibility when Desktop has no active IPC owner: the service now falls back to the local Codex Desktop `goals_1.sqlite` store and normalizes `usage_limited`/`budget_limited` statuses.
- Thread detail freshness now considers the rollout file modification time, preventing newer conversation records from being masked by a stale state-database timestamp.

## 2026-08-30

- Mobile sends now clear the composer immediately and keep one optimistic user bubble with sending/success/failure state; failed sends can be retried without duplicating the message.
- Routine Desktop refresh `no-client-found` results are logged silently rather than rendered as a repeated warning card.

## 2026-08-29

- Capped and normalized queued-message previews so long mobile sends cannot push queue actions outside the viewport; narrow layouts keep actions on a dedicated row.
- Android WebView now hands HTTP/HTTPS conversation links to the system browser, preserving the active Codex-Turnloom page.

- Fixed the mobile goal panel's native `hidden` behavior being overridden by author CSS; empty goal forms no longer push conversation content down.
- Goal writes now send only Desktop-supported `objective` and `status` fields; the old companion token-budget path was removed.
- Rebuilt and installed the debug APK on all three local MuMu ADB devices, then verified the machine picker, drawer/back flow, compact conversation header, and ungrouped ordinary conversation list.

## 2026-08-29

- Added Desktop IPC-backed mobile goal read/edit/clear operations and a mobile Compact Context action; the UI exposes only the actual objective/status and no companion-only goal shadow state.
- Added safe ContextCompaction timeline notices and removed the 12-item skill picker cap; skill ordering now prioritizes built-ins and core skills.
- Fixed duplicate Codex project-root classification by honoring Desktop project/root order; the shared `腾讯云` root now resolves consistently to the first registered project (`飞牛nas`) instead of matching the `阿里云\\腾讯云` name suffix.
- Fixed mobile-send Desktop staleness by waiting for the new turn to appear in the rollout before issuing the bounded refresh/open fallback. No credentials or conversation data were changed.

## 2026-08-27

- Removed Android foreground reminder polling. WorkManager now performs immediate checks after mobile actions, follows active tasks, and uses a 15-minute periodic fallback without a permanent notification.
- Mobile thread responses now exclude subagent rows by Codex `thread_source`/`source` metadata, while a directly selected historical subagent remains accessible.
- Added project grouping from native Codex projects with a normalized working-directory fallback, plus Desktop-compatible pinned-section reads and pin/unpin writes.
- Evaluated the official Codex app-server mutation API, but standalone startup stalled on remote plugin synchronization in this API-key-only environment. The pin endpoint therefore uses a scoped SQLite transaction and queues a Desktop refresh.
- Fixed Windows reinstall behavior so the exact old managed Node child is stopped before the hidden supervisor starts the updated server.
- Verified the public list, MuMu Android 1.11.0 UI, WorkManager jobs, and absence of active Codex-Turnloom foreground notifications.

## 2026-08-26

- Investigated mobile access failure: Alibaba Cloud proxy and reverse tunnel were healthy, but the local Codex-Turnloom process was not listening on port `8787`, producing public `502` responses.
- Restored the server watchdog and verified local health plus authenticated public health return `200`.
- Confirmed the Alibaba Cloud public entry uses Nginx/OpenResty, not Caddy. Existing listeners and proxy configuration must be preserved.
- Added an independent Windows `Codex Pocket Recovery Monitor` to restart a stopped server or tunnel watchdog after its health check fails.
- Consolidated the three initial scheduled tasks into one `Codex Pocket Supervisor`. It manages both the Node service and SSH tunnel internally, reducing background PowerShell memory and configuration complexity.
- Added a one-minute recovery trigger after testing showed that Task Scheduler's failure-restart setting alone does not reliably recover a supervisor terminated externally.
- Recorded the permanent repository rule that every verified project change must be committed and pushed to the private GitHub `origin`, while machine-local secrets remain excluded.
- No credentials, access codes, private keys, API tokens, or Codex conversation data were changed or recorded here.
