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

- 运行中且输入框有内容：并排两个 44×44 按钮——**发送（排队）** 蓝色箭头 + **停止** 红色方块。输入为空时只显示停止。
- 运行中按发送 = `mode:"queue"`，成功后清空输入与附件托盘，保留焦点，轻提示「已排队 · 第 N 条」，提示里带「查看」打开队列面板。
- 运行中按 Enter 同样排队（不是 `blocked-running`）。
- 输入框上方出现一行 12px 辅助说明（仅运行中且有内容、队列为空时）：「本轮运行中，发送会排队，结束后自动发出」。不占固定高度，不推挤消息区。
- 停止本轮不丢队列：队列暂停，见 2.4。

### 2.2 队列条（常驻在输入区上方）

- `queueLength > 0` 时显示，高 36（命中区 44），白底/浅灰底，圆角 12，内容：
  - `ListOrdered 14` + 「N 条排队」；
  - 右侧状态：`下一条将在本轮结束后发送` / `正在发送…` / `队列已暂停` / `1 条发送失败`；
  - `ChevronRight 14`。
- 点整条打开「排队消息」面板。
- 暂停时队列条右侧直接给「恢复」文字按钮（44 命中），不用进面板才能恢复。
- 失败时文字用 `--tl-red`（`#FF3B30`），点开面板定位到失败项。

### 2.3 排队消息面板（Vaul 底部抽屉）

- 标题「排队消息」，副标题「本轮结束后按顺序发送。可编辑、插队或删除。」
- 暂停时顶部一张浅橙提示条：「你中断了本轮，队列已暂停。」+「恢复队列」按钮（44）。
- 列表行（最小 56 高，整行可点）：
  - 左侧 22×22 序号圆（1、2、3…）；
  - 中间 2 行预览（15px/21px），附件元信息一行 12px：`图片 2 · 附件 1 · 引用`；
  - 右侧状态徽标：`排队中`（灰）/`发送中`（蓝，转圈）/`待确认`（蓝）/`失败`（红）；
  - 末尾 `ChevronRight 16`。
- 空态：「没有排队消息」+「本轮运行中时，发送的消息会排在这里。」
- 底部说明：「最多 20 条。发送中的消息不能编辑或删除。」

### 2.4 单条消息面板

点列表行打开，标题「排队消息 N」，副标题是状态（如「等待本轮结束」/「发送失败」）。

内容：完整文本（可选中），图片缩略图最多 4 张，文件 chip（`Paperclip` + 文件名 + 大小），引用块原样显示。

操作（每行 44 高，图标 20 + 文字 15px）：

1. **取回编辑**（`Pencil`）：调用 `/api/queue/cancel` `{edit:true}`；把返回的 `text/images/files` 放回输入框与附件托盘，队列表项消失。输入框已有内容时先确认「替换当前草稿？」。
2. **插队发送**（`CornerUpLeft`）：仅运行中可用，调用 `/api/queue/steer`，立即并入当前轮；成功提示「已插队发送」。若本轮已结束（409），改为「移到队首」并提示「本轮已结束，已移到队首」。
3. **上移 / 下移**（`ArrowUp` / `ArrowDown`）：调用 `/api/queue/reorder` `{direction}`；首/末项禁用。>1 条时始终显示。
4. **重试**（`RotateCw`）：仅 `failed` 项显示，调用 `/api/queue/retry`。
5. **删除**（`Trash2`，红色）：二次确认「删除这条排队消息？」；调用 `/api/queue/cancel`。

发送中/待确认：除「删除」外全部禁用，并显示「正在发送，暂时不能修改」。

### 2.5 队列生命周期

- 本轮结束后，服务端按顺序自动发送队首；两条之间至少 1.5s 空闲确认，避免撞轮。
- 用户点停止：本轮中断，队列进入暂停；队列条与面板显示「已暂停」，必须点「恢复」才继续。防止用户停止后消息被偷偷发出。
- 队列项发送失败：状态 `failed`，不阻塞后面的项？**不**——保持队首阻塞，用户重试/删除/编辑后才能继续，避免乱序。面板给出原因（服务端 `lastError`，截断 200 字）。
- 删除、取回后若队列为空，队列条消失，停止按钮保持原样。

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

### 3.2 `POST /api/queue/reorder`

```json
{ "threadId": "…", "itemId": "…", "direction": "up|down|top" }
```

- 仅 `queued` / `failed` 可动；`sending` / `awaitingConfirmation` 返回 409「正在发送，暂时不能调整顺序」。
- 返回 `{ ok, threadId, ...status }`。
- PI 原生队列：桥不支持时返回 409 `queue_reorder_unsupported`（「当前后端不支持调整顺序」），不假装成功。

### 3.3 `POST /api/queue/resume`

```json
{ "threadId": "…" }
```

清除该线程的暂停标记并调度 drain，返回 `{ ok, threadId, queuePaused: false, ...status }`。

### 3.4 既有接口扩展

- `POST /api/send` `mode:"queue"`：
  - 入队文字 + 图片 + 普通文件；返回 `{ ok, queued:true, queueItem, queueLength, queuePaused }`。
  - `clientRequestId` 幂等保持不变。
  - 入队时**不**把文件 stage 成路径写进 `text`；文件随队列项保存，发送时再 stage。
- `POST /api/queue/cancel` `{edit:true}`：返回 `draft: { text, images, files }`（图片/文件为 base64），供取回编辑。取消后位置不留空洞。
- `POST /api/queue/steer`：保留现有语义（立即并入当前轮），失败原样恢复到原位置。
- `POST /api/interrupt`：中断成功后，若该线程队列非空则置 `queuePaused=true`，返回 `queuePaused`。
- `GET /api/threads/:id/messages` 的 `status` 继续带 `queueLength / queuePaused / queuedMessages`，手机端 3s 轮询即可保持同步。

### 3.5 上限与持久化

- 每线程最多 20 条；单条文字 ≤ 12000 字；图片 ≤ 4；普通文件 ≤ 4；单条总 base64 ≤ 24MB（请求体总上限沿用 32MB）。
- 队列文档沿用 `pendingSendQueues` 的原子写；新增 `files` 与 `paused: [threadId]` 字段，schema 版本 +1，旧文档可读（缺字段按空处理）。
- 服务重启后恢复队列与暂停标记；恢复后不自动发送暂停队列。

## 4. 客户端数据契约

- `ThreadRuntimeStatus` 增加：`queueLength: number`、`queuePaused: boolean`、`queuedMessages: QueueMessage[]`。
- `QueueMessage`：`id, position, text, preview, imageCount, fileCount, images, files, enqueuedAt, deliveryState, lastError`。
- `postSend` 的 `SendOptions` 增加 `mode?: 'start' | 'queue' | 'steer'`，`sendBody` 原样透传。
- 新增 API 函数：`getQueueStatus`、`postQueueReorder`、`postQueueResume`。
- `composerSubmitDecision` 增加 `{ kind:'queue' }`：running 且非空 → queue。
- 队列相关状态只从服务端读，不在本地伪造 `deliveryState`；发送动作后立刻用响应里的 status 覆盖。

## 5. 视觉与可用性硬约束

- 只用 Option A token：`#F2F2F7` 画布、白卡、`#E5E5EA` 分隔、`#007AFF`、`#FF3B30`；不引入新色。
- Lucide 图标，尺寸 14/16/20/22，stroke 2；不混用其它图标集。
- 所有可点目标 ≥44×44；行高 ≥44；390 / 360 / 320 无横向溢出；键盘弹出不遮输入区；底部抽屉不遮队列条以外的主要操作。
- 运行时按钮组不换行（320 宽下仍一行）；模型 chip 截断规则不变。
- 空态、加载态、失败态三态齐全；失败提示必须说清「消息还在队列里」。
- 动效：队列条出现/消失 180ms 高度+透明度；面板用 Vaul 默认；`prefers-reduced-motion` 下不位移。

## 6. 验收清单（可逐条勾）

**功能**

- [ ] 运行中发送文字 → 入队，输入清空，提示含条数；本轮结束自动发出且只发一次。
- [ ] 运行中发送图片 → 入队，状态里能看到缩略图接口；结束后图片真实到达 Codex。
- [ ] 运行中发送普通文件 → 入队，状态带文件名；结束后文件在 Codex 侧落盘且消息含引用。
- [ ] 多条（≥3）排队 → 顺序与入队一致；上移/下移后顺序改变且立即持久化。
- [ ] 取回编辑：文字、图片、文件全部回到输入框/托盘；队列少一条；改完再发成功。
- [ ] 插队：运行中点插队 → 消息进入当前轮（不是下一轮）；队列少一条。
- [ ] 删除：二次确认后队列少一条；发送中的项删除被拒并给出原因。
- [ ] 失败项：显示失败原因与重试；重试成功后继续后续队列。
- [ ] 停止本轮：队列暂停；不点恢复不会发出；恢复后按序发出。
- [ ] 空队列不显示队列条；队列条与面板数字一致。

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
