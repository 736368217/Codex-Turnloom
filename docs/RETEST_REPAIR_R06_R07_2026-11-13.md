# 独立复测 R06–R07 修复记录 — 2026-11-13

对应独立复测报告 `main-branch-quality-retest-074266ff.md` 的 R06/P1、R07/P2，在 `074266ffded3a07ddae1c47e60e0544a7634ea07` 之后修复。两项报告问题均已按手机主场景重做并用**实际安装的 APK** 验证；这不等于独立复测已通过，也不等于 8 项未完成验证全部补齐。

## 修复

| 编号 | 修复内容 | 本轮验证 |
| --- | --- | --- |
| R06 / P1 运行中 Enter 误触发 Stop | 新增 `app/src/lib/composerSubmit.ts`：`composerSubmitDecision({running,text,attachmentCount})` 只产出 `blocked-running` / `empty` / `send`，`shouldSubmitOnEnter` 统一处理 Enter、Shift+Enter、`isComposing`、Android IME `keyCode 229`。`ChatComposer` 运行中把主按钮渲染成独立 `type="button"` 停止按钮（`aria-label="停止"`），发送按钮只在空闲态 `type="submit"`；运行中 textarea 用 `enterKeyHint="done"`。`ChatDetailScreen` 表单 `onSubmit` 只发送，`blocked-running` 时保留草稿并提示“当前任务仍在运行…请先点‘停止’或等待本轮结束”，不再调用 `interruptThread`；停止改由独立 `stopRunning` 触发。 | 实际 APK：运行中按 Enter，隔离服务收到 `sends=0 / interrupts=0`，草稿保留；点停止按钮 `interrupts=1` 且 body 的 `threadId` 为当前会话；空闲 Enter `sends=1` 且不增加 interrupt；真实系统输入法显示时发送键 rect bottom 662.5 < 可视 675 且真实触点可点。Shift+Enter / 组合输入 / `keyCode 229` 由生产 TS 模块单测覆盖。 |
| R07 / P2 Stop 后列表仍显示运行中 | 新增 `app/src/lib/threadProjection.ts`：`projectThread(thread,statusByThread)` 按 `threadId` 产出唯一 `status/tone`，权威 per-thread 状态优先，旧列表不能把 running 写回；无权威时才退回 thread 原始 error。`TaskStream`、`ThreadsScreen`（含“运行中”筛选）、`HomeScreen` 任务卡、`MonitorsScreen`、`dataStore.deriveCounters` 全部改用同一投影。`dataStore` 增加状态纪元（`statusEpoch`/`epochFor`/`bumpStatusEpoch`）：send 与 interrupt 成功推进纪元，`refreshMessages`/`refreshThreadStatus` 捕获纪元，Stop 之前发出的旧状态响应到达后直接丢弃；interrupt 不再立刻触发 `refreshThreadStatus`。 | 实际 APK：Stop 后监控运行数字 0、运行列表空态、会话列表同一行徽标“已结束”、运行中筛选为空、首页任务卡“已结束”。隔离服务在 Stop 后继续返回旧的运行列表，界面仍不复活 running；单测覆盖 Stop 前 in-flight 轮询迟到、旧列表抵达、嵌套抽屉返回。 |

R01–R05 的审批精确 thread/request/kind/hash 绑定、10 分钟 TTL、决定白名单、并发一次提交、未知 IPC 超时不重放，以及原生返回层、监控派生逻辑保持不动。

## 回归结果

- `node --test test\app-state-recovery.test.cjs test\app-mobile-actions.test.cjs test\app-chat-contract.test.cjs`：29/29 通过（含 R06 决策、R07 投影、Stop 前迟到轮询、旧列表覆盖、嵌套返回）。
- `npm run verify:ci` 最终 PASS：Node 24 与 Node 22 各 366 通过、0 失败、0 取消；`npm run check` 与 `desktop:check` 通过。
- 构建脚本内 TypeScript `--noEmit`、Vite 生产构建、native-shell `assembleRelease`、签名与 badging 均成功，`build-result.json` 为 `result: ok`。本轮未改原生 Java 逻辑，未额外宣称重跑原生 JVM 单测。

## 本轮手机 APK 证据

- 版本 2.1.2 / 83，未发布候选；v2.1.1 发布保持不变。
- APK 与安装后拉回的 `base.apk` SHA-256 一致：`16e38f0387142673c810a7e71e431f60d87a29976cfb064aaf20ad45c07775f0`，1776469 bytes。
- 实际设备：Android 35，1080×1920 / 440dpi，合法 phone 租约 index 1；ADB 原生触点与系统返回键。
- R06/R07 手机专项：12/12；其中 7 张原生 PNG 均为 1080×1920 且绑定该 APK。
- 通用文件与失败恢复（实际 APK + 隔离服务）：5/5。137 bytes 文件 SHA-256 `2730feebdd10ced3d7e706f02b4538dde085a271a239de301922c8682347efa7`；取消不产生附件；503 保留草稿与附件；重试沿用同一 `clientRequestId` `app-1794589228699-0mycmh3c` 且字节哈希一致；断网提示保留草稿，服务恢复后发送成功。
- 真实 Codex 宿主连续多轮（实际 APK + 真实后台）：会话 `01a1d5de-b337-7191-b2b5-a3660d8b255e`，两轮分别收到真实 assistant 回复 `TURNLOOM_REAL_REPLY_1` / `TURNLOOM_REAL_REPLY_2`，手机界面同时显示。
- 构建前记录的 47 个前端/构建输入文件哈希与工作区逐个一致，0 处不符；完整源码归属以本次修复提交为准。
- 两个（可删）QA 会话的 `threads` 行已在 `D:\codex\.codex\state_5.sqlite` 精确备份后归档（258 → 256 活跃）。未操作任何真实用户任务、审批或供应商。临时服务已停止（7462/7463 无监听），`adb reverse/forward` 已清空，调试端口随普通启动关闭。

本地离线画廊为 `dist-app/retest-r06-r07-2026-11-13/index.html`，清单同目录。原始构建、测试、安装、设备与真实宿主结果在本会话 scratch 的 `retest-r06-r07/`；配对私密备份、真实访问码与 QA 行备份不提交、不发布。

## 8 项未完成验证的本轮状态

| 项 | 状态 | 证据类别 |
| --- | --- | --- |
| 软键盘下 Send 真实触点可达 | 通过 | 实际 APK（真实系统输入法 + ADB 触点） |
| 新建任务内嵌套模型抽屉逐层 Back | 通过 | 实际 APK（系统返回键） |
| 通用文件完整字节 / 取消 / 重试 | 通过 | 实际 APK + Android 系统文件选择器 + 隔离服务 |
| 受控断网重连 | 通过 | 实际 APK + 隔离服务（停止/重启同端口） |
| 真实助手连续多轮角色回复 | 通过 | 实际 APK + 真实 Codex 宿主 |
| 真实宿主接受 model / effort | **部分通过** | 实际 APK + 真实宿主 + 直接接口探针 |
| 公网手机链路 | **受阻** | 仅本机探测 |
| 全部抽屉 / 长会话 / 分页 / 服务切换组合 | **未完成** | 仅单测覆盖分页与 harness 切换 |

model/effort 的精确结论：手机 UI 显示 `GPT-5.6-Sol · 低`；真实 `turn_context` 在两轮都是 `model: gpt-5.6-sol`。第二轮的 `effort: low` 与请求一致；**新建任务的第一个 turn 被宿主固定为 `effort: high`**。用直接接口复现：`POST /api/send` 带 `newThread:true, model:gpt-5.6-sol, effort:low`，返回的会话首轮 `turn_context.effort` 仍是 `high`，说明 App 已如实发送、丢参数发生在宿主/Codex app-server 的新建线程路径，不是本轮前端改动引入。新建任务卡片因此会短暂显示与首轮实际强度不同的值，属已知宿主限制，未在本轮伪装修复。

## 给独立复测的边界

**手机端是主场景：用户经常用手机发消息，电脑控制台通常只在后台。** 复测请优先用实际 APK：R06 的运行中 Enter / 附件提交 / 停止按钮，R07 的列表徽标、运行中筛选、首页任务卡、监控在 Stop 前后的同源状态。

不要把这些当成本轮通过：上一轮 `074266ff` 的 6/6、HTTP 200、构建成功、桌面截图、固定 assistant 夹具文字。本轮真实 Codex 只在 Codex 侧通过；**PI 默认供应商此前的上游 HTTP 400 未修复也未重测**，不能据此声称 PI 真实消息可用。公网 `121.40.69.97:443` 与 `:18787` 仍连接失败，ADB reverse 或隔离服务不等于公网可用。长会话分页、全部抽屉组合、服务切换组合流程仍未在手机上走完；主观视觉评分未建立。候选 APK 未发布，`v2.1.1` 标签与产物保持不动。
