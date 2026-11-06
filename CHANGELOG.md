# Changelog

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
# Changelog

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
