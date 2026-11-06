# Changelog

## 1.17.31 - 2026-11-07

- **首页改为聊天工作台，电脑选择页不再日常抢占首页**：首次启动或没有活动电脑时才显示设备选择；`ACTIVE_DEVICE_URL_KEY` 保存后，下次启动直接打开聊天 WebView。系统返回在聊天页只后台化 App，不再跳转电脑列表；主动进入选择页时可取消并返回原电脑。
- **明显的大号「切换电脑」入口**：Android 原生顶栏把原来不显眼的 `‹` 图标换成带文字、44px 命中区的「切换电脑」按钮；「更多能力」里也加入同名按钮，经 `CodexPocket.showMachinePicker()` 调用原生选择页。主动切换保留当前活动电脑，取消/返回可继续聊天。
- **小扳手彻底移出顶栏**：旧 `#toolToggle` 从标题栏删除，工具/内部记录显示开关收进「更多」面板，带 44px 触控区、选中态和实时刷新；引导文案同步改为「需要时在更多里打开」。
- 细节回归：加载态无旧扳手占位、hidden 模型面板仍为 `display:none / 0 by 0`；CDP 真鼠标打开「更多」面板、命中 44px 切换电脑按钮、真鼠标切换工具开关、返回栈关闭面板并恢复消息列表/输入框命中。
- 契约回归：`test/ui-host-overlays.test.js` 20/20、`test/server.test.js` 100/100、Android Java 编译与单测、`npm run verify:ci`、Android APK 构建。
- 文档：新增 [`docs/MOBILE-BEFORE-AFTER-REPORT-2026-11-07.md`](docs/MOBILE-BEFORE-AFTER-REPORT-2026-11-07.md) 带图前后对比报告；真实历史截图 + CDP 盒模型/真鼠标证据，截图超时如实标注，不伪造图片。

## 1.17.30 - 2026-11-07

- **逐项审计后的剩余 feat 全部落地，不再用文案冒充完成**：真正“供应商 → 模型 → 思考强度”三级选择（供应商 chips 实际过滤模型、搜索跨供应商、当前模型/供应商写入会话草稿）；草稿文字/图片/插件/技能/模型/强度/供应商持久化到 localStorage，限制 30 个会话、1.5MB 与单图 300KB，pagehide/visibilitychange 保存，发送成功后清理。
- **网页分级返回栈**：聊天页为根，`hostSheet / modelPanel / goalEditDialog / threadContextMenu / imagePickerMenu / mention / plugin / skill / queueExpanded / sidebar` 逐层返回；Android 硬件返回由 `codexPocketHandleBack()` 统一消费，栈空才后台化。CDP 真鼠标验证：加载态 panel `hidden=true / display:none / 0 by 0`、中心命中 `#messageList`、输入框命中 `textarea`；真实点击打开 `display:flex / aria-expanded=true`；硬件返回后关闭且中心/输入框恢复。新增空模型目录时同步隐藏状态的回归，防止弹层被提前 return 钉住。
- **共享队列执行闭环**：复核宿主 asar / Rust host-core 后确认 `session.queuePush` / `agentQueuePush` 不在插件 `CONTROL_OPERATION_SPECS`，且 `agentQueueChanged` 来自宿主内部 onQueueChange，直接写 SQLite 不保证当前 Composer 即时 UI。因此保持 `turn_queue` 单一权威，由桥 `turnloom/queue/claim` 在 `BEGIN IMMEDIATE` 事务内原子出队、服务端安全 drain 调用真实 `sendToCodex()`；失败以原 id/幂等键写回并标记失败，避免双发/丢消息。`claim/state/retry` 均经 IPC 回归。
- **队列状态可见与审查项收口**：`model/effort/失败原因/下次重试时间/principal` 经会话 scratch sidecar 持久化；手机端折叠摘要显示“N 条 · 1 失败 / 连接中断”，展开显示错误、下次重试时间与显式「重试」按钮，`/api/queue/retry` 清失败并重调度；`nativeQueueRemove` 清空全部只清 `turnloom-mobile`；`SQLITE_BUSY` 指数退避；IPC 抖动保留上次已知队列且绝不写第二套影子队列。普通发送继续不触发 dangerous `configure`。
- **带图消息服务端持久回显**：桥在真实暂存 `turnloom-*.jpg` 成功后写原子、限量、无 base64/token 的 receipt；服务端 `/api/threads/:id/messages` 统一按 turnId / 文本 / 10 分钟窗口补 `/api/thread-image` 图片，严格限制会话 scratch 路径与图片扩展名，前端支持本地 URL 图片渲染；刷新/换设备不再只依赖客户端乐观状态。
- 回归：`test/server.test.js` 新增队列字段/抖动/路径安全/receipt 匹配与原子写入，`test/ui-host-overlays.test.js` 钉住三级选择、草稿、返回栈、hidden、失败重试与桥契约；六套桥测试 + `test-shared-queue-v2.cjs` 全绿；CDP 真鼠标/盒模型检定通过。

## 1.17.29 - 2026-11-06

- **P0：修复巨大模型选择窗口从加载起挡住整个手机界面**。上一轮在最后加载的 styles.app.css 里追加了 #shell .model-panel { display:flex }，却没有给 [hidden] 例外，正好复犯了项目记忆中的 hidden 遮罩事故。CDP 加载态实测：隐藏面板 display:flex、638×292、屏幕中心命中 #modelPanel，输入框被压到下方。现在最后一层强制 #shell [hidden] { display:none !important }，并显式列出 model-panel 等所有浮层；修复后加载态 display:none / 0×0，中心命中 #messageList，输入框中心命中 #composerInput。真实鼠标四步：加载隐藏 → 点模型按钮打开 → 再点关闭 → 输入框恢复可点，全部通过。新增 test/ui-host-overlays.test.js 契约，共 14/14。
- **P0：消除连续 PI-Desktop session/configure 原生确认框**。运行桥在每轮发送前调用 ensureSendableModel()，目标会话供应商被禁用时反复尝试危险模型切换，用户一拒绝又因 45 秒冷却/多次发送连续弹框。现在普通发送、插入、压缩一律不自动 configure，沿用会话当前模型直接 agent/prompt；模型切换只在显式调用 applyModelIfChanged() 时发生并保留 confirm:true / 拒绝中止 / 10 分钟冷却。桥测试改为新契约：普通发送绝不触发 configure；显式切换仍验证 confirm:true、拒绝不 prompt、冷却内不连弹。桥源码 / 安装目录 / 仓库快照哈希一致，六套桥测试全绿。
- 说明：安装插件文件不等于 PI 宿主运行时已加载；dev watcher 本次没有产生新的 reload 记录，因此桥修复需要用户在 PI 插件页手动重载 cn.star.turnloom-bridge（或下次启动 PI）才完全生效。没有强杀 PI 主程序，也没有伪称运行时已重载。

## 1.17.28 - 2026-11-06

- **逐步修复用户连续反馈的核心链路**：带图发送后消息气泡不再丢图。现网证据显示桥的 agent/prompt 已成功把图片落到会话 scratch，但宿主 rollout 先写纯文本消息；旧 reconcilePendingMessages() 仅凭文本匹配就删掉带图乐观气泡，造成「实际发送没图」。现在纯文本 rollout 会继承待发图片，直到宿主自己也返回图片；新增 Node 24/22 回归。发送确认超时但宿主已开始 turn、返回 accepted 或 turnId 时，不再误标未发送，避免手动重发造成重复。
- **共享队列不再顶满屏**：默认折叠成 40px 一行摘要，仅显示条数与优先顺序；点摘要才展开逐条预览、图片和操作，展开态限高滚动并记住选择。键盘态保留这一行，不再把状态条整体隐藏。CDP 注入 3 条队列：默认条高 40px、列表隐藏、发送键底边 407 仍在 420px 可视区内；真实点击展开按钮后 aria-expanded=true 且 is-expanded 生效。
- **设备选择页退出日常返回栈**：Android 用 SharedPreferences 记住上次电脑，开机直接进入聊天；系统返回未由网页消费时后台化 App，不再跳电脑选择页。电脑列表只在首次配置或点击顶部「切换电脑」时出现。
- **会话状态隔离与模型恢复**：切换会话时按 threadId 保存/恢复文字、图片、插件、技能、模型、强度；切换后重新读 thread.model，避免草稿模型覆盖会话原本模型。/api/threads 实测每个会话都带 model 字段。
- **模型面板与输入区视觉**：新增「供应商 / 模型 → 思考强度」分段标题；「仅文字」标记用 grid 固定到右侧，不再歪斜；键盘态强度 chips 始终可见；附件 / @ / 发送 / 停止统一 40–44px 命中区。CDP 大字 + 键盘 + 420px 可视高实测：分段标题、强度 chips、能力标记均在可视区，附件 40×44、@ 44×44、模型 128×40、发送 44×44、composer 底边 420。
- 新增/扩展回归：test/server.test.js 带图乐观消息不被误删；test/ui-host-overlays.test.js 队列折叠、会话草稿隔离、模型/输入区结构，共 13/13。Android 导航改动通过 gradle testDebugUnitTest。版本 1.17.28(49)。

## 1.17.27 - 2026-11-06

- **修复真机截图里的三个 UI 缺陷**：① 大字 + 键盘态下「2 疑似停滞 · 1 运行中」状态徽标压住会话工具栏并裁掉消息区；现在徽标移到标题栏下方的独立状态行，标题与工具栏保持单行、`更多` 不再竖排，状态行无内容时完全隐藏。② 先上传图片、再输入文字时，键盘态 CSS 无条件 `display:none` 把附件托盘藏掉；现在 composer 带 `has-attachments` 标记，图片缩略图固定显示在输入框上方并可横向滚动，输入文字不会让图片消失。③ 模型条把 `cn:hy4 最大` 裸 slug 显示在透明无边框区域；现在改为带浅色描边的主名胶囊 + 独立思考强度徽标，slug 映射为友好名，完整模型/供应商名保留在 tooltip 与 aria-label。
- 真机等效复验（静态预览 + CDP 盒模型 + 截图）：可视高度 420px、大字 + 键盘 + 有附件 + 输入文字时，状态行 y=55 与工具栏 y=4 不重叠，图片缩略图 y=238 可见 52×52，模型胶囊 y=365 高 40，发送键 y=363–407 仍在可视区内。截图 `browser-screenshot-1793949426170.jpg`。
- `test/ui-host-overlays.test.js` 新增 3 项契约：状态行独立/隐藏、键盘态附件可见、模型卡片样式与友好名。Node 24/22 全量测试 155/155、`0 fail / 0 cancelled`，`npm run verify:ci PASS`。版本 1.17.27(48)。


## 1.17.26 - 2026-11-06

- **修复 GitHub Actions 连续失败与失败邮件轰炸**：复盘最近 40 次运行后发现 11 月起每次 `main` push 的 `Verify / server` 都在 `npm test` 失败，Android job 一直成功。根因不是产品代码，而是 `test/server.test.js` 中 `.jsonl.zst` 测试的 `finally` 被插错位置，导致后续 6 个 UI 契约测试被嵌套进异步父测试；CI 的 Node 22 把它们判为 `cancelledByParent`，本地 Node 24 因调度时序不同而显示全绿。这条结构错误自 `da6a7d2` 起持续存在，之后每次新提交都重复同一封失败邮件。
- 把 `rmSync` / `finally` / `});` 移回 zst 测试内部，恢复所有被吞入的测试为顶层；Node 22.23.4 与本地 Node 24 完整测试均为 152/152、`0 fail / 0 cancelled`。用故障注入把旧结构还原后，Node 22 能重新复现 `fail 1 / cancelled 5`，证明门禁确实能挡住复发。
- 工作流收窄为仅 `main`、指向 `main` 的 PR 与手动触发，忽略 tag；同分支新 push 通过 `concurrency.cancel-in-progress` 取消过时运行，避免同一提交/旧提交继续贡献失败通知。`server` job 固定到 Node 22.23.4，显式检查 TAP 的 `# fail` 与 `# cancelled` 都为 0，并补跑 `desktop:check`。
- 新增 `scripts/verify-ci.mjs` 与 `npm run verify:ci`：语法检查、当前 Node 与 CI Node 22 双版本完整测试、`npm run check`、`npm run desktop:check`，并要求两个 Node 版本都输出 `0 fail / 0 cancelled`。以后 push 前必须先跑这个命令，不能只信开发者机器上的 Node 版本。
## 1.17.25 - 2026-11-06

- **修复点击任务栏控制台提示「启动失败：端口 8787 已被 node.exe (PID 18008) 占用」**：旧控制台启动时只检查端口空闲，没有识别由 `Codex-Turnloom Link Watchdog` 在登录时拉起的健康分发器。现在 `ServiceController.start()` 先带正确访问码请求 `/api/health`；`ok:true` 即复用外部服务并记录真实 PID，绝不重复 spawn。只有健康探测失败且端口仍被占用时，才保留原来的端口占用错误。
- 控制台同时复用守护已建立的同一条 SSH 隧道（按 `127.0.0.1:18786:127.0.0.1:8787` 精确匹配），不再重复拉起 ssh.exe；守护托管的服务与隧道在「停止 / 退出 / 重启」时只解除控制台显示，不会 `taskkill` 掉 8787、两个后端或公网入口。界面文案改为「断开显示 / 重新检查服务 / 守护运行」，不再虚假承诺退出会停服务。
- 修复后的控制台状态显示 `managed:false, external:true`，健康巡检与进程指标继续工作；`--smoke-test` 会等待完整启动链并输出服务/隧道状态到可选文件。新增 `test/desktop-console-reuse.test.cjs`：覆盖健康复用、先健康后端口、不健康占用仍报错、外部服务不可被误杀、隧道复用、运行时状态和文案契约。
- 实测：独立 Electron smoke-test `state=running`、`service.pid=18008/external=true`、`tunnel.pid=18304/external=true`、`lastError=null`；重启用户实际点击的 `dist-desktop\win-unpacked\Codex-Turnloom Console.exe` 后日志写入「复用已运行的健康服务」与「复用已建立的 SSH 隧道」；8787/18788/8799 和公网仍健康，watchdog 4/4 healthy，无可见 node 窗口。版本 1.17.25(46)。

## 1.17.24 - 2026-11-06

- **修复开机弹出 node 黑框**（会话间任务投诉）：旧的 `Codex-Turnloom Link Watchdog` 登录自启直接 Exec `node.exe ... --loop`；node.exe 是控制台程序，`Settings.Hidden=true` 只隐藏任务本身，仍会创建可见控制台 + conhost（实测 PID 10480，开机 10:00:27，窗口 255,247–1248,766）。违反全局 `AGENTS.md` 的 User Notification Preference。
- 新增 `scripts/link-watchdog-launcher.vbs`：全链路无窗口 `Task Scheduler → wscript.exe //B //Nologo → WScript.Shell.Run(command, 0, False) → cmd /d /s /c node.exe --loop`，stdout/stderr 重定向到 `%LOCALAPPDATA%\CodexPocket\logs\watchdog-out.log` / `watchdog-err.log`。
- `scripts/link-watchdog.mjs --install` 改为先 `Stop-ScheduledTask` 再 `Register-ScheduledTask -Force` 注册唯一 wscript 动作；`--uninstall` 先停后注销。守护逻辑（每 10 秒带鉴权 HTTP 4/4 健康检查、挂谁重启谁）完全保留。
- 实测：新任务 XML `Command=C:\WINDOWS\System32\wscript.exe`、`Arguments=//B //Nologo "…link-watchdog-launcher.vbs"`、Actions=1；启动后 watchdog node 进程存在但**无可见 MainWindow / conhost**；`watchdog-out.log` 有启动记录、`watchdog-err.log` 为空；`watchdog.log` 每 10 秒 4/4 healthy；杀掉 18788 (pid 18032) 后 20 秒内监听恢复、health 200。
- 项目记忆 `AGENTS.md`「二·补、离线/守护」补写「登录自启必须走无窗口启动器链，直接跑 node.exe 会弹黑框」；回归测试钉住 install/uninstall 与 VBS 启动链。版本 1.17.24(45)。
## 1.17.23 - 2026-11-05

- **独立视觉 + 新手易用性检定**（用户要求再独立跑一轮）：两个专职检定员因 PI 未配置其绑定模型无法启动，已如实说明并由主会话亲自分两轮完成；报告见 `docs/UX-AUDIT-2026-11-05-ROUND2.md`。视觉 4.7/5、新手任务 11/11、阻塞 0。
- 视觉检定发现并修复 **1 个严重缺陷**：大字 + 键盘态（可视 420px）下发送键被推到 y=708 之外。现在 `html.keyboard-open #shell` 固定到 `--app-visible-height`、conversation 改 flex 列、composer `margin-top:auto`；修复后发送键 y=407，输入区与停止键都可见。`test/ui-host-overlays.test.js` 新增键盘态契约断言。
- 新手检定发现「更多能力」只有图标、会话操作依赖隐藏长按：顶栏按钮补「更多」文字，会话列表每项新增显式「⋯」操作按钮，真实鼠标点击打开 11 项菜单；长按/右键仍保留。
- 其余非严重改进项如实记录：标题栏运行状态像按钮但不可点、会话菜单偏高、模型面板思考强度需滚动、已移除会话缺搜索/分组；未虚假标记为已修。
- 141/141 Node 测试；版本 1.17.23(44)。
## 1.17.22 - 2026-11-05

- **修复「整页点不了」的致命回归**（用户真机截图反馈）：新增的「更多能力」面板 HTML 带 `hidden`，但 `#shell .host-sheet { display:flex }` 覆盖了浏览器对 `[hidden]` 的 `display:none`，导致页面一加载就被全屏半透明 backdrop 盖住，所有点击都被吃掉。现在用 `[hidden] { display:none !important }` + `:not([hidden]) { display:flex }` 钉死，并给审批横幅、会话菜单、目标弹层、应用内确认层加同类保护。
- **修复「面板打开后字几乎看不见」**（同轮真机截图）：卡片用深色背景却 `color:inherit` 继承浅色主题的深色文字。改为显式高对比度前景 `#f4f6fb` / 卡片底 `#171a21` / 列表项 `#222733`，不再依赖 `color-mix`。
- **修复大文件预览卡住 WebView**：`fs/read` 原先一次性渲染 200 KB 文本，实测打开 `app.js` 后几乎无响应；客户端改为最多渲染 12 KB，`<pre>` 加 `contain:content` 与 `max-height:46vh`。
- 新增 `test/ui-host-overlays.test.js`（5 项）：钉住 `[hidden]` 隐藏契约、对比度、文本上限、8 个工具按钮/处理函数、会话菜单 8 个动作与软删除入口，防止复发。Node 测试 139/139。
- **全量真实指针验收**（CDP `Input.dispatchMouseEvent` press/release，非 DOM `.click()`）：打开「更多能力」→ 8 个入口逐个点通 → 目录滚动后真实点击进入 `public/` → 文件预览 → 关闭按钮 → 关闭后主页面再点开；每一步记录行数/标题/命中元素并截图。版本 1.17.22(43)。
## 1.17.21 - 2026-11-05

- **手机端补齐 PI 宿主能力**（用户要求「全部实施，直到所有功能落地」）：桥新增统一白名单宿主调用层 `turnloom/host/invoke`，把 PI 的只读能力（会话、文件、改动、用量、通知、定时任务、技能/命令、子代理、MCP、插件、供应商、浏览器、设置）与少量写能力（重命名、打开会话、移动项目、压缩、刷新模型目录、更新检查、标记已读）开放给手机；危险操作（删除会话、改会话模型/权限、批准计划、应答权限与提问、写 AGENTS.md、扩展交互）必须由手机用户二次确认后才带 `confirm:true` 下发，宿主仍会弹原生确认框。
- **审批**：读取 PI 的 `plan_approvals`（Plan/Goal 审批）并在会话顶部渲染审批卡，可选「逐次询问 / 允许改文件 / 自动执行」后批准或拒绝；按宿主契约分别走 `plans/resolve`、`tool/resolvePermission`、`agent/askTool/resolve`。旧桥曾把 `*approval*` 兜底成 `{ok:true}`，服务端现在用响应形状识别这种假成功并提示重载，不会静默丢审批。
- **目标与待办**：新增 `turnloom/todos`，手机端可看会话的真实待办（`session_todo`）；`thread-follower-compact-thread` 从「只回 ok」改为真正调用宿主 `agent/compact`。
- **会话管理**：长按会话菜单新增重命名、压缩上下文、查看用量、文件与改动、历史版本、在桌面打开、删除会话。
- **文件与改动**：新增文件浏览（`fs/list`）、文本预览（`fs/read`，200 KB 截断）、图片（`fs/readImageDataUrl`）与 `workspace/diff`，都限定在会话工作区与 scratch 内。
- **更多能力面板**：通知（含未读数与全部已读）、定时任务、技能与斜杠命令（点选插入输入框）、供应商与模型、桌面浏览器状态。
- 桥未重载时，手机端不再收到 500，而是 `503` + 明确指引（插件页重载 `cn.star.turnloom-bridge`）；服务端与桥各自维护危险操作白名单，纵深防御。
- 修掉一个会让整块能力全空的路径 bug：宿主进程里 `APPDATA` 可能为空，插件回落到 `~/.pi-desktop/pi.sqlite`，而该路径曾被 `DatabaseSync` 顺手创建成 0 字节空库，于是审批/待办/通知全部「表不存在」。现在按多平台标准位置读 `storage-location.json`，只接受「存在且非空」的数据库，写库前也拒绝空库；手机端「文件与改动」在没有绑定工作区的会话上给出明确提示而不是 502 原文。`n- **手机端删除不再依赖桌面确认**（用户实测反馈「删除会弹桌面弹窗，人不在电脑前就删不掉」）：宿主的 `session/delete` 是 dangerous，一调用就在桌面弹原生确认框。现在手机端默认「从列表移除（可恢复）」——只写 PI 的 `sessions.deleted_at`（PI 自己的删除语义），数据与 rollout 全部保留，立刻从两端列表消失，不需要桌面确认；撤销入口在「更多能力 → 已移除的会话」，一键恢复。真正不可逆的「彻底删除」仍保留为次要入口，走宿主 `session/delete`（桌面确认），不会被静默执行。
- 「更多能力」新增「文件与改动」「本会话用量」直达入口（对当前打开的会话生效），不再只能从长按菜单进入。
- 回归：新增 `test-host-capabilities.cjs`（18 项：白名单拒绝、危险确认、三类审批契约、待办/通知/定时/用量真实取数）；Node 测试 134/134，桥六套全绿；版本 1.17.21(42)。

## 1.17.20 - 2026-11-05

- **修复「手机端发图失败，之后普通消息也全部失败，一张图拖垮整个会话」**（用户实测截图 `发送失败：No provider configured`）：根因不在图片上传，而在模型切换。手机端每轮都带模型 slug，桥接插件据此调用 PI 宿主的 `session/configure` 切换模型，但宿主把它标记为 dangerous、要求 `confirm=true`；旧代码既没带该字段，还把拒绝吞掉继续 `agent/prompt`，宿主随即用失效的 provider/model 启动轮次并抛 `No provider configured`，之后每条普通消息重复同一条坏路径。
- 桥改为按宿主契约发起切换：`desktop.invoke({ operation, args, confirm: true })`，仍由 PI 原生确认框授权；**切换被拒就中止本轮并回传明确原因，绝不再继续 prompt**，从根上切断级联污染。失败缓存改为 45 秒冷却，避免一次失败永久封锁会话。
- 新增发送前模型闸门：按「手机端所选模型 → 会话当前模型 → 该会话最近一次成功轮次 → 供应商默认模型」依次挑选确定可用的 `(providerId, modelId)`；会话本身已被写成失效组合时自动修复，一个可用模型都没有就明确报错、不发送。
- 模型能力透出：能力以供应商 `config_json.models[].supportsImages` 为准、`models.capabilities_json` 兜底（真机上后者常是过时的 `["text"]`，只看它会误拦本来能用的多模态模型），写进 Codex 模型目录的 `input_modalities` / `supports_images`；`/api/health.models` 暴露 `supportsImages`，手机端在模型列表标注「仅文字」，带图发送前直接提示切换模型，服务端 `sendToCodex` 同样返回 409，防止旧客户端绕过。
- 共享候发队列的瞬时不可用不再表现为「队列凭空清空」：`queueError` / `queueUnavailable` 在队列栏可见，并说明「本次消息未写入第二份队列」。
- 桥回归测试重写为 26 项模型路由断言（含「configure 被拒后绝不 prompt」「坏会话自动修复」「confirm:true 契约」「无可用模型明确拒绝」），附件测试改为隔离数据库；Node 测试 133/133、桥五套全绿，版本 1.17.20(41)。

## 1.17.19 - 2026-11-05

- **手机端与 PI 桌面端共用一份候发队列**（用户实测反馈「手机排队，桌面端看不见，先后顺序混乱」）：定位到旧链路把手机消息写进 `%LOCALAPPDATA%\CodexPocket\pending-queues.json`，而 PI 桌面端维护 `pi.sqlite` 的 `turn_queue` 和自己的内存队列，两套队列互相不可见。现在桥接插件暴露 `turnloom/queue/push|list|remove|steer`，直接读写 PI 权威 `turn_queue`；Turnloom 的 PI 设备不再创建影子队列，也不再由自己 drain，手机端队列栏显示 PI 的 `position/priority`，顺序规则为普通项按 position FIFO，显式「设为优先」项由 PI priority 提前。
- 手机端队列文案改为「共享候发队列 · 与 PI 桌面端同一顺序（#1 先发）」；每条显示权威序号与「优先发送」标记。重复排队由 `clientRequestId/idempotencyKey` 去重；编辑、取消、设为优先都转发到同一队列。
- 桥接插件在同步门面时把 `turn_queue` 纳入签名，并把排队消息写进会话 rollout，手机端和桥的缓存能及时看到队列变化；新增 `test-shared-queue.cjs` 覆盖「桌面先排 → 手机后排 → 重复请求去重 → 设为优先 → 取消/清空 → IPC 门面」。
- 兼容旧桥：PI 插件尚未重载时，服务端识别 `unsupported method: turnloom/queue/*` 并自动退回旧本地队列，保证排队、取消、插入不会变成 500；插件重载后自动启用共享队列。Codex 独立设备仍沿用原有本地队列，不受影响。
- 127 项 Node 测试、桥四套回归与共享队列测试通过；版本 1.17.19(40)。

## 1.17.18 - 2026-11-05

- **修复 App 更新提示「下载失败，无法更新」**（用户实测反馈）：旧链路把 APK 交给系统 `DownloadManager` 下载到公共 `Download` 目录；在 Android 10+ 分区存储、反向代理/自签 HTTPS、重定向丢失自定义请求头等场景下，系统下载服务会独立失败，而健康检查却正常。现在改为 App 内用与 `/api/health` 完全相同的 `HttpURLConnection` 下载到应用私有目录：访问码同时走 `x-access-token` 请求头与 `token` 查询参数，响应校验 HTTP 状态、`Content-Length` 与 APK ZIP 魔数，避免把登录页当作安装包；下载成功后通过 `FileProvider` 的 `content://` URI 调用系统安装器。整条链路不再依赖存储权限、系统下载服务或下载完成广播。
- 新增 `UpdateDownload` 纯逻辑单测：覆盖 token 查询参数编码、已有 token 不重复、HTML 登录页拒绝、下载长度校验；Android 编译与单测通过。
- 版本 1.17.18(39)。


## 1.17.17 - 2026-11-05

- **适配系统全局字体放大**（用户实测反馈）：Android 原来 `setTextZoom(100)` 直接屏蔽系统字号；现在按 `fontScale` 夹在 100–150% 跟随系统，Web 层检测根字号给 `<html>` 加 `large-text`。CSS 去掉危险 `nowrap/ellipsis`、标题/品牌名/模型名允许折行、命中区改 `min-height:max(44px,2.8em)`、状态总览在大字下切两列、顶栏/输入区设占比上限且主内容区保持可滚。100/125/150% 三档实测 0 截断、0 横向溢出；与键盘态组合（390×400 / 360×360 / 320×300）发送键仍可见。
- **疑似停滞不再逐条提示**：从每行状态文案和标题栏移除「长时间无输出」，改成列表顶部唯一的「需要关注」置顶分组（待处理 / 疑似停滞），**按项目与按最近两种模式都生效**，永远展开、不与其他分组重复。全局总览的「疑似停滞」计数保留作为入口。
- 126 项测试 ×3 次稳定、Android 编译通过；版本 1.17.17(38)。


## 1.17.16 - 2026-11-05

- **修复 App 内更新「下载完却装不上」**：`updateDownloadReceiver` 原来把 `DownloadManager.COLUMN_LOCAL_URI`（Android 7+ 多为 `file://`）直接交给 `ACTION_VIEW`，会触发 `FileUriExposedException`；`installApk` 也没有 `REQUEST_INSTALL_PACKAGES` 对应的安装 action。现在改用 `DownloadManager.getUriForDownloadedFile(id)` 拿 `content://`，配 `ACTION_INSTALL_PACKAGE` + `FLAG_GRANT_READ_URI_PERMISSION`，失败再回退 `ACTION_VIEW`。
- 复核更新链路：健康接口 `appVersionCode/apkAvailable/apkUrl` 正常，公网 `/api/apk` 带设备访问码返回 200（3.4MB 新包），App「检查更新」→ 下载 → 系统安装界面闭环。
- 30 个本地提交已推送到 `origin/main`。


## 1.17.15 - 2026-11-05

- **修复软键盘遮挡输入框/发送键**（用户实测反馈）：Android WebView 在 `adjustResize` 下不保证同步更新 `100dvh`，老内核尤其明显。新增 `syncVisualViewport()`，用 `visualViewport.height` 把 `#shell` 钉到可视高度并写 `--app-visible-height`，键盘态给 `<html>` 加 `keyboard-open`；CSS 收紧顶栏/输入舱、隐藏排队条与附属行，composer 从 201px 压到 121px。
- 矮窗口实测 390×400 / 360×360 / 320×300：输入框与发送键均 44px、发送键始终在可视区内、composer 底部恰等于可视区底部、消息区仍可滚（132–232px），0 JS 错误、0 横向溢出、0 个 <44px 控件。
- 新增键盘态回归测试（125 项全过 ×3 次稳定）；`docs/ROADMAP-2026-11-05.md` 记录能力盘点、竞品差距与发展方向。


## 1.17.14 - 2026-11-05

- **会话状态全局可见**（用户反馈「在外面看不见哪些在跑、哪些完成、哪些要决策/停滞」）：抽屉顶部新增状态总览（待处理 / 运行中 / 疑似停滞 / 已完成 计数，点击即筛选）；主标题栏常驻徽标，抽屉关着也能看到「1 疑似停滞 · 1 运行中」，点它会打开抽屉并跳到最需要处理的那一类。
- **每条会话左侧彩色状态条**：绿色运行中、橙色疑似停滞、红色需决策、灰色已完成、虚线未知；「未知」不再隐藏。状态文案按类别上色，需决策/停滞的标题加粗。
- **「按最近」不再纯按时间**：待处理 > 疑似停滞 > 运行中置顶，其余才按更新时间，避免卡住的任务被一堆刚结束的会话挤到下面。
- 统一状态分类口径 `threadStatusKind / threadStatusCounts`（threads.js），列表、总览、筛选共用一套判定；新增 3 条回归测试，124 项测试通过。
- 四档视口（320/360/390/430）实测：0 JS 错误、0 横向溢出、0 个控件小于 44px。


## 1.17.13 - 2026-11-05

- **消掉「浏览器感」的根因**：WebView 默认允许长按选词、系统复制把手，JS 的 `alert/confirm` 走安卓系统对话框。现在原生层 `setLongClickable(false)` + 拦 `ActionMode` + 覆写 `onJsAlert/Confirm/Prompt`，Web 层默认全站 `user-select:none`（只有主动点「选择文字」才放开），确认框改成应用内弹层。
- **模型面板重做**：供应商自动发现的 240 个模型不再一上来全平铺。`/api/health` 下发这台电脑真实用过的模型，前端按显示名去重后默认只列 15 个常用项，支持「显示全部」与按模型/供应商搜索；原生 `<select>` 换成应用内列表和思考强度分段按钮。
- **搜索**：搜索时强制展开所有分组（含手动折叠过的），无结果显示明确提示，`type=search` 自带清除。
- **打断**：修复「点完按钮立刻消失、看不到任何反馈」。现在保持停止中态、按钮脉冲提示、带 `expectedTurnId` 请求，服务端确认后才切到已停止；失败恢复原状态并给出中文原因。
- 四档视口（320/360/390/430）实测 0 JS 错误、0 横向溢出、0 个控件小于 44px；118 项服务端测试 + 18 项 Android 单测通过。

## 1.17.12 - 2026-10-30

- 消息**一键复制**：手机上复制一段回答原本只能长按选择文本（WebView 里容易误触）。复制按钮与「从此处分支」同排、44px 高，走三层兜底——Android 原生剪贴板（`CodexPocket.copyText`，不依赖安全上下文与用户手势）→ `navigator.clipboard` → `document.execCommand("copy")`。网页侧实测 41 条消息渲染出 38 个复制按钮（仅 user/assistant）；真机剪贴板写入待复验。
- PI 桥接层返回的消息**没有 id**（`data-message-id=""`），而 `renderBranchAction()` 依赖 id，所以既有的「从此处分支」在 PI 会话里**从来不出现**。复制按钮改为按渲染下标定位，不再依赖 id；分支按钮的同一问题记入能力审查待办。
- **控制台开机自启不再弹窗**：`second-instance` 原先无条件 `showWindow()`，而应用有**两个自启入口**（计划任务 + 注册表 Run 键，`applyLoginItem()` 从不清理后者）。现在带 `--hidden` 的重复启动不再抬窗，且计划任务存在时清理遗留 Run 键。已重新打包，实测全部控制台进程 `MainWindowHandle = 0`、Run 键已清除。

## 1.17.11 - 2026-10-29
- 真机复查（360dp）后修掉三处遗留观感问题：「思考中」后面跟着一个实心橙色方块（遗留样式给动画点盒填了 `background: var(--running)`，已置为 `background: none`）；空输入框按两行高度占位（`rows="2"` → `rows="1"`）；排队/插入控件居中悬浮（`.composer` 实际是 grid，`align-self` 无效且被自动外边距居中，改用 `justify-self: start` + `margin: 0`，实测与输入框左边缘同为 x=372）。
- 修复 `styles.v3.css` 拿不到缓存失效指纹：服务端按 `"/styles.v3.css"` 精确匹配后追加 `?v=mtime-size`，而我在该 link 上写死了 `?v=1.17.10`，导致正则（排除 `?`）跳过它，样式被永久钉在同一个 URL 上，之后每次改样式都可能被浏览器/WebView 缓存挡住。现已改为裸引用，服务端正常加戳（`?v=mvtbpcne-v9e`）；并补测试要求 index.html 里的本地 css/js 引用一律不带查询串。

- **修复会话永久停在「加载中」**（手机上的主诉）：`codexHomeVersion` 在一个会话运行时每次写入都会自增，而 `applyHomeContext()` 把它当成"换了主目录"，于是每 3 秒的列表同步都会清空正在阅读的会话；该同步只刷新列表、不重载消息，列表就再也没恢复。现在只有主目录路径真正变化才重置视图（消息缓存键本就带版本号，仍会失效），并且同步后发现消息被清空会自动补载。实测：连续 18 秒 13 次采样，消息稳定在 41 条，不再被清空（修复前约 3.4 秒必挂）。
- `/api/health` 与 `/api/threads` 补上请求超时（15s / 20s）。此前只有消息接口有上限，连接一卡首屏就会无声地永久停在「加载中」，既没有错误也没有重试入口。
- 时长显示统一为一种格式（`12分46秒`）。此前同一概念有 `01:45`、`1分45秒`、`1m8s` 三种写法；无时长时不再留下孤立的「耗时 ·」。
- 连续同一发言人的消息只显示一次作者名（41 条消息的作者名从 41 个降到 12 个），每条仍保留时间与耗时。
- 思考中卡片由两行 71px 收敛为单行 48px，运行时间移到角色行，与顶部状态胶囊不再重复。
- 模型名不再被切掉半个字（可用宽度 118px / 需要 121px）：收窄模型按钮的内边距，完整「模型 · 服务商」放进提示。
- 排队/插入控制由整行铺满（426px）改为左侧胶囊（248px）。
- 加载态不再套用空状态的大 logo，改为小转圈；空状态改为在消息区垂直居中。
- 引导弹层打开时聚焦弹层本身而非主按钮，消除主按钮上那圈看起来像双边框的聚焦环；主按钮聚焦环统一为设计系统颜色。


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
