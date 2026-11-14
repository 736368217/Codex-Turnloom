# 独立复测 R06–R07 修复记录 — 2026-11-13

对应独立复测报告 `main-branch-quality-retest-074266ff.md` 的 R06/P1、R07/P2，修复提交为 `398f924a29adca033db1857f9d5d285edc8fb651`。2026-11-14 原审查会话完成实际 APK 独立复测：**R06/R07 在覆盖场景中通过，17 项手机行为检查通过、14 张原生截图**。独立结果与下文开发自测分别计数，不合并为独立用例总数；完整手机流程仍有未覆盖范围。

## 修复

| 编号 | 修复内容 | 本轮验证 |
| --- | --- | --- |
| R06 / P1 运行中 Enter 误触发 Stop | 新增 `app/src/lib/composerSubmit.ts`：`composerSubmitDecision({running,text,attachmentCount})` 只产出 `blocked-running` / `empty` / `send`，`shouldSubmitOnEnter` 统一处理 Enter、Shift+Enter、`isComposing`、Android IME `keyCode 229`。`ChatComposer` 运行中把主按钮渲染成独立 `type="button"` 停止按钮（`aria-label="停止"`），发送按钮只在空闲态 `type="submit"`；运行中 textarea 用 `enterKeyHint="done"`。`ChatDetailScreen` 表单 `onSubmit` 只发送，`blocked-running` 时保留草稿并提示“当前任务仍在运行…请先点‘停止’或等待本轮结束”，不再调用 `interruptThread`；停止改由独立 `stopRunning` 触发。 | 实际 APK：运行中按 Enter，隔离服务收到 `sends=0 / interrupts=0`，草稿保留；点停止按钮 `interrupts=1` 且 body 的 `threadId` 为当前会话；空闲 Enter `sends=1` 且不增加 interrupt；真实系统输入法显示时发送键 rect bottom 662.5 < 可视 675 且真实触点可点。Shift+Enter / 组合输入 / `keyCode 229` 由生产 TS 模块单测覆盖。 |
| R07 / P2 Stop 后列表仍显示运行中 | 新增 `app/src/lib/threadProjection.ts`：`projectThread(thread,statusByThread)` 按 `threadId` 产出唯一 `status/tone`，权威 per-thread 状态优先，旧列表不能把 running 写回；无权威时才退回 thread 原始 error。`TaskStream`、`ThreadsScreen`（含“运行中”筛选）、`HomeScreen` 任务卡、`MonitorsScreen`、`dataStore.deriveCounters` 全部改用同一投影。`dataStore` 增加状态纪元（`statusEpoch`/`epochFor`/`bumpStatusEpoch`）：send 与 interrupt 成功推进纪元，`refreshMessages`/`refreshThreadStatus` 捕获纪元，Stop 之前发出的旧状态响应到达后直接丢弃；interrupt 不再立刻触发 `refreshThreadStatus`。 | 实际 APK：Stop 后监控运行数字 0、运行列表空态、会话列表同一行徽标“已结束”、运行中筛选为空、首页任务卡“已结束”。隔离服务在 Stop 后继续返回旧的运行列表，界面仍不复活 running；单测覆盖 Stop 前 in-flight 轮询迟到、旧列表抵达、嵌套抽屉返回。 |

R01–R05 的审批精确 thread/request/kind/hash 绑定、10 分钟 TTL、决定白名单、并发一次提交、未知 IPC 超时不重放，以及原生返回层、监控派生逻辑保持不动。

## 开发自测回归结果（历史证据）

- `node --test test\app-state-recovery.test.cjs test\app-mobile-actions.test.cjs test\app-chat-contract.test.cjs`：29/29 通过（含 R06 决策、R07 投影、Stop 前迟到轮询、旧列表覆盖、嵌套返回）。
- `npm run verify:ci` 最终 PASS：Node 24 与 Node 22 各 366 通过、0 失败、0 取消；`npm run check` 与 `desktop:check` 通过。
- 构建脚本内 TypeScript `--noEmit`、Vite 生产构建、native-shell `assembleRelease`、签名与 badging 均成功，`build-result.json` 为 `result: ok`。本轮未改原生 Java 逻辑，未额外宣称重跑原生 JVM 单测。

## 开发自测手机 APK 证据（历史证据）

- 版本 2.1.2 / 83，未发布候选；v2.1.1 发布保持不变。
- APK 与安装后拉回的 `base.apk` SHA-256 一致：`16e38f0387142673c810a7e71e431f60d87a29976cfb064aaf20ad45c07775f0`，1776469 bytes。
- 实际设备：Android 35，1080×1920 / 440dpi，合法 phone 租约 index 1；ADB 原生触点与系统返回键。
- R06/R07 手机专项：12/12；其中 7 张原生 PNG 均为 1080×1920 且绑定该 APK。
- 通用文件与失败恢复（实际 APK + 隔离服务）：5/5。137 bytes 文件 SHA-256 `2730feebdd10ced3d7e706f02b4538dde085a271a239de301922c8682347efa7`；取消不产生附件；503 保留草稿与附件；重试沿用同一 `clientRequestId` `app-1794589228699-0mycmh3c` 且字节哈希一致；断网提示保留草稿，服务恢复后发送成功。
- 真实 Codex 宿主连续多轮（实际 APK + 真实后台）：会话 `01a1d5de-b337-7191-b2b5-a3660d8b255e`，两轮分别收到真实 assistant 回复 `TURNLOOM_REAL_REPLY_1` / `TURNLOOM_REAL_REPLY_2`，手机界面同时显示。
- 构建前记录的 47 个 `app/src` 文件哈希与修复提交对应工作区逐个一致；独立复测另行从 `398f924a` 构建，核对 APK 内 JS/HTML 字节一致。
- 两个（可删）QA 会话的 `threads` 行已在 `D:\codex\.codex\state_5.sqlite` 精确备份后归档（258 → 256 活跃）。未操作任何真实用户任务、审批或供应商。临时服务已停止（7462/7463 无监听），`adb reverse/forward` 已清空，调试端口随普通启动关闭。

本地离线画廊为 `dist-app/retest-r06-r07-2026-11-13/index.html`，清单同目录。原始构建、测试、安装、设备与真实宿主结果在本会话 scratch 的 `retest-r06-r07/`；配对私密备份、真实访问码与 QA 行备份不提交、不发布。

## 8 项补充验证的收尾状态

| 项 | 状态 | 证据类别 |
| --- | --- | --- |
| 软键盘下 Send 真实触点可达 | **独立通过** | 实际 APK + 真实系统输入法 + Android 触点 |
| 新建任务内嵌套模型抽屉逐层 Back | **独立通过** | 实际 APK + 系统返回键 |
| 通用文件完整字节 / 取消 / 重试 | **字节与重试独立通过** | 独立验收使用 47 B 文件；取消仅有开发自测。慢选首次未进入托盘，重选成功，异常保留 |
| 受控断网重连 | **开发自测通过，未独立完成** | 独立轮的夹具意外中断不计受控断网通过 |
| 真实助手连续多轮角色回复 | **Codex 开发自测通过，未独立完成** | 独立轮只用隔离夹具，不将固定 assistant 文本当真实回复 |
| 真实宿主接受 model / effort | **部分通过，待定位** | 历史证据显示新建首轮请求 low、实际 high；本轮独立未验证 |
| 公网手机链路 | **旧公网服务器已退役，不适用** | 用户 2026-11-14 确认永久停用；新入口须由用户另行指定 |
| 全部抽屉 / 长会话 / 分页 / 服务切换组合 | **未完成** | 仅单测覆盖分页与 harness 切换，手机组合流程未走完 |

model/effort 历史证据：手机 UI 显示 `GPT-5.6-Sol · 低`；两轮 `turn_context.model` 均为 `gpt-5.6-sol`，第二轮 `effort=low`，新建首轮却为 `high`。直接 `POST /api/send` 带 `newThread:true, model:gpt-5.6-sol, effort:low` 也复现首轮 high。该证据证明异常在绕过手机 UI 后仍存在，但尚不能定位到 Turnloom 后端、IPC 适配还是 Codex app-server；不再将“宿主固定 high”当作已确认根因。此问题未修复，本轮独立验收未覆盖。

## 独立验收收尾 — 2026-11-14

原审查会话 `085b0cda-a463-419e-bafc-bafd3bad412f` 独立完成验收，已覆盖的 R06/R07 无需重复送测。业务请求均为实际 APK 发向隔离夹具；未创建真实任务、未发送或停止真实用户任务、未处理真实审批。源码及 APK 身份仍为本报告列出的修复提交和 SHA，文档收尾没有重建或发布 APK。

独立回归：Node 24/22 各 366 pass、0 fail、0 cancelled；相关专项 29/29（与全量重叠）；TypeScript 与 Vite 构建 exit0；APK 内 JS/HTML 与独立构建逐字节一致。17 项行为证据包含真实 Shift+Enter 换行、运行中带文件提交保护、独立 Stop、Stop 后释放暂扣的旧 running 响应、刷新旧列表后的跨页面一致性、47 B 文件 503 后同请求 ID 重试、真实 IME 发送触点及嵌套 Back。原画廊已由复测方验证 14 图加载、390px 无溢出、点击放大/关闭。

原始报告：`main-branch-quality-retest-398f924a.md`（SHA-256 `4eff14c4c9f700fff06a889ce87a3302f578578a347fa920d4fd0974c4476e77`）。本地归档：[独立报告](../dist-app/retest-r06-r07-2026-11-13/independent-review/report.md)、[独立画廊](../dist-app/retest-r06-r07-2026-11-13/independent-review/index.html)、[证据清单](../dist-app/retest-r06-r07-2026-11-13/independent-review/evidence-manifest.json)。这些较大的证据文件保留在本地交付目录，不随文档提交；原件保留在原审查会话 scratch。

归档核对：39 个原清单条目的 SHA/字节数一致，14 张 PNG 均为 1080×1920；APK SHA 与候选一致，原画廊 43 个不同本地引用均存在。此核对复用既有测试证据，没有重新操作设备。

独立报告保留的异常：QA 用户11首次启动 WebView 的 `webview_data.lock` ENOENT，在只清理自有 QA 用户数据后恢复；慢选文件首次托盘未出现、限时内重选成功；夹具进程曾意外结束。恢复后的场景通过不代表这些异常已修复，也不代表通用首次安装或受控断网验收通过。PI 供应商历史 HTTP400、真实宿主 model/effort、PI 多轮、完整组合流程和主观视觉仍未独立闭环。

**旧公网服务器已退役，不适用。** 用户已于 2026-11-14 明确停用 `121.40.69.97`。不再探测、连接、重试、部署或恢复任何端口及依赖旧入口；不列为待恢复故障。新入口须由用户另行指定。本次收尾对该地址网络调用为0。

独立收尾记录：Android 用户回到0且仅剩机主，QA 用户及测试文件回收，自有 forward14116、fixture7831 已清理；租约释放记录 `released:true`，后续池状态 index1 停止且 owner 清空。上述为原审查证据，主会话没有再次启动设备。候选 2.1.2/83 未发布，v2.1.1 标签与产物保持不动。
