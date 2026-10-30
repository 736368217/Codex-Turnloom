# 手机端能力审查（2026-10-30）

范围：`Codex-Turnloom` 手机端（Android WebView 外壳 + Node 后端 + PI 桥接插件）。
结论基于当前源码与实际接口实测，不基于预期。

## 一、已打通、可用的能力

| 能力 | 入口 | 后端接口 |
| --- | --- | --- |
| 会话列表 / 分组 / 排序（项目·文件夹·最近） | 抽屉 | `GET /api/threads` |
| 会话搜索（按标题） | 抽屉搜索框 | 同上（前端过滤） |
| 会话置顶 | 长按会话 → 菜单 | `POST /api/threads/:id/pin` |
| 会话内消息（含分页、历史） | 会话详情 | `GET /api/threads/:id/messages` |
| 实时变更推送（长轮询） | 自动 | `GET /api/threads/:id/changes` |
| 发送文字 / 图片 / 任意文件 | 输入区 `+` | `POST /api/send` |
| 新建会话 | 抽屉「新对话」 | `POST /api/new-thread` |
| 选择模型与思考强度（含筛选） | 输入区模型按钮 | `/api/health.models` |
| 引用插件 / 技能（含内置压缩、目标） | 输入区 `/` 与两个按钮 | `GET /api/plugins` · `/api/skills` |
| 停止当前任务 | 输入区停止键 | `POST /api/interrupt` |
| 排队（完成后发）/ 插入（立即打断） | 运行中切换 | `POST /api/queue/steer` |
| 队列取消、队列图片预览 | 队列条 | `POST /api/queue/cancel` · `GET /api/queue/image` |
| 从消息处分支 | 消息下方按钮 | `POST /api/threads/:id/branch` |
| 上下文压缩 | `/` → 内置「压缩」 | `POST /api/threads/:id/compact` |
| 目标（查看/编辑/暂停/清除） | 标题下目标条 | `GET/PUT/DELETE /api/threads/:id/goal` |
| 审批 / 需要操作 | 交互卡片 | `POST /api/approval` |
| 工具记录开关；系统/开发者指令随开关 | 标题栏工具键 | 前端 |
| 多设备管理、二维码/手动添加、在线状态 | 原生首页 | `/api/adapters/status` |
| 更新检查与 APK 下载 | 原生顶栏 | `GET /api/health` · `/api/apk` |
| 会话提醒（手动设时间） | 长按会话 → 菜单 | 原生 `REMINDERS_KEY` |
| 图片/文件从本机读取 | 消息内引用 | `GET /api/local-image` · `/api/local-file` |

## 二、实测缺口

### 1（重要）PI-Desktop 设备上「压缩 / 审批 / 目标」是空操作

桥接插件 `turnloom-pidesktop/plugin/main.js` 的实际实现：

- `thread-follower-compact-thread` → `return { ok: true }`（不做任何压缩）
- `method.includes("approval")` → `return { ok: true }`（不提交审批）
- `thread/goal/get`、`thread/goal/set` → `return { goal: null }`（目标永远为空）

而 App 照常显示这些入口。后果：**PI 会话里点「压缩」不会有反应；如果 PI 侧出现需要批准的操作，手机点了「批准」也不会真正批准**——这是"用手机控制本机软件"最关键的一环。

建议（按代价从低到高）：
1. 桥接插件把真实能力写成一个文件（例如 facade home 下的 `capabilities.json`），后端并入 `/api/health.capabilities`，App 据此隐藏或置灰目标条、压缩项、审批按钮，并在卡片上说明「该设备不支持」。
2. 若 PI 宿主 API 提供压缩/审批方法，则在插件里接到 `invokeHost(...)`；`/api/health` 返回的能力位随之为 true。

### 2（重要）没有「任务完成 / 等待审批」的自动通知

原生侧只有：下载完成通知（`DownloadManager`）、以及通知点击的深链处理；旧的后台监控通知渠道 `codex-pocket-monitor` 已被 `clearLegacyReminderNotification()` 主动删除。提醒是"按会话手动设置"的，不是"跑完了告诉我"。

对"手机盯电脑跑任务"这个核心场景，缺自动通知意味着必须一直开着页面看。建议：后端在会话状态从 `running` 变为结束、或 `interactionRequired` 变为 true 时，让已配对的设备收到一条推送（可用 FCM/自建长连接；无外网时至少做前台通知）。

### 3 账号 / 用量是死代码

`public/app.js` 里声明了 `state.account`、`accountExpanded`，但全仓搜索没有任何赋值处，也没有对应的 DOM 元素；`/api/account` 虽然存在却没有界面使用。
建议：在抽屉页脚或标题区显示当前账号与剩余额度（Rate limit），这对移动端很实用。

### 4 缺少「复制消息」

手机上要复制一段回答只能长按选择文本，WebView 里容易误触。IM 惯例是一键复制。建议在消息悬停/长按菜单加「复制」。

### 5 会话内搜索缺失

抽屉搜索只匹配会话标题。长会话里定位一句话只能一直滚。建议：会话内 `Cmd/Ctrl+F` 式搜索，或在会话头部加搜索入口，命中后跳转并高亮。

### 6 模型目录规模

PI 侧 `/api/health.models` 实测返回 **861** 个模型，Codex 侧 10 个。已有筛选框与固定当前项，但 861 条仍难浏览。建议：分组（按 provider）+ 最近使用置顶。

## 三、本次已修复

1. 思考指示器渲染成**实心橙色方块**：遗留样式 `.thinking-dots::after { background: var(--running) }` 把 1.5em 宽的盒子整块填色。已在设计层置为 `background: none`。
2. 空输入框按 `rows="2"` 占两行高度：改为 `rows="1"`，空态更紧凑。
3. 排队/插入控件**居中悬浮**：`.composer` 实际是 grid（不是 flex），`align-self` 无效且被自动外边距居中。改为 `justify-self: start` + `margin: 0`，实测与输入框左边缘对齐（同 x=372）。
4. 分发器 `8787` 停摆导致手机白屏：已恢复并确认手机正常加载（见下）。

## 四、环境侧发现（非 App 代码）

### 4.1 开机自启会弹窗（已修复）

两个原因叠加：

1. `desktop/main.cjs` 的 `second-instance` 处理**无条件**调用 `showWindow("overview")`。
2. 应用有**两个自启入口**：计划任务 `Codex-Turnloom Console`（`--hidden`）与注册表 `HKCU\...\Run\com.codex.turnloom.console`（`--hidden`）。`applyLoginItem()` 在计划任务已存在时直接 `return`，从不清理历史遗留的 Run 键。

于是开机时两个入口同时启动，抢不到单实例锁的那个会把已运行实例的窗口**顶到前台**。

修复：`second-instance` 先检查启动参数，带 `--hidden`/`--start-minimized` 的重复启动不再抬窗；同时在计划任务存在时清理遗留 Run 键。已重新打包（`npm run desktop:pack`）并经计划任务启动验证：**全部控制台进程 `MainWindowHandle = 0`**，注册表 Run 键已被清除，只剩一个自启入口。

### 4.2 监管关系订正

先前的判断需要修正：**分发器并非无人监管**。`Codex-Turnloom Console` 启动时会拉起 `dual/server.js --host 0.0.0.0 --port 8787 ...` 作为其托管服务；实测停掉控制台后 8787 随之消失，重新启动计划任务后 8787 由控制台拉起的进程持有（pid 26760），两个后端（8799 / 18788）也由其派生。

因此 22:54–02:21 的中断，根因是**控制台那一侧没有把服务维持住**（当时控制台进程存在但 8787 无人监听），而不是缺少守护机制。控制台自身已由计划任务负责拉起；仍建议后续确认它的服务重启策略，避免再次出现"控制台活着但服务没了"的状态。
