# 主分支质量与体验评估报告

**审查基线**：`main` / `e81e0f2920da7a547078ffe937c24398105eb8db`  
**评估对象**：ROUTE=dom-shell App、共享 API / 审批路由、Android 原生桥；固定提交的隔离工作树。主工作区有其他未提交工作，本次未读取其源码、未修改它，也未控制其服务或数据库。

## 结论

**当前不建议按现状发布。** 发现 3 个会影响安全确认或核心操作的高优先级问题；干净检出自动化有 2 项失败。首页视觉系统与浅色卡片体系较一致，窄屏横向布局通过测量；但聊天气泡存在数量级错误的行高，导致核心内容几乎不可读。

| 维度 | 评分 | 依据 |
|---|---:|---|
| 代码质量 | 5.5 / 10 | 类型检查、构建和桥接回归良好；审批链路断开、错误状态模型及干净检出测试不完整 |
| 用户易用性 | 4 / 10 | 连接、搜索、草稿恢复可用；审批对象不明确、监控中断不可操作、服务端错误误报离线 |
| 视觉表现 | 5 / 10 | 首页卡片、间距和配色一致；聊天气泡严重变形、Markdown 裸文本、底栏操作偏拥挤 |

## 高优先级问题

### P1：审批未绑定具体请求，可能批准未展示的操作

[ChatDetailScreen.tsx](/D:/pi-data/data/scratch/085b0cda-a463-419e-bafc-bafd3bad412f/main-audit/app/src/screens/ChatDetailScreen.tsx:89) 与 [ThumbGlassBar.tsx](/D:/pi-data/data/scratch/085b0cda-a463-419e-bafc-bafd3bad412f/main-audit/app/src/components/ThumbGlassBar.tsx:35) 都只按会话打开通用审批抽屉。包含 `requestId`、命令和理由的消息没有接到审批状态；整个 `app/src` 没有 `openApproval()` 调用。抽屉因而显示“等待电脑端提供命令详情”，批准仍可点。[ApprovalSheet.tsx](/D:/pi-data/data/scratch/085b0cda-a463-419e-bafc-bafd3bad412f/main-audit/app/src/components/ApprovalSheet.tsx:16) 使用通用默认文案，并把会话 ID 当作审批 ID 提交。

后端 [server.js](/D:/pi-data/data/scratch/085b0cda-a463-419e-bafc-bafd3bad412f/main-audit/server.js:7101) 在没有匹配 request ID 时会退回该会话最近的待处理审批；响应路径随后使用选中的 request ID 执行决定。隔离浏览器中，模拟返回含有具体迁移命令与 request ID 的审批消息，实际抽屉仍无命令详情，批准请求载荷却是 `{ id: "audit-running", threadId: "audit-running", decision: "approve" }`。

**影响**：用户不能核对将被执行的具体操作；同一会话存在多个待处理操作时，可能批准到 UI 未展示的最新请求。应在审批事件抵达时绑定精确的 request ID、类型、命令和理由；没有有效审批详情时禁用批准，并让服务端拒绝缺少精确 request ID 的决定。

### P1：消息行高使用错误单位，聊天内容被撑至不可读

[ChatDetailScreen.tsx](/D:/pi-data/data/scratch/085b0cda-a463-419e-bafc-bafd3bad412f/main-audit/app/src/screens/ChatDetailScreen.tsx:105) 把 `lineHeight: 20` 作为 React 行内数值；它会被解释为 **20 倍字号**，不是 20px。390×844 实测计算行高为 **280px**：一行消息气泡高 **300px**，一段普通回复高 **3100px**。聊天日志在 [同文件](</D:/pi-data/data/scratch/085b0cda-a463-419e-bafc-bafd3bad412f/main-audit/app/src/screens/ChatDetailScreen.tsx:24>) 也有 `fontSize: 12, lineHeight: 19` 的同类错误。

实测截图：[聊天详情](</D:/pi-data/data/scratch/085b0cda-a463-419e-bafc-bafd3bad412f/browser-evidence/02-chat.jpg>)、[气泡高度异常](</D:/pi-data/data/scratch/085b0cda-a463-419e-bafc-bafd3bad412f/browser-evidence/03-chat-layout-defect.jpg>)。应改为显式像素值或合适的单位less比例，并给短文本、多行文本与日志补布局断言。

### P1：监控页“中断当前任务”进入无法提交的死路

[MonitorsScreen.tsx](/D:/pi-data/data/scratch/085b0cda-a463-419e-bafc-bafd3bad412f/main-audit/app/src/screens/MonitorsScreen.tsx:70) 不传会话 ID 打开中断抽屉；[CupertinoSheetHost.tsx](/D:/pi-data/data/scratch/085b0cda-a463-419e-bafc-bafd3bad412f/main-audit/app/src/components/CupertinoSheetHost.tsx:92) 又在没有 `contextThreadId` 时禁用确认按钮。390px 浏览器夹具明确有 1 个运行中会话；点击监控页入口后确认按钮为 `disabled=true`，也没有产生 `/api/interrupt` 请求。

**影响**：用户从监控页无法执行该页主要的中断操作。应明确选择一个运行中会话，或列出可确认的批量中断目标；没有目标时不应显示可进入的操作。

### P1：干净克隆上的测试门禁失败

固定主分支副本直接运行测试：**Node 24.19.0 与缓存 Node 22.23.5 均为 262 通过、2 失败、0 取消**。两个失败都因测试依赖的 `AGENTS.md` 和 `docs/option-a/SINGLE_APP_CONTRACT.md` 不在提交中；[.gitignore](/D:/pi-data/data/scratch/085b0cda-a463-419e-bafc-bafd3bad412f/main-audit/.gitignore:39) 忽略了 `AGENTS.md`，第 56 行起忽略整个 `docs/option-a/`。`verify-single-app.mjs` 同样以 **13 PASS / 1 FAIL / 1 SKIP** 结束，失败原因是合同文件缺失；APK 未构建，因此 ZIP 检查按脚本设计跳过。

**影响**：主分支从新克隆无法通过自己的合同回归门禁。需要决定哪些合同由公开仓库维护，并调整忽略规则或测试边界，使 CI 对只检出仓库提交的环境可重复运行。

## 中优先级问题

### P2：Markdown 按原始文本显示

聊天消息直接渲染 `text/content` 字符串，[ChatDetailScreen.tsx](/D:/pi-data/data/scratch/085b0cda-a463-419e-bafc-bafd3bad412f/main-audit/app/src/screens/ChatDetailScreen.tsx:105) 没有 Markdown 渲染。隔离实际页面展示了原始 `##`、`**`、代码围栏及 Markdown 链接标记；代码不高亮，链接不可点。对于包含说明、代码和清单的代理答复，会明显增加阅读负担。

### P2：业务错误也被记录为离线

[dataStore.ts](/D:/pi-data/data/scratch/085b0cda-a463-419e-bafc-bafd3bad412f/main-audit/app/src/state/dataStore.ts:116) 的 `applyFailure()` 对所有失败都执行 `setOnline(false)`、`offline: true`，包含明确判为服务在线的 HTTP 403、500 等响应。发送 500 的夹具路径随后显示“请检查连接”，而不是将问题归因于服务端失败。应只对超时、无网络和 transport failure 标记离线；HTTP 错误应保留在线状态并显示对应原因。

### P2：监控计时实际计算距上次同步时间

[MonitorsScreen.tsx](/D:/pi-data/data/scratch/085b0cda-a463-419e-bafc-bafd3bad412f/main-audit/app/src/screens/MonitorsScreen.tsx:24) 将 `data.lastSyncAt` 作为“本次运行计时”起点，成功刷新就重置时钟。实测刷新前显示 `00:01`，刷新后显示 `00:00`。该指标不是任务运行时长，容易误导用户。应改成任务 `startedAtMs` 汇总或明确改名为“距上次同步”。

### P2：会话列表没有游标翻页

[turnloomApi.ts](/D:/pi-data/data/scratch/085b0cda-a463-419e-bafc-bafd3bad412f/main-audit/app/src/lib/turnloomApi.ts:367) 为线程列表定义了 `nextCursor`，但 [dataStore.ts](/D:/pi-data/data/scratch/085b0cda-a463-419e-bafc-bafd3bad412f/main-audit/app/src/state/dataStore.ts:147) 固定拉取 60 条并丢弃分页信息；[ThreadsScreen.tsx](/D:/pi-data/data/scratch/085b0cda-a463-419e-bafc-bafd3bad412f/main-audit/app/src/screens/ThreadsScreen.tsx:53) 只显示当前已载入的数量，也没有“加载更多”。会话多于首批条数时，较早任务无法搜索或打开。

## 正向结果与界面观察

- 首次未配对显示连接页；无效访问码会显示错误。模拟有效配对后能进入工作台，并使用桌面端发现的 Codex / Pi 服务。
- 搜索过滤工作；发送失败时草稿保留，离开并重进详情后草稿恢复。
- Composer 在 **320、360、390、768px** 均未出现横向滚动溢出；390×420px 可视高度下输入框与发送按钮底边位于 y=355，仍在视口内。
- 首页使用一致的浅灰画布、白色分组卡片、蓝绿红语义色和清晰触控区。全屏首页截图：[首页工作台](</D:/pi-data/data/scratch/085b0cda-a463-419e-bafc-bafd3bad412f/browser-evidence/01-home.jpg>)。
- 会话中的“待审批”状态使用绿色对勾图标，较容易被理解成已完成；建议换成等待/时钟语义图标。

## 自动化检查

| 检查 | 结果 |
|---|---|
| App TypeScript `tsc --noEmit` | 通过 |
| App Vite production build | 通过；JS chunk 622.56 KB，gzip 177.79 KB，超过 500 KB 警告阈值 |
| Node 24 根目录测试 | 264 项：262 PASS、2 FAIL、0 CANCELLED |
| Node 22 根目录测试 | 264 项：262 PASS、2 FAIL、0 CANCELLED；相同缺失合同原因 |
| 单线 App 静态校验 | 13 PASS、1 FAIL、1 SKIP；合同缺失，APK ZIP 项按设计跳过 |
| Turnloom 桥附件 / 分叉 / host 能力 / 模型路由 / 共享队列 | 5 个隔离测试脚本全部退出码 0；均使用临时数据或临时管道 |
| Android 桥 `BridgeContract` JVM 单测 | 8 项通过；使用缓存 JDK 与依赖，无模拟器 |
| `npm run verify:ci` 全命令 | 未直接执行；等价根测试已分别在 Node 22/24 执行，但完整 CI 脚本会被上述测试失败提前终止 |

## 覆盖边界与下一步

浏览器使用隔离 HTTP 夹具和模拟 `TurnloomNative`，未向真实电脑、会话、PI 管道、数据库发送操作。没有安装 APK、启动 MuMu、验证真实相机扫码、WebView 安全存储、键盘弹出或系统安装器流程；这些均不能由本轮浏览器夹具代替。设置页和新建任务抽屉的完整点击走查因本次 ego 浏览器会话异常结束而未完成，不对其作“流程通过”的结论。

建议先修复审批对象绑定和消息行高，再修复监控中断、离线状态判定及干净检出测试，随后在真实 APK 上串行复测审批、键盘遮挡、扫码和更新安装。