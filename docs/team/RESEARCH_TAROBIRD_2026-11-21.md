# TaroBird 评估：值得抄的不是功能，是三条工程机制

> 作者 @NB3 · 2026-11-21 · 只读调研，未构建、未运行、未调用任何模型
> 对象：[cloveric/tarobird](https://github.com/cloveric/tarobird)（main，2026-11-21 抓取）
> 证据：README、`docs/architecture-notes.md`、`docs/state-model.md`、`docs/bus-protocol.md`、
> `docs/change-rules.md`、`docs/release-checklist.md`、`prompt-queue` / `dispatcher-bot` /
> `agent-bus` / `cross-host-message-permissions` / `run-diff` 五份设计文档、仓库 tree 与
> `package.json`。**只读文档和结构，不等于真机或源码行为验收；下文引用其文档时按“作者自述”看待。**

## 0. 结论

1. **工程上值得认真学，产品上不是我们的直接竞品。** 它做的是“多引擎 CLI 的桌面 + 手机 IM +
   多机网络 + 工作台”全家桶；我们做的是“Codex Desktop / PI-Desktop 的手机工作台”。重叠在
   会话、队列、审批、投递，不重叠在编排与工作台。
2. **最该抄的是三条机制，不是功能清单**：
   - 出站投递账本（可恢复、可见、绝不静默重复）；
   - 每个写操作带 `requestId + revision`，未知结果只核对、不自动重发；
   - 能力按入口显式声明（`prompt-queue.v1` / `dispatch.v1`），旧端不冒充支持。
3. **不能抄代码。** 仓库是 **AGPL-3.0-only**；我们 MIT。抄实现会传染许可。抄**协议语义、
   状态机、交互与文档结构**是安全的（思想不受版权保护），但要自己重写并留证。

## 1. 事实底座

| 项 | 数值 |
|---|---|
| 版本 / 创建 | 1.5.1；仓库创建于 2026-11-05，16 天 319 次提交 |
| 规模 | 5,109 个 tree 条目；`src/` 573 个文件、`client/src/` 871 个、`tests/` 725 个（其中 662 个 `*.test.ts`）、`docs/` 870 份 Markdown |
| 技术栈 | TypeScript / Node ≥22.12；SQLite（`hub.sqlite`）+ 文件 JSON store；`ws`、`zod`；Electron 桌面；iOS/Android 客户端；headless CLI |
| 引擎 | Codex、Claude Code、Kimi Code、DeepSeek Harness、Antigravity（全部走官方 CLI，不重写 agent） |
| 许可 | AGPL-3.0-only（另有 baoyu-design 混合许可的 vendor 目录） |
| 社区 | 154 stars / 26 forks（抓取时）；App Store 上架 + TestFlight + Windows 安装包（未签名） |
| 自述测试量 | 全量门禁 338 个文件、4,609 项通过（其 `agent-bus` 文档 2026-10-18 记录） |

对比我们（同日）：2.4.0、86 个测试文件、`server.js` 9,910 行单文件、40 份 docs、11 份 team docs。
**差距不在功能点，在“一个改动如何被证明”的密度。**

## 2. 它做对了什么（按可复用价值排序）

### 2.1 出站投递账本：把“不确定”当成一等状态

`docs/state-model.md` 的 `delivery-obligations.json` 是本项目最值得抄的一页：

- 每一条要发出去的最终回复一行，状态 `pending → attempting → delivered / failed`；
- **只有每个附件和每段文字都拿到确定成功，才记 `delivered`**；附件 ACK 被拒或含义不明，
  整行保持 `failed`，这一轮明确标成 partial；
- 启动时 `sweepRecoverable` 只认领“属主进程已死”的未投递行，再重投；
  `pending`（还没开始发）平静重发，`attempting/failed` 加可见 `♻️` 标记——
  **诚实的 at-least-once，绝不静默重复**；
- 重投时只允许 `send.file/image/audio/video/batch` 与整段 `file:` 块，**剥掉 cron 和其它副作用工具**，
  不把“重发消息”变成“重跑任务”；
- 10 分钟内 3 次脏启动（上次没干净退出）触发熔断：这一次跳过启动恢复，
  防止一条毒消息把受监管服务反复打死；人工正常重启不计入。

这条机制直接回答了我们的老问题：服务重启后，队列里 `sending` 的那条到底发没发？
我们现在把 `sending` 降级成 `awaitingConfirmation`（`server.js:6293`）——方向对，
但缺三件事：**统一的账本、可见的“已恢复”标记、防毒重放的熔断**。

### 2.2 写操作三件套：requestId、revision、业务拒绝回执

`prompt-queue` 文档把并发写讲透了：

- 客户端提交**自己看到的队列版本**；过期版本返回冲突，**绝不悄悄覆盖另一台设备的操作**；
- 每次修改有独立请求编号；**响应丢失时，用同一编号和相同参数核对，不能生成新编号重试未知结果**；
- 业务拒绝也要落库：同编号重试返回原拒绝结果，避免“迟到的重试又执行一次”；
- 已下发状态持久化，重连/重启不能把它恢复成可编辑；旧数据里无法确认是否下发的，按**已下发**处理。

我们的队列已有 `clientRequestId` 幂等（`server.js`、`QUEUE_SPEC` §3.5），但没有
revision 冲突与“同编号核对”的完整语义；跨设备同时改队列时，现在只能靠“服务端为准”吞掉一边。

### 2.3 能力门控：不支持就不显示，不静默降级

- 只有目标主机和 worker 明确支持 `prompt-queue.v1` 才显示队列操作；
  新 Hub 配旧 worker、未知引擎、群聊、话题子对话**都不冒充支持**；
- 已下发 ≠ 已执行，界面不把它标成“正在运行”；
- `capability-map.md` 把每个引擎“能做什么、缺什么”写成表，UI 依表开关。

我们有两个入口（Codex Desktop / PI-Desktop）和一个 `/api/*` 契约，最容易犯的错就是
“Codex 有、PI 没有，UI 却两边都画”。这张表应该成为我们的 `docs/CAPABILITY_MATRIX.md`。

### 2.4 任务编排：Chancellor 的工单账本

`dispatcher-bot` 文档展示了一个可复用的工单状态机：

- 票据状态 `queued / working / needs_answer / needs_review / blocked / done / cancelled`；
- 每个票据一个隐藏 worker 会话、一个独立工作目录 `<workspace>/tickets/<id>`，
  换引擎继续时仍用同一目录；
- 引擎不可用按类别冷却（quota / auth / rate-limit / backend / cli），冷却期内拒绝派发，
  只有**开始时间晚于故障记录**的成功才清除冷却；
- 并发上限、暂停/取消/接受都按请求 ID 幂等；停止意图持久化，票据保持 working 直到投递终态；
- 崩溃不会让票据在没有通知的情况下“结算”，通知与状态更新在同一事务里。

我们不该整套抄（见 §4），但**“停止意图 = 持久化状态，不是一次 RPC”** 和
**“引擎冷却要带开始时间比较”** 这两条，直接适用于我们的停止与错误恢复。

### 2.5 权限与网络：加入网络 ≠ 获得访问

跨主机授权是**单向**的：接收方 owner 按“来源主机/Bot → 接收 Bot”逐向批准；
授权只允许列会话名、发协作消息和文件；发件人只能取回自己任务的回复；
加入网络、连上 App 都不自动授权；已离开/已删除的来源进入“只能撤销”列表；
保存回执丢失时，界面保留未确认结果，**不自动重试**。

这套形状比“配对即全权”安全得多，适合我们以后做“手机管多台电脑”。

### 2.6 每轮改动可审：run diff + 行内评论

`run-diff` 把每轮回复实际编辑过的文件记录下来，桌面端可逐文件查看、在行上评论并发回给 Bot。
对我们这种“手机看电脑上的 Codex”的产品，这是比“工具日志”更高价值的一层：
用户真正想知道的是**这轮改了什么、我同不同意**。

### 2.7 文档即门禁

- `docs/change-rules.md` 开头就写“防的是同一种故障：修了一条路径，另一条入口还是旧行为，
  测试因为只覆盖一条路径而全绿”——这正是我们 Codex/PI 双入口的风险；
- `docs/state-model.md` 逐文件写清 owner、权威数据、写规则、恢复规则、敏感级别；
- `release-checklist.md` 有版本一致性检查、依赖清单、上传隐私门禁、RC→stable 的 owner 试用；
- 审计文档固定写“**这次没有验证什么**”（没装 App、没上真机、没跑真实模型），不把
  源码复核说成真机验收。

### 2.8 测试的形态

662 个测试文件不是“多”，是**分层清楚**：真实 Hub/Gateway + 脚本化引擎、
浏览器旅程、CLI 真入口、协议兼容、故障注入（响应丢失、迟到响应、断线、重启）。
他们反复用“先复现失败，再修复，再回归”的写法，这一点和我们 `AGENTS.md` 的验收口径一致，
只是执行密度高一个量级。

## 3. 可以抄什么（按我们的优先级）

### P0 · 2.5.0 之前值得做（低成本、直接修痛点）

| # | 机制 | 落点 | 验收 |
|---|---|---|---|
| A | 出站投递账本 + 启动清扫 + `♻️ 已恢复` 标记 + 3 次脏启动熔断 | `server.js` 发送/队列/附件；状态写入现有 state 目录 | 杀掉进程在发送中断言：重启后只重发一次、界面可见、副作用工具不重跑；连续 3 次脏启动跳过恢复 |
| B | 队列写操作加 `expectedRevision`；未知结果用同 `requestId` 核对；业务拒绝落库 | `/api/queue/*`、`/api/send?mode=queue`、`QUEUE_SPEC.md` | 两台设备并发改同一条：后者 409 并保留文字；响应丢失后同 ID 重试只生效一次；迟到重试返回原拒绝 |
| C | `docs/CAPABILITY_MATRIX.md`：入口 × 能力表，UI 只画支持的操作 | `docs/option-a/`、`app/src` 能力开关、`/api/*` 返回 501/409 而非静默降级 | 每个能力至少两条断言：支持端可见、非支持端不可见且服务端拒绝 |
| D | 每轮改动汇总：把工具/文件事件聚成“本轮改了哪些文件”，逐文件查看 | 对话页 + 只读 Codex 数据 | 一轮多文件编辑后，列表与真实文件一致；无改动不渲染空卡 |

### P1 · 下一阶段

| # | 机制 | 为什么适合我们 |
|---|---|---|
| E | 多机单向授权（join ≠ access，接收方批准，只能撤销的残留记录） | 我们已有多电脑配对，但只是隔离，没有互访授权 |
| F | 路由健康与显式选择（LAN / Tailscale / VPS relay，显示当前走哪条、为什么） | 我们已有 relay 文档，缺“当前路径”的可见性 |
| G | 引擎错误分类加“配额 / 需登录”两类 + 冷却状态 | 现在多半落到通用错误，用户不知道该等还是该登录 |
| H | 发布预检模板：版本一致性 / 依赖清单 / “这次没验证什么” | 我们的 release 脚本已有三步校验，补文档模板即可 |

### 不抄 · 抄了会摊薄

- **Chancellor 整套工单调度、Agent Bus 可视化、ADHD 12 宫格、Workbench（Canvas/白板/PPT）、
  远程屏幕、5 引擎适配、iOS + Android 双原生端**：这是“全家桶”打法，靠 662 个测试文件和
  870 份文档托底；我们只有一条交付线和更小的团队，抄功能面会把每个功能都做浅。
- **默认 full access / YOLO**：README 自己写着“多数引擎默认全权限”。我们刚经历误删事故，
  这条是反例，不是范本。
- **AGPL 代码**：任何文件级复制都不行；连“改写变量名”的衍生也风险高。只读设计。
- **870 份文档的体量**：学模板（change-rules / state-model / release-checklist），
  不学数量。文档超过维护能力就会和代码漂移。

## 4. 如何评价它（一句话版）

**产品判断准、工程纪律罕见、范围明显过大。**
它最聪明的地方是“不重写 agent，只做 CLI 的操作系统”：原生 CLI 保留各自能力，
它只补会话、队列、投递、权限、编排。最危险的地方也一样明显：5 个引擎 × 3 个端 ×
工作台 × 网络 × 屏幕控制，任何一处浅了都会变成“演示很全、日常难用”；它自己在 README 里
承认 Agent Bus / 群聊 / Chancellor 仍限单主机，就是广度的代价。

## 5. 建议的下一步（给 owner 排期用）

1. **A + B 合成一个 2.5.0 任务**：`delivery ledger` 与 `queue revision` 都改 `server.js` 的发送路径，
   一起做能共用一套状态与测试夹具，估计 1–2 天（含故障注入）。
2. **C 单独做**，只写文档 + UI 开关，不改协议；它能让 D 的验收有依据。
3. **D 先做只读版**（列出本轮改了哪些文件），行内评论留到下一版；只读版不碰 Codex 写入边界。
4. 不建议现在启动 Chancellor/Agent Bus 类功能；等 A–D 稳定、真机验收补齐后再评估。

## 6. 证据索引

- 仓库：https://github.com/cloveric/tarobird
- 架构与执行核心：https://github.com/cloveric/tarobird/blob/main/docs/architecture-notes.md
- 状态模型（投递账本、熔断、逐文件 owner）：https://github.com/cloveric/tarobird/blob/main/docs/state-model.md
- 队列语义：https://github.com/cloveric/tarobird/blob/main/docs/client/prompt-queue-2026-10-14.md
- 工单/Chancellor：https://github.com/cloveric/tarobird/blob/main/docs/client/dispatcher-bot-2026-11-01.md
- Agent Bus：https://github.com/cloveric/tarobird/blob/main/docs/client/agent-bus-workspace-2026-10-18.md
- 跨主机授权：https://github.com/cloveric/tarobird/blob/main/docs/client/cross-host-message-permissions.md
- 每轮 diff：https://github.com/cloveric/tarobird/blob/main/docs/client/run-diff-2026-10-20.md
- 变更规则：https://github.com/cloveric/tarobird/blob/main/docs/change-rules.md
- 发布清单：https://github.com/cloveric/tarobird/blob/main/docs/release-checklist.md
- 本地协议：https://github.com/cloveric/tarobird/blob/main/docs/bus-protocol.md
