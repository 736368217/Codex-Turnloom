# 易用性检定（移动端 `app/`）— 2026-11-18

交付线：`app/`（React + Vite + Konsta UI + Vaul），Option A 浅色。本文只记录**实测**结论：每条问题都有截图或量测，修掉的标注文件与行号，没验证的写在最后一节。

## 1. 取证方法（可复现）

```powershell
npm run app:build
node tools/qa/capture.mjs --out docs/qa/visual/after                       # 390×844
node tools/qa/capture.mjs --viewports 360x800,320x568,768x1024 --out docs/qa/visual/after
```

`tools/qa/capture.mjs` 自己拉齐一套真实栈，跑完就收：

| 组件 | 说明 |
| :--- | :--- |
| `server.js` | **真实服务**，`--backend http --backend-url <fixture>`，随机端口 |
| `tools/qa/fixture-backend.mjs` | 按 `backends/http-backend.js` 契约造的固定数据：短消息/长 Markdown/宽代码块/表格/工具卡/思考/运行中/失败/真实审批请求/40 条会话 |
| `tools/qa/pairing-proxy.mjs` | 只补 `GET /api/harnesses`（见 D1），其余请求原样转发到真服务 |
| headless Edge + CDP | 390×844 / 360×800 / 320×568 / 768×1024，DPR 3，安全区 top 47 / bottom 34，`--disable-web-security`（原生桥被替换成 `fetch`，跨源） |

原生桥在页面里被替换成 `fetch` 实现（`Page.addScriptToEvaluateOnNewDocument`），所以 App 代码零改动，**渲染用的都是真 `/api/*` 响应**。每屏都会记录：页面横向溢出、越界元素、<44px 的可见交互元素、TabBar/输入舱的几何、请求日志。原始数据在 `docs/qa/visual/{before,after}/report.json`。

## 2. 结论速览

- **横向溢出：0**。320/360/390/768 四个宽度、20 个屏/状态，`document.scrollingElement.scrollWidth === innerWidth`，越界元素 0。
- **宽代码块**用容器内横向滚动（390 下 `clientWidth 291 / scrollWidth 1132`，320 下 `254 / 1132`），页面本身不滚。
- **键盘**：320×568 把视口压到 563 高时，输入舱 `top 427 / bottom 521`，整块可见（`after/320x568/20-chat-keyboard.png`）。
- **审批是真绑定的**：点「批准」后 fixture 收到 `{threadId: qa-approval, requestId: req-qa-0001, approvalKind: command, detailsHash: aaaa…(64), decision: approve}`，服务端 200，卡片转「已提交决定」并刷新消息。
- **审批禁用态**：`canApprove=false` 的请求两颗按钮 `disabled=[true,true]`，说明文案「请求已过期、变化或已处理，已禁用决定。」（`after/390x844/15-chat-approval-disabled.png`）。
- 触控目标：390×844 会话详情 `smallTargets 5 → 0`；会话页剩 2 个（视图切换 38px，属 `theme/**`，已交 @Iris）。

## 3. 问题清单（按严重度）

### U0 · P0 · 普通发送被当成一次「切换模型」（PI 原生授权框每轮弹） —— **已修**

- 现象：PI 会话实际 `model=deepseek-v4.1-flash`，`/api/health` 目录里是 `wbfd/deepseek-v4.1-flash`。`resolveTurnPreference` 用精确相等匹配失败 → 回退目录默认 `wbfd/hy4flash-free` → `ChatDetailScreen` 每轮都把 `preference.model` 放进 `buildSendPayload` → 电脑端每次都请求切模型 → PI 侧走 dangerous 的 `session/configure`，原生授权框反复弹，没人点就 `PERMISSION_DENIED`。
- 复现：`~/.pi-desktop/logs/app/plugin.log` 连续 `operation=session/configure risk=dangerous ok=false`；`docs/qa/android/08-connected-home.png`。
- 修法（客户端这一层）：
  1. `lib/chatContract.ts` 新增 `normalizeModelId()` / `matchModelEntry()`：精确 ID 优先，其次按最后一个 `/` 之后的段匹配；同尾段多个时按 provider 前缀收敛，仍不唯一就返回 `undefined`，**不猜**。`resolveTurnPreference` 改用它，不再掉到目录默认模型。
  2. 新增 `sendModelFields()`：普通发送**不带 `model`**（电脑端沿用会话自己的模型）；只有用户真的在模型面板里改过才带，且 same-pair 时只带 `effort`。`useComposerFields` 暴露 `fields.send`，`ChatDetailScreen` 只从它取值。
- 证据：harness 实际发出的请求体（`report.json` → `sends`）：
  `{"threadId":"qa-long","model":null,"effort":null,"hasModelField":false}` —— 普通发送里没有 `model` 字段。
- 回归：`test/app-model-resolution.test.cjs`（5 例：归一、歧义不乱选、普通发送不带 model、显式选择才带、同对只带 effort）。
- 文件：`app/src/lib/chatContract.ts:208-300`、`app/src/components/ChatComposer.tsx:148-160`、`app/src/screens/ChatDetailScreen.tsx:211-214`
- 桥侧同一问题的兜底由 @Kai 完成（`modelPairSame()` + 发送路径 0 次 `session/configure`），服务端由 @Atlas 的 `piSendModelSettings` / `applyPiThreadModel` 保证「不带 model 就取会话现值」。

### U1 · P0 · 会话页首屏一行会话都没有 —— **已修**

- 现象：默认视图「按项目」，且所有项目组初始折叠，49/40 条会话首屏只有组头 + 「已加载 N/N」。按 @NB agent 在真实 Codex 数据上的取证，49 会话也是同样 0 行。
- 复现：打开「会话」Tab（`before/390x844/04-threads-default.png`、`before/390x844/05-threads-after-one-tap.png`）。
- 期望：首屏直接看到最近会话。
- 修法：`ThreadsScreen` 默认视图改 `'time'`（最近优先），「按项目」分组默认展开。
- 证据：`after/390x844/04-threads-default.png`（首屏 40 行，时间倒序）。
- 文件：`app/src/screens/ThreadsScreen.tsx:32`

### U2 · P0 · 项目分组第一次点击不展开（要连点两次） —— **已修**

- 现象：折叠判定写的是 `collapsed[key] !== false`，而 toggle 写 `!prev[key]`；`undefined → true` 仍是折叠，用户第一次点击「没反应」。
- 复现：`before/390x844/05-threads-after-one-tap.png`（点一次仍折叠）。
- 修法：折叠态显式 `=== true`，toggle 用 `prev[key] !== true`。
- 文件：`app/src/screens/ThreadsScreen.tsx:54-58,125`

### U3 · P1 · 监控页「查看 / 停止」不可停止 —— **已修**

- 现象：行尾文案承诺「停止」，但整行只跳详情，没有任何停止入口；运行中会话在这里没法停。
- 复现：`before/390x844/16-monitors.png`。
- 修法：行尾换成真实「停止」按钮（`interruptThread`，44×44，停止中显示 spinner，失败在本页给 `role=alert` 原因），行主体仍跳详情。
- 证据：`after/390x844/16-monitors.png`。
- 文件：`app/src/screens/MonitorsScreen.tsx:25-38,80-100`

### U4 · P1 · 未配对就自动外联公网更新域 —— **已修**（按 @Atlas 定的口径）

- 现象：`ConnectScreen` 挂载即 `checkUpdate()`，origin 回退到写死的 `https://tl.z736.cc.cd`，全新安装第一次打开就产生外联。
- 修法：挂载只在 `session.serverUrl`（已记住/已配对）存在时自检；写死域只在用户点「检查应用更新（公开通道）」时使用；失败只落更新行内，不置全局 offline。
- 回归：`test/app-usability.test.cjs` U4（未配对挂载 → 不发请求、按钮文案含「公开通道」）。
- 文件：`app/src/screens/ConnectScreen.tsx:31-63,84-92,183-190`

### U5 · P1 · 底部 TabBar 压住内容且没有毛玻璃 —— **交 @Iris（`theme/**`）**

- 现象：`globals.css:120-126` 的 `.tl-screen::after` 只留 48px，而栏是 56px + 34px 安全区 = 90px；`globals.css:376` 又把栏内第一层的 `background/backdrop-filter` 全关掉，列表文字直接从栏里透出来。
- 复现：`before/390x844/03-home.png`（页脚被压）、`before/390x844/16-monitors.png` / `after/390x844/04-threads-default.png`（底部与 Tab 标签重叠、无模糊）。
- 期望：尾部留白 ≥ 栏高 + 安全区；栏为 `backdrop-filter: blur(20px)` + `rgba(255,255,255,.72)`。

### U6 · P1 · 触控目标 < 44px —— **屏层已修，剩 1 处 CSS**

| 控件 | 修前 | 修后 | 归属 |
| :--- | :--- | :--- | :--- |
| 会话页「新建任务」 | 40×40 | 44×44 | 已修 `ThreadsScreen.tsx:80` |
| 输入舱 图片/附件/发送/停止 | 38×40 / 40×40 | 44×44 | 已修 `ChatComposer.tsx:222-245,256-282` |
| 模型与强度触发键 | 124×40 | 124×44 | 已修 `ChatComposer.tsx:223-225` |
| 审批 拒绝/批准/允许本次会话 | 136×40 | 136×44 | 已修 `ChatDetailScreen.tsx:81` |
| 思考过程 折叠头 | 323×32 | 323×44 | 已修 `ChatDetailScreen.tsx:101` |
| 新建任务抽屉「创建任务」 | 40×40 | 44×44 | 已修 `NewTaskSheet.tsx:71` |
| 会话视图切换 按项目/按时间 | 170×38 | 待修 | `theme/globals.css` → @Iris |

- 证据：`before|after/390x844/07-chat-long-top.png` 与 `report.json` 的 `smallTargets`（详情页 5 → 0）。

### U7 · P2 · 列表没有时间戳；HTTP 后端下「按时间」排序失效 —— **已修**

- 现象：`ThreadsScreen.timeOf()` 只读 `updatedAt`，而 HTTP 后端（`backends/http-backend.js`）规范化后返回的是 `updatedAtMs`，于是全部取 0：排序退化成服务端顺序，行内也没有时间。
- 修法：`lib/threadProjection.ts` 新增 `threadUpdatedAtMs()`（`updatedAt | updatedAtMs | createdAt | createdAtMs`，兼容 ISO 字符串）与 `formatThreadWhen()`（今天 `HH:mm`、昨天「昨天」、更早 `M/D`）；`ThreadsScreen` 与 `TaskStream` 都改用它。
- 证据：`after/390x844/04-threads-default.png` 右侧 17:12 / 17:11 / 16:57…
- 回归：`test/app-usability.test.cjs` U7。

### U8 · P2 · 首页首屏把机器名重复显示两次 —— **交 @Iris**

- 现象：`MachineHubHeader` 与 `StatusCard` 的两行副标题都是同一个名字（「QA 桌面 / QA 桌面」），首屏第一眼像坏数据。
- 证据：`before/390x844/03-home.png`。
- 期望：机器名与服务名相同时，副标题显示服务类型/地址或直接省略。

### U9 · P2 · Tab 语义错（可访问性） —— **交 @Iris**

- 现象：Konsta `TabbarLink` 渲染成 `role="link"`，外层却是 `role="tablist"`；CSS 里已有 `.tl-tabbar [role="tab"]` 规则，说明预期是 tab。读屏会把 4 个 Tab 念成链接，`aria-selected` 语义丢失。
- 证据：`document.querySelector('.tl-tabbar').outerHTML`（`tools/qa/capture.mjs --dump` 可复现）。

### U10 · P2 · 审批卡信息分段没有标签，窄屏三按钮换行 —— **未修（建议）**

- 现状：服务端 `content` 是分段文本（`Prompt:` / `Command:` / `Path:` / `Changes:` / `Permissions:` / `Workdir:`，见 `server.js:3715` `interactionContent`），前端用 `<pre>` 原样渲染。真实数据里读起来还行，但「理由 / 工作目录 / 命令」三段的视觉层级一样。
- 320 下三个决定按钮走 2 列网格，第三个独占一行（`after/320x568/13-chat-approval.png`），不算错但不够像 iOS。
- 建议：按段拆成「命令（等宽块）/ 工作目录（单行省略 + 可复制）/ 理由（正文）」；决定按钮窄屏改整列堆叠、主决定在上。

## 4. 其它核对结论（不是缺陷）

- **首页仍是「仪表盘」**：0 运行任务时整页是机器卡 + 空态 + 快捷操作，没有「最近会话/继续上次」。这是产品方向选择（默认 Tab 改成会话，或在首页加最近 3 条），需要 @NB agent / @Iris 定，不在本轮擅改。
- **搜索入口没丢**：`ThreadsScreen` 顶部有「搜索会话」，`tabStore.threadsQuery` 生效（`after/390x844/04-threads-default.png`）。@NB agent 第 3 条按截屏推测「入口缺失」，实际是首屏空列表（U1）导致的误判。
- **分页没有丢**：`/api/threads?limit=60&cursor=` 返回 `nextCursor/total`，`dataStore.loadMoreThreads()` 已接；`ThreadsScreen` 只在 `data.nextCursor` 非空时显示「加载更早会话」。fixture 后端一次性给 40 条、无 cursor，所以这条按钮没出现，属数据源限制。
- **403/500 不会被说成离线**：`turnloomApi.startNativeRequest` 只有 `status===0` 才是 `offline:true`；`dataStore.actionable()` 已按 401/403/404/409/5xx 分流文案。
- **审批按钮不会凭空启用**：`canApprove` 直接绑服务端权威布尔 + `requestId` + 64-hex `detailsHash` + `threadId` 一致，任一缺失即禁用并写明原因。

## 5. 未验证 / 边界

| 项 | 状态 |
| :--- | :--- |
| 真机 WebView（`native-shell/` 的键盘 resize、返回键按下） | **已由 @Rhea 在 `paopao_api33`（780×1688 @320dpi = 390×844@2x）验证**：连接页聚焦后表单整体上移、输入舱不被键盘遮挡、返回键「详情→列表 / 抽屉→关闭 / 先收键盘」正确，证据 `docs/qa/android/03-keyboard-url-focus.png`、`05`、`13`… |
| iOS Safari 真实安全区（`env(safe-area-inset-*)`） | 用 CDP `Emulation.setSafeAreaInsetsOverride` 模拟 47/34，不是真机 |
| Codex Desktop 真实审批弹窗 → 批准 | 未做；本轮的审批是 fixture 按契约造的真实 HTTP 往返，服务端函数级已由 @Atlas 覆盖 |
| 扫码配对 | 无相机环境，未验证 |
| 毛玻璃/层级（U5）、TabBar 语义（U9）、机器名重复（U8） | 属 `theme/**` 与视觉组件，已交 @Iris，未在本轮落地 |
| `--backend http` 部署无法配对（D1） | **已修**（`server.js` 发现路由在 501 兜底前放行，回归 `test/http-backend-pairing.test.cjs`）；harness 现在直连真服务配对，`pairing-proxy.mjs` 仅作历史对照（`--proxy`） |
| 401 被渲染成「离线」（D2，@Rhea 真机发现） | **未修**：`AppShell.tsx:66` 的横幅只看 `session.status !== 'ready'`，忽略已存在的 `session.error`（`connectionErrorMessage(401)` 其实已给出「机器访问码不正确或已更换」）。横幅属 @Iris 的组件，已交她；`sessionStore` 侧无需改动。 |
| 连接页重输访问码后旧错误卡不消失（D5，@Rhea 真机发现） | **未修（下一轮）**：`ConnectScreen` 的 `session.error` 没有在输入变化时清掉，改 `onChange` 时 `setConnectionError('', status)` 即可；属本 Task 的 `screens/**`。 |
| 返回列表后视图/搜索被重置（D3，@Rhea 真机发现） | **已修**：视图改存 `tabStore.threadsView`（`63f5833`），搜索词本来就在 `tabStore.threadsQuery`；进出详情不再重置。 |
