# Changelog

## 1.17.10 - 2026-10-29

- 手机界面重新设计：固定浅色，白底阅读区搭配淡蓝色用户消息；统一文字、间距、圆角和状态颜色，减少助手回复的卡片边框。
- 重排输入工具栏：模型名称随空间截断，插件、技能、图片、发送和停止入口保持可达；主要触控按钮至少为 44px，修复运行中停止按钮被挤出屏幕的问题。
- 对话列表重新整理搜索、排序、项目分组和当前会话选中态；模型选择面板以输入区为锚点，避免窄屏越界。
- 普通阅读视图收起 system/developer 记录，可通过工具详情开关查看；内容计数随可见记录更新，用户角色显示为「你」。
- 登录与引导页装饰文案中文化，补充输入聚焦、按钮按下、禁用与减少动态效果状态。
- 窄屏导航改按窗口宽度切换，防止软键盘压低可用高度后跳成桌面双栏；在 360×300、360×400 和 640×360 视口下复核发送按钮可见性。

## Unreleased

- Images sent from the phone now actually reach the model. The bridge's `textFromTurnInput()` kept only `text` parts and silently dropped `image` parts, so the phone showed "sent" while the model received plain text (verified: the transcript had no image block at all). The host also refuses inline base64 — `preparePromptAttachments()` resolves `attachment.path` inside `<dataRoot>/scratch/<sessionId>` and threw `Cannot access … 'trim'` for the first attempt — so images are now staged to disk first and passed by path. End-to-end proof on the phone: asked "图片里的大块颜色是什么" about a blue test square and the model answered 蓝色.
- A stalled messages request can no longer leave the list on 加载中 forever: the fetch is bounded by `MESSAGE_REQUEST_TIMEOUT_MS` and a timeout surfaces as 「读取超时，请点重试。」 with a retry button.

- Compressed transcripts are now readable. Codex rotates older sessions to `<name>.jsonl.zst`, and the server only looked for `.jsonl`, so on this machine just 7 of 301 sessions had a readable transcript — opening any other conversation failed. `resolveRolloutFile()` falls back to the `.zst` sibling, `readZstdRolloutLines()` decompresses it, and the byte-offset tail path is skipped for compressed files (seeking into a `.zst` produced a parse error on every line). Measured on the live database: rollout issues fell from 294 to 34, and a `.zst`-only conversation now returns 200 with 26 messages (3788 total) and zero parse errors. The remaining 34 are files Codex itself has deleted; no reader can recover them.

- A new conversation no longer offers the image picker: the first message of a conversation has to be text, so tapping `+` led straight to a rejected send with an English 409. The button is now disabled in a draft with a Chinese hint, and the send-side rejections a user can reach (`消息过长`, the new-conversation-with-images case) are Chinese too.

- The conversation status window no longer hides a running turn: status costs one rollout parse per row, so it is computed for the newest 120 conversations — a running conversation older than that reported `状态未知`. Rows that are (or claim to be) running are now always included, whatever their position.

- Third pass (1.17.6): a turn that only the database claims is running is no longer presented as plainly live.
  - Codex Desktop bumps `status_updated_ms` on a timer even after the process behind a turn is gone, so the server's own max-age guard never fired and a dead session read `运行中` indefinitely (observed: a frozen row 191 minutes old). The phone then offered 排队/插入 for a task that could never drain.
  - A `db`-sourced running/waiting override now has to be corroborated by the transcript; when nothing corroborates it the state is kept (so the phone never double-sends into a turn that might still be alive) but the API carries `staleTurn` and the UI says `运行中 · 长时间无输出` in both the drawer and the header pill. Live adapters are unaffected.
  - Verified on device: genuinely running sessions still read `stale=false`, only the frozen one is flagged.

- Second portrait pass (1.17.5), re-checked on the same 1080x1920 / 480dpi phone profile:
  - a conversation started from the phone never appeared in `GET /api/threads`: desktop-ipc conversations have no rollout file and no Desktop state row, so the chat vanished right after sending and the next refresh jumped back to an older thread. Such conversations are now remembered for 30 minutes and titled from the message;
  - two computers sharing one origin (the dual-dispatcher setup) shared a single status entry, so the second card stayed on `正在检测` forever; device state is now keyed by origin **and** access code (`DeviceIdentity`);
  - `styles.css` had a stray top-level declaration that made the CSS parser discard the whole `@media (max-width: 360px)` block — that is why 排队/插入 was clipped on a 360dp phone. Removed, plus a test that rejects stray declarations;
  - server-generated notices are Chinese now (they used to drop English blocks into a Chinese conversation), and an unsupported `set-active-conversation` is no longer reported as a warning on every phone-started chat;
  - the new-conversation placeholder no longer repeats the empty-state sentence.

- A phone-portrait pass, all of it verified on an emulator in portrait (1080x1920 @480dpi) instead of the forced-landscape car profile:
  - load/transport failures now render one Chinese sentence plus a `重试` button instead of a raw `Failed to fetch` / `HTTP 500` string (`friendlyErrorMessage` + `.empty-state-error`);
  - the thread list starts collapsed, and — the actual bug — the floating `☰` tab could not be tapped at all because the conversation header swallowed the hit; the toggle now lives inside the header, so the drawer is reachable again;
  - an empty conversation no longer repeats itself with a `0 条内容` pill next to the title;
  - `/index.html` is served with a `?v=<mtime-size>` stamp on every local CSS/JS reference, so an upgraded desktop can never hand a WebView a stale `app.js`;
  - `/api/threads` no longer 500s when `auth.json` is empty or half-written (the login rewrite used to take the whole conversation list down with `Unexpected end of JSON input`);
  - the device card is now at least 82dp tall with 12sp minimum text.
  - the model picker gained a `筛选模型` box (shown above 20 entries): PI ships 173 models and a flat native select meant scrolling; the active model always stays pinned at the top so the control can never display a model that is not the current one, and the term resets on every open/close;
  - the update dialog no longer prints a "最新版本" that is older than the installed one (it read `当前 1.17.4 / 最新 1.17.3 / 已是最新版本`), and `安装包时间` is parsed as the UTC instant it is instead of local time (was 8h behind).

- PI-Desktop new conversations now go through the bridge instead of falling back to the Codex CLI: the plugin's `start-conversation` handler had been lost in an earlier edit (only `initialize` survived). `/api/send` with `newThread` returns `mode: "desktop-ipc"`, the session is created in `pi.sqlite`, and the model picked in the app lands in `sessions.model_id` (verified: `deepseek-v4.1-flash`).
- The desktop console autostart task passes `--hidden`, so a login start goes straight to the tray with no window (verified `MainWindowHandle = 0`).

- Fix the PI model catalog emitting the template's slug for every entry: `...template` was spread before the generated `slug`, so all 173 models collapsed onto one id and model selection was meaningless. Catalog now has 173 distinct slugs and the default follows the latest PI session.

- The PI sidecar is started through `scripts/pidesk-sidecar-launcher.vbs` (wscript, window style 0) because a scheduled task that runs `node.exe` directly pops a visible console window. Every Turnloom background process must stay windowless.

- PI-Desktop devices now list the models configured in PI (providers × models, 173 entries) instead of the built-in Codex fallback list, and the default follows the most recently used PI session. A sidecar (`turnloom-pidesktop/pidesk-sidecar.mjs`, task `Turnloom PI Sidecar`) writes `model-catalogs/pidesk.json` + `config.toml` into the facade home.
- Thread status for PI-Desktop devices is real again: running turns from `pi.sqlite` are mirrored into the facade `threads.status_*` columns, so the app can show 运行中 instead of everything as 已完成. The sidecar re-applies them every 3s because the bridge rebuilds the table; the status cache now refreshes every 5s.
- The bridge plugin forwards the selected model/effort to PI (`provider/model` slug → `providerName`/`modelId`/`thinkingLevel`); effective after the next PI-Desktop restart.
- New sidebar sort mode 按文件夹: Codex sessions carry only a working directory, so they can be bucketed by folder when no project is assigned.
- CI: the `validateConfig` test now builds its own temp Codex home, so the Verify workflow stops failing (it had been red since v1.17.0).

## 1.17.2 - 2026-10-27

- Fix `ERR_TOO_MANY_REDIRECTS` in the Android workspace: an already-authorized `/?token=...` request was bounced through the login redirect while the dual dispatcher re-appended the access code, looping forever. The login hop now only runs for unauthorized requests, and the dispatcher only injects `?token=` on `/api/*`.
- Keep web navigation inside the app WebView. `shouldOverrideUrlLoading` handed every http/https URL to the system browser, which dropped the session and stranded the user outside the app.
- Show a real update dialog (current version, latest version, APK timestamp, status) instead of a bare download prompt, and stop the per-device "正在检查更新…" toast storm: the manual check queries every computer once and reports a single result; the automatic prompt fires at most once per app run.
- Serve `apkUpdatedAt` in `/api/health` so the phone can display when the installer was published.

## 1.17.1 - 2026-10-27

- The Android update check compared a hardcoded `APP_VERSION_CODE = 20` against the server version, so an up-to-date install prompted for an update forever. It now reads the installed package version, and download notification titles come from the same source.
- A saved computer without an access code opened the web login page. The app now asks for the code in a native dialog, stores it on the device, and opens the workspace directly.

## 1.17.0 - 2026-10-23

- Add short-lived HttpOnly session cookies: `/login?token=...` exchanges an access code for an 8-hour session, redirects to a query-free URL, and `/api/auth/logout` revokes it; `/api/auth/session` supports explicit exchange from the web client.
- Support multiple Codex homes in one `--profiles` file, with request-scoped `realpath`-aware home selection and per-home thread/account/rollout caches.
- Extend the HTTP backend contract with pin, goal, compact, branch, approval, queue cancel/steer and changes; account/plugins/skills return safe empty values without reading local Codex data.
- Add extra-device pairing to the tray console: register another Turnloom instance (for example the PI-Desktop bridge), probe its `/api/health`, and generate per-device pairing QRs; optional `ipcSocket` supports a single merged facade.
- Deduplicate junctioned Codex homes in the desktop setup wizard and document directory selection / PI-Desktop import boundaries.

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
- Deduplicate junctioned Codex homes in the setup wizard by canonical real path, so `C:\Users\<user>\.codex` and its `D:\codex\.codex` target appear as one choice.

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
