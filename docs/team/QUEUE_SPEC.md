# 排队消息（Queue）产品与接口规格 · 2.3.0

> 状态：执行中。作者：NB agent（owner）。实现：Atlas（server）/ Iris（app）。验收：Vera（可用性与 E2E）、NB3（设计门禁）、NB agent（交付）。
> 证据：Human 2026-11-20 19:55 真机截图（运行中，输入框有文字 + 图片，主按钮只剩红色停止，无法插入）；`app/src/components/ChatComposer.tsx:519-537`（running 时只渲染 Stop）、`app/src/lib/composerSubmit.ts:7-15`（running 直接 `blocked-running`）。服务端其实已有队列（`server.js` 的 `enqueueSend` / `cancelQueuedSend` / `steerQueuedSend` / `drainQueuedSend`），但手机端一个入口都没有。

## 1. 问题与目标

**问题**：一轮任务运行时，手机端不能发消息。用户只能等，或者停止本轮——这会丢掉正在做的工作。排队是交流部分的核心能力，不是附加项。

**目标**：在不打断当前轮的前提下，用户可以：

1. 把文字 + 图片 + 文件排进队列；
2. 看到队列（数量、顺序、状态、附件、引用）；
3. 把某条取回输入框继续编辑；
4. 调整多条消息的顺序；
5. 取消某条；
6. 把某条插队——立即并入正在运行的一轮（steer），或移到队首下一条发送；
7. 失败时重试，中断本轮时队列暂停，不偷偷继续发。

**非目标**（本轮不做，写进报告）：

- 排队消息的富文本/结构化引用（当前引用是纯文本块，排队原样保留）；
- 跨设备同步队列的冲突合并（以服务端队列为准，手机只读缓存）；
- 桌面端队列 UI 改造（桌面是 Codex Desktop，只读不改）。

## 2. 交互与 IA

### 2.1 运行中的输入区

- 按钮顺序写死：**停止永远最右，发送在它左边**。两者都是 44×44 命中区；输入为空时只显示停止，停止不位移。
- 运行中按发送 = `mode:"queue"`，成功后清空输入与附件托盘，保留焦点；**不做浮层 toast**。确认走输入区上方那一行 12px 提示位（`aria-live="polite"`）+ 轻震：「已排队 · 第 N 条 · 查看」，2.5 秒后回到常驻提示；「查看」打开队列面板。队列条本身同时从 0 变成「N 条排队」，是第二重反馈。
- 运行中按 Enter 同样排队（不是 `blocked-running`）；运行中 `enterKeyHint` 必须是 `send`（现在是 `done`，见 `ChatDetailScreen.tsx:429`）。
- 输入框上方那一行提示位（不占固定高度、不推挤消息区）在运行中且队列为空时显示：「本轮运行中，发送会排队，结束后自动发出」。
- 停止本轮不丢队列：队列暂停，见 2.5。

### 2.2 队列条（常驻在输入区上方）

- `queueLength > 0` 时显示，高 36（命中区 44），白底/浅灰底，圆角 12，内容：
  - `ListOrdered 14` + 「N 条排队」；
  - 右侧状态：`下一条将在本轮结束后发送` / `正在发送…` / `已暂停` / `队首发送失败`；
  - 正常/失败态带 `ChevronRight 14`。
- 点整条打开「排队消息」面板。
- **暂停态右侧只留「恢复」灰底胶囊（44×44，`stopPropagation`），去掉 Chevron**；文字位缩成「已暂停」，整条其余区域仍可点开面板。320 宽下不允许胶囊和整行点击互相压住。
- 失败态文字用 `--tl-red`（`#FF3B30`），文案是「队首发送失败」（FIFO 下失败只可能在队首）；点开面板**直接展开该条详情**，见 2.4。失败不改变暂停状态。

### 2.3 排队消息面板（Vaul 底部抽屉）

- 标题「排队消息」，副标题按状态四选一：
  - 正常：「本轮结束后按顺序发送。点一条可编辑、插入或删除。」
  - 暂停：「你中断了本轮，队列已暂停。恢复后按顺序继续。」
  - 发送中：「正在发送队首消息，完成后继续下一条。」
  - 队首失败：「队首消息发送失败。重试、编辑或删除后继续。」
- 暂停时顶部一张提示条，使用新增 warning token（`--tl-warning-surface #FFF4E5` / `--tl-warning-label #8A5300`，值沿用现有 notice 色）：「你中断了本轮，队列已暂停。」+「恢复队列」按钮（44）。恢复按钮与队列条上的恢复是同一个动作。
- 列表行（最小 56 高，整行可点）：
  - 左侧 22×22 序号圆（1、2、3…）；
  - 中间 2 行预览（15px/21px），附件元信息一行 12px：`图片 2 · 文件 1`（**不做「引用」标记**：引用是纯文本块，只在单条详情里原样可见）；
  - 右侧状态徽标：`排队中`（灰）/`发送中`（蓝，转圈）/`待确认`（蓝）/`失败`（红）；
  - 末尾 `ChevronRight 16`（暂停态仍有，用于进面板；与队列条不同）。
- 发送中/待确认的行置灰，整行仍可点开详情看原因，但详情里的动作全禁用。
- 空态：「没有排队消息」+「本轮运行中时，发送的消息会排在这里。」
- 底部说明：`最多 20 条` **只在 ≥17 条时出现**（如「队列 17/20」），不常驻。
- 面板与单条详情是**两级抽屉**：详情只关自己，返回列表；列表空了再整体关。详情必须有可见的「返回队列」按钮，不能只靠手势。详情正文（文本/附件）`max-height: 30vh` 内滚，保证「删除」不被安全区截断。

### 2.4 单条消息面板

点列表行打开，标题「排队消息 N」，副标题是状态（如「等待本轮结束」/「发送失败」/「正在发送，暂时不能修改」）。

内容：完整文本（可选中），图片缩略图最多 4 张（**打开详情后按需通过 `/api/queue/image?format=json` 拉取**，见 3.3；拉取失败只显示「图片 N 张 + 文件名」，不猜、不裂图），文件 chip（`Paperclip` + 文件名 + 大小）。引用块按纯文本原样显示（`>` 行保留），不做跳转/解析。

操作（每行 44 高，图标 20 + 文字 15px，按这个顺序）：

1. **取回编辑**（`Pencil`）：调用 `/api/queue/cancel` `{edit:true}`；把返回的 `text/images/files` 放回输入框与附件托盘，队列表项消失。输入框已有内容时先确认「替换当前草稿？原草稿会丢失。」，只给 [替换] [取消]；输入框为空直接放回、不弹确认。
2. **插入本轮**（`CornerUpLeft`）：仅运行中可用；调用 `/api/queue/steer`，立即并入当前轮；成功提示「已插入本轮」。非运行中置灰，副文案「本轮未在运行」；409 时只提示失败并刷新，**不改变按钮行为**。
3. **移到队首**（`ArrowUpToLine`）：调用 `/api/queue/reorder` `{direction:"top"}`；已在队首时置灰，副文案「已在队首」。
4. **上移 / 下移**（`ArrowUp` / `ArrowDown`）：`{direction:"up"|"down"}`；首/末项禁用。>1 条时始终显示。
5. **重试**（`RotateCw`）：仅 `failed` 项显示，调用 `/api/queue/retry`。
6. **删除**（`Trash2`，红色）：二次确认「删除这条排队消息？」；调用 `/api/queue/cancel`。

**发送中 / 待确认：以上全部禁用（含删除）**，行置灰，显示「正在发送，暂时不能修改」；服务端 409 用同一句话。删除不做特例。等状态转为 `failed` 后动作恢复。

### 2.5 队列生命周期

- 本轮结束后，服务端按顺序自动发送队首；两条之间至少 1.5s 空闲确认，避免撞轮。**「空闲」必须同时满足 `thinking:false` 且 `interactionRequired:false`**——等待审批时 `thinking:false`，队列绝不能顶上去绕过审批。`resume` 后也走同一套 1.5s 空闲确认，不做「立即发」特例。
- 用户点停止：本轮中断，队列进入暂停；队列条与面板显示「已暂停」，必须点「恢复」才继续。防止用户停止后消息被偷偷发出。
- 队列项发送失败：状态 `failed`，不阻塞后面的项？**不**——保持队首阻塞，用户重试/删除/编辑后才能继续，避免乱序。面板给出原因（服务端 `lastError`，截断 200 字）。
- 删除、取回后若队列为空，队列条消失，停止按钮保持原样。
- 发送中/待确认的项不能编辑、删除、排序；等它转为 `failed` 或完成后才能操作。

## 3. 服务端接口

所有接口带现有 token 鉴权，写操作要求非只读。错误统一 `{ error }`，中文、可操作。

### 3.1 `GET /api/queue/status?threadId=`

```json
{
  "ok": true, "threadId": "…", "queueLength": 2, "queuePaused": false,
  "queueSource": "local|pi-native",
  "queuedMessages": [{
    "id": "uuid", "position": 1, "text": "原文", "preview": "一行预览",
    "imageCount": 1, "fileCount": 1,
    "images": [{ "name": "a.jpg", "url": "/api/queue/image?threadId=…&itemId=…&index=0" }],
    "files": [{ "name": "log.txt", "size": 1234, "mimeType": "text/plain" }],
    "enqueuedAt": "ISO", "deliveryState": "queued|sending|awaitingConfirmation|failed",
    "lastError": null, "model": "", "effort": ""
  }]
}
```

顺序 = 发送顺序。`text` 是用户原文，不包含服务端追加的附件路径。

`images[].url` 是给浏览器/调试用的相对地址；**原生 App 的 WebView 是 `file:///android_asset`，且 `MainActivity` 会拦截一切 http(s) 子资源（`MainActivity.java:196-201`），所以 `<img src>` 既不能解析相对地址，也不能走 http(s)。** 手机端按下述 3.3 的图片管线取图，不能把绝对地址/签名 URL 塞进 `<img>`，也不能把 token 放进 URL。

### 3.2 `POST /api/queue/reorder`

```json
{ "threadId": "…", "itemId": "…", "direction": "up|down|top" }
```

- 仅 `queued` / `failed` 可动；`sending` / `awaitingConfirmation` 返回 409「正在发送，暂时不能修改。」（与 UI 同一句）。
- 返回 `{ ok, threadId, ...status }`。
- PI 原生队列：桥不支持时返回 409 `queue_reorder_unsupported`（「当前后端不支持调整顺序」），不假装成功。
- `direction:"top"` 表示移到队首，供「移到队首」使用。

### 3.3 队列图片读取（不新增 JSON 接口）

- 服务端只提供现有 `GET /api/queue/image?...`（二进制 + `x-access-token` 头）；**不做签名 URL，也不做 `format=json`**。
- 原生侧最小改动（2.3.0 一并做，顺带修老碎图）：`NativeHttpClient.responseJson` 在响应 `Content-Type` 为 `image/*` 时，额外返回 `"bodyBase64"`（保留现有 `body`，向后兼容）。
- 客户端 `fetchImageDataUrl(absoluteUrl)`：优先走 `nativeHttpRequest`（带 token 头），用 `bodyBase64` 拼 `data:` URL；浏览器环境用 `fetch` + blob。按 URL 缓存最多 24 张 / 5 分钟。
- 队列条与列表行**不加载图片**，只显示「图片 N 张」；单条详情打开时才按需取最多 4 张。取不到就显示「图片 N 张 + 文件名」，不裂图。
- 同一管线用于聊天消息图片（`ChatDetailScreen.tsx:407` 目前直接把相对地址塞 `<img>`，真机必碎）；这是 2.3.0 的回归修复，不只是队列。
- 若冻结前原生改动未绿：队列先按「数量 + 文件名」交付，图片管线单独立项，报告如实写「未修」，不阻塞主链路。

### 3.4 `POST /api/queue/resume`

```json
{ "threadId": "…" }
```

清除该线程的暂停标记并调度 drain，返回 `{ ok, threadId, queuePaused: false, ...status }`。恢复后同样要等 1.5s 空闲确认（且 `interactionRequired:false`）才发队首，不做「立即发」特例。

### 3.5 既有接口扩展

- `POST /api/send` `mode:"queue"`：
  - 入队文字 + 图片 + 普通文件；返回 `{ ok, queued:true, queueItem, queueLength, queuePaused }`。
  - `clientRequestId` 幂等保持不变。
  - 入队时**不**把文件 stage 成路径写进 `text`；文件随队列项保存，发送时再 stage。
- `POST /api/queue/cancel` `{edit:true}`：返回 `draft: { text, images, files }`（图片/文件为 base64），供取回编辑。取消后位置不留空洞。
- `POST /api/queue/steer`：保留现有语义（立即并入当前轮），失败原样恢复到原位置。
- `POST /api/interrupt`：中断成功后，若该线程队列非空则置 `queuePaused=true`，返回 `queuePaused`。
- `GET /api/threads/:id/messages` 的 `status` 继续带 `queueLength / queuePaused / queuedMessages`，手机端 3s 轮询即可保持同步。

### 3.6 上限与持久化

- 每线程最多 20 条；单条文字 ≤ 12000 字；图片 ≤ 4；普通文件 ≤ 4；单条总 base64 ≤ 24MB（请求体总上限沿用 32MB）。**上限在 API 层拒绝**（「队列已满（20 条）」），不能等 PI 桥的 50 条上限再报 500。
- 队列文档沿用 `pendingSendQueues` 的原子写；新增 `files` 与 `paused: [threadId]` 字段，schema 版本 +1，旧文档可读（缺字段按空处理）。
- 服务重启后恢复队列与暂停标记；恢复后不自动发送暂停队列。

## 4. 客户端数据契约

- `ThreadRuntimeStatus` 增加：`queueLength: number`、`queuePaused: boolean`、`queuedMessages: QueueMessage[]`。
- `QueueMessage`：`id, position, text, preview, imageCount, fileCount, images, files, enqueuedAt, deliveryState, lastError`。
- `postSend` 的 `SendOptions` 增加 `mode?: 'start' | 'queue' | 'steer'`，`sendBody` 原样透传。
- 新增 API 函数：`getQueueStatus`、`postQueueReorder`、`postQueueResume`。
- 新增 `fetchImageDataUrl(url)`（native `bodyBase64` / 浏览器 fetch+blob，带 token 头、24 张 / 5 分钟缓存）与 `<AuthedImage>`；聊天消息与队列详情共用。`getQueueImage` 保留但只作二进制调试用途。
- `composerSubmitDecision` 增加 `{ kind:'queue' }`：running 且非空 → queue。
- 队列相关状态只从服务端读，不在本地伪造 `deliveryState`；发送动作后立刻用响应里的 status 覆盖。

## 5. 视觉与可用性硬约束

- 只用 Option A token：`#F2F2F7` 画布、白卡、`#E5E5EA` 分隔、`#007AFF`、`#FF3B30`。**新增 warning 语义 token**：`--tl-warning #FF9500`、`--tl-warning-surface #FFF4E5`、`--tl-warning-label #8A5300`（沿用现有 notice 色值，不改其它色）；只用于暂停提示条，不用于主按钮。
- Lucide 图标，尺寸 14/16/20/22，stroke 2；不混用其它图标集。
- 所有可点目标 ≥44×44；行高 ≥44；390 / 360 / 320 无横向溢出；键盘弹出不遮输入区；底部抽屉不遮队列条以外的主要操作。
- 运行时按钮组不换行（320 宽下仍一行）；停止永远最右、发送在其左，空输入时停止不位移；模型 chip 截断规则不变。
- 空态、加载态、失败态三态齐全；失败提示必须说清「消息还在队列里」。
- 动效：队列条出现/消失 180ms 高度+透明度；面板用 Vaul 默认；`prefers-reduced-motion` 下不位移。

## 6. 验收清单（可逐条勾）

**功能**

- [ ] 运行中发送文字 → 入队，输入清空，提示含条数；本轮结束自动发出且只发一次。
- [ ] 运行中发送图片 → 入队；打开单条详情能按需拉到缩略图（native `bodyBase64`）；结束后图片真实到达 Codex；拉取失败显示「图片 N 张 + 文件名」，不裂图。
- [ ] 聊天里已发送的真实照片在模拟器上能显示（相对地址不再直接进 `<img>`）；这是既有碎图的回归修复。
- [ ] 运行中发送普通文件 → 入队，状态带文件名；结束后文件在 Codex 侧落盘且消息含引用。
- [ ] 运行中发送带引用块的文字 → 入队、取回、单条详情全文逐字不丢（`>` 行保留）。
- [ ] 多条（≥3）排队 → 顺序与入队一致；上移/下移/移到队首后顺序改变且立即持久化。
- [ ] 取回编辑：文字、图片、文件全部回到输入框/托盘；队列少一条；改完再发成功；输入框非空时只弹「替换当前草稿？」。
- [ ] 插入本轮：运行中点「插入本轮」→ 消息进入当前轮（不是下一轮）；队列少一条；非运行中置灰并写原因；409 只提示失败，不偷偷改成别的动作。
- [ ] 删除：二次确认后队列少一条；发送中/待确认的项**所有动作全禁用**（含删除）并给出同一句原因。
- [ ] 失败项：显示失败原因（≤200 字）与重试；重试成功后继续后续队列；从失败队列条进入直接展开该条详情。
- [ ] 停止本轮：队列暂停；不点恢复不会发出；恢复后按序发出；恢复不会在等待审批时插队。
- [ ] 空队列不显示队列条；队列条与面板数字一致；五种状态（空/1 条/发送中/暂停/队首失败）文案与状态一致。

**边界**

- [ ] 20 条上限：第 21 条被拒并提示上限，草稿保留。
- [ ] 非运行中发送：仍走原即时发送，不出现排队条（有队列时除外）。
- [ ] 断网入队失败：草稿与附件保留，错误可读，不误报离线（HTTP 4xx 不显示离线）。
- [ ] 刷新/重进会话：队列从服务端恢复，顺序不变。
- [ ] 服务重启：未暂停的队列继续，暂停的仍然暂停。

**视觉**

- [ ] 390×844、390×640（键盘）、320×568 截图：无横向溢出、无遮挡、按钮不换行、点击目标 ≥44。
- [ ] 队列条、面板、单条面板均符合 UI_SPEC token 与 Lucide 规格。
- [ ] 设计门禁（NB3）签字：信息层级、主要动作、危险动作可辨识。

**回归**

- [ ] `npm test`、`npm run app:typecheck`、`npm run app:build` 全绿。
- [ ] `node tools/qa/check-redesign.mjs --build --require`、`check-226-device.mjs` 全绿。
- [ ] 发送链路既有测试（`app-send-faults`、`app-send-pipeline`）不回归。
- [ ] Android `testDebugUnitTest` / `lintDebug` 全绿；模拟器安装后实机路径走查一遍。

## 7. 交付与报告

- 版本：2.3.0（视觉/功能成组发布；APK + Windows server zip 同步，版本号以实际 bump 为准）。
- 对标报告：Codex Desktop（本机 26.1111.9664.0，主基准）、ChatGPT、Claude、Cursor、GitHub Copilot、Gemini；维度见报告。报告必须区分「有证据」与「未验证」，并给出我们做/不做的理由。
- 报告交付物：`public/downloads/turnloom-queue-report.html`，同时走 Main stream 附件 + `http://192.168.0.115:8899/…`。
