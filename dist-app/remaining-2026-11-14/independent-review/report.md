# 主分支第五轮独立复测报告 — HEAD `5a7a6e2e`

- 复测对象：产品提交 `fbd3e529c04ddab100a1f2a091d91c12abba0a59`；最终 HEAD / `origin/main` = `5a7a6e2e6a6307353ea8bbc27439ebed01c59b5c`（后者只修测试 CRLF 读取）
- 新 APK：`Codex-Turnloom-2.1.2-app.apk`，2.1.2 / versionCode 83，1,780,565 B，SHA-256 `4129d2e04be72207bae6fc5a2fdcede221f8d2e95b9acda33f9c38863b3fc234`
- 独立 worktree：`retest-5a7a6e2e`（detached 于 `5a7a6e2e`，复用主仓 `node_modules` junction，不共享构建产物）
- 设备：MuMu phone index 1（1080×1920 / 440dpi），owner 本会话；Android **ephemeral 用户 10** 隔离，机主用户 0 数据未触碰
- 夹具：本会话自有合成 HTTP 夹具（7831 与 7841），**不是**真实供应商，也不是真实 PI 会话
- 网络：旧公网 `121.40.69.97` 已永久退役，本轮对其实测调用 **0 次**

> 本轮范围按上游要求收敛：**不重跑** `398f924a` 包已通过的 17 项手机行为，只做新身份定点补测 + 两个明确限制的独立复测。

---

## 一、结论速览

| 项 | 结果 | 依据 |
|---|---|---|
| 新身份绑定（commit / APK / 包内 bundle） | **通过** | `identity.json`、`headDiffExit=0`、包内 `index-BcyB_JNg.js` 731,414 B |
| 独立 CI（Node 24 / 22） | **通过** 389 / 389，fail 0，cancelled 0 | `verify-ci.json`、`verify-ci.log` |
| 新修复专项（Node 侧） | **通过** 49 / 49 | `focused.json` |
| 首轮/档位类修复（thinkingLevels、首轮 model/effort、sidecar 迁移） | **通过** 13 / 13 | 本轮独立执行，见 §四 |
| **限制①：短超时后同进程再次选中文件** | **通过**（本轮补齐） | §二，含 4 张原生截图 |
| **限制②：PI 真实两轮** | **受阻，根因未定** | §三，宿主控制路径实证 |
| 历史分页 80 → 160 → 205 | **通过** | §五，`paging-verification.json` 9/9 断言 |
| 环境恢复 | **完成** | `device-restoration.json`、`qa-user-cleanup.json` |
| 退役端点访问 | **0 次** | 本轮无任何该地址探测 |

**一句话**：新身份下所有可独立执行的检查全部通过；唯一真实阻塞是 PI 宿主侧 `pi.desktop.invoke` 的 `Plugin host process is no longer active`，已用只读白名单操作实证，根因未定，不据此判产品失败。

---

## 二、限制①：短超时后同进程再次选中文件 —— 通过

上游明确"开发未稳定完成，不能计通过"，因此本轮把它当作唯一重点。为不改产品源码、不重建 App，采用**只缩短那一条计时器**的方式触发真实生产分支：

- 生产实现（`app/src/lib/nativeBridge.ts` L577-613）：`pickAttachments(kind, timeoutMs = 600_000)`，超时后先 `settleAttachmentPick(..., 'picker-timeout')` 再调 `n.cancelAttachmentPick(requestId)`，`finally` 里释放 `attachmentPickBusy`。
- 本轮做法：在已安装 APK 的页面上下文内，仅当 `ms === 600000` 且已布防时把该次 `setTimeout` 改为 2000 ms。**等价于调用受支持参数 `pickAttachments(kind, 2000)`**，执行的是真实 `picker-timeout` 分支与真实 `cancelAttachmentPick`，未修改任何产品代码或资源。
- 计时器布防记录只命中一次（`from:600000 → to:2000`），证明只影响这一条路径。

### 实测序列（同一进程 PID 2043，未重启、未清数据）

| # | 动作 | 观测 |
|---|---|---|
| 1 | 布防 + 点附件 → 真实 SAF `PickActivity` 前台 | 2 s 后计时器到期，`trace.events = []`（无原生回调，符合预期），picker 仍在前台 |
| 2 | 系统 Back 关闭 picker | App 回前台，**无附件进入草稿**，无 alert |
| 3 | **同进程**重新进入会话再点附件 | 新 `PickActivity` 正常打开（未复用上一 requestCode 而失败） |
| 4 | 选中本轮专用文件 | `status: success`，`attach-1794644796546-3`，`QA5A7A_ROUND5.txt`，`text/plain`，178 B |
| 5 | 再次布防 → 打开 picker → 等超时 → **超时后才在 picker 里选文件** | `trace.events` 仍为空，草稿无附件 —— **迟到结果被丢弃** |
| 6 | 第三次点附件（未缩短超时） | 正常打开并选中，`attach-1794644927953-5`，178 B |

### 端到端一致

- 夹具收到唯一一次发送：`message="QA5A7A 第五轮附件提交复测"`，`files[0] = { name: QA5A7A_ROUND5.txt, mimeType: text/plain, bytes: 178, sha256: 7a8e112c1d74ea53b9bd5517c859e80ece1e32eca56d8a9e9e72f020f928eb23 }`
- 与推送到设备的原文件 SHA-256 **完全一致**（`localSha = deviceSha = 7a8e112c...`，178 B）
- `clientRequestId = app-1794644978967-taaew4dm`，`sent` 数组长度 1 —— **无重复发送**
- requestId 后缀 3 → 5 不同，证明未复用 requestCode

### 判定

**限制① 通过。** 具体覆盖：超时取消 → 同进程重开 → 成功选中；超时后迟到结果丢弃；同进程第三次仍可用；附件字节与端到端一致且只发送一次。

证据：`short-*.json`、`picker-*.xml`（5 份原生层级）、`QA5A7A_01..04.png`（均 1080×1920）。

---

## 三、限制②：PI 真实两轮 —— 受阻（根因未定）

### 3.1 先说一条被推翻的取证（重要）

我最初的宿主探针 `qa5a7a-hostprobe.mjs` **协议用错了**：它往 `\\.\pipe\pidesktop-codex-ipc` 写换行分隔 JSON，而桥接接收端（已安装 `main.js` L2094-2140）用的是 **4 字节 UInt32LE 长度前缀 + JSON 帧**，且要求 `type:"request"`。换行帧会让 `readUInt32LE(0)` 把 JSON 首 4 字节当成长度，接收端永远等不满。

因此 `host-control-probe.json` 里的 `timeout` **是探针自身缺陷，不能证明宿主无响应**，也不能由同期的 sidecar OOM 推根因。该探针已按无效测试归档并排除：

- `INVALID-hostprobe-exclusion.json`（`verdict: INVALID_TEST_EXCLUDED`，含 `mustNotBeCitedAs` 三项禁令）

### 3.2 用正确协议重做，得到真正的定位

| 探针 | 帧格式 | 结果 |
|---|---|---|
| v2：`plugin.list` / `desktop.health` | 正确（UInt32LE + `type:"request"`） | **收到响应**，`resultType=error`，`unsupported method: plugin.list` |
| 真实链路：`turnloom/host/invoke` → `plugin/list` | 正确 | `elapsedMs=8`，`resultType=error`，**`Plugin host process is no longer active`** |
| 同上 → `skill/list` | 正确 | `elapsedMs=1`，**同一错误** |

**这两条一起才有意义**：桥接的 pipe server 活着、已绑定、能在个位数毫秒内应答（v2 证明）；但它调 `pi.desktop.invoke` 时立即失败（真实链路证明）。所以故障点在**插件宿主绑定**这一层，不在管道帧格式，不在桥接自身 server。

我用的是桥接只读白名单内的两个操作（`main.js` L586-596），**没有触碰任何真实会话、任务或审批**。

### 3.3 与上游报告一致的旁证

- `plugin.log` L1854-1865：`plugin.reload.success` 后紧跟 `[turnloom-bridge] pipe server error: listen EADDRINUSE: address already in use`
- `registry.json`：`cn.star.turnloom-bridge` `enabled:true`、`status:ready`、`permissions:[desktop.control]`
- 管道 `\\.\pipe\pidesktop-codex-ipc` 存在于 OS 命名空间
- 上游两次真实 `POST /api/send` 亦返回同一错误（07:58:34Z / 08:02:05Z），本轮未复现真实发送

### 3.4 边界与未做的事

- 根因**未定**。上游用隔离临时管道复现 `startPipeServer`/`onUnload`，监听器 close 后可成功重绑（`rebind=true`），**不支持**把 `EADDRINUSE` 简单归因于 `onUnload` 未 destroy socket。
- 我**没有**杀 PI 主程序、没有改 provider、没有改源码、没有重启用户服务。
- 结论：**限制② 仍受阻，如实记录，不计通过**。这是宿主/插件运行时状态问题，不是新后端代码缺陷。

证据：`host-control-probe-v2.json`、`host-control-via-bridge.json`、`INVALID-hostprobe-exclusion.json`。

---

## 四、新修复专项独立验证（Node 侧，13/13）

在独立 worktree 内执行，未沿用开发方通过数：

```
node --test test/pi-thinking-catalog.test.js test/pi-sidecar-migration.test.js test/new-thread-settings.test.js
→ tests 13 / pass 13 / fail 0 / cancelled 0
```

覆盖到的关键断言（原文摘录）：

- `formal app-server fallback sends explicit effort and exits only after the matching turn completes`
- `new-conversation timeout, missing acknowledgement and policy errors never replay`
- `no-reasoning first turn omits effort; unexpected worker exit reports one background failure`
- `sidecar migration refuses unknown inputs and changes only a verified baseline`
- `PI reasoning preserves exact declared levels, off and per-model default`
- `PI request rejects unsupported effort and keeps off instead of silently switching levels`
- `backend keeps models without effort controls and does not substitute another model default`

这对应本轮"首轮传 model/effort/cwd、未知 ack 不重放、每模型 thinkingLevels、旧 sidecar 覆盖迁移"四项修复。

---

## 五、历史分页 80 → 160 → 205（独立通过）

自建只读分页夹具（205 条合成消息，80/页，`before` 为排他游标），在 Node 侧按生产 `messagePaging.ts` 的 `messagePageKey` / `mergeMessagePages` 规则复算：

| 断言 | 结果 |
|---|---|
| 第 1 页 80 条 | ✅ |
| 第 2 页累计 160 条 | ✅ |
| 第 3 页累计 205 条 | ✅ |
| 无重复（205 unique / 0 duplicates） | ✅ |
| 时序保持（升序） | ✅ |
| 集合与期望 205 条精确一致 | ✅ |
| **翻页不改 runtime 状态**（`state=ended`、`thinking=false` 保持） | ✅ |
| 游标不重复 | ✅ |
| `hasOlderMessages=false` 时停止 | ✅ |

**9/9 断言通过**（`paging-verification.json`，`allPassed: true`）。

口径说明：本轮是**契约与游标行为**的独立复算，不是设备侧滚动截图；设备侧分页 UI 已由前几轮覆盖，本轮不再重复配对破坏既有合成证据。

---

## 六、本轮未做 / 未验证（如实列出）

| 项 | 状态 | 原因 |
|---|---|---|
| PI 真实两轮对话 | **受阻** | §三，宿主控制路径不可用 |
| 设备侧历史分页滚动 | 未做 | 需重配对，会破坏本轮已完成的合成配对证据；已用契约级独立复算替代 |
| 完整 Gradle JVM 套件 | 未做 | 离线缺 JUnit / org.json 依赖；不冒称全套通过 |
| 旧包 `398f924a` 的 17 项 | 按指示未重跑 | 上游明确不重跑充数 |
| 设备侧长超时（190 s SAF 慢选） | 未复现 | 上游已实测 190001 ms；本轮只测短超时分支 |
| 真实供应商 / 真实用户任务 / 真实审批 | **全程未触碰** | 只用合成夹具 |

---

## 七、环境恢复

| 项 | 状态 |
|---|---|
| ephemeral 用户 10 `CodexTurnloomQA5A7A` | 已 `pm remove-user 10`（`Success: removed user`），当前用户切回 **0**，仅剩 `UserInfo{0:机主:4c13}` |
| QA 专用文件（1 个推送文件 + 4 张截图 + 5 份 XML） | 全部删除并 `ls` 复核不存在 |
| adb forward `tcp:14070` | 已移除，`adb forward --list` 为空 |
| 夹具进程 23392 / 21692 | 已停止，7831 / 7841 无监听 |
| MuMu index 1 租约 | `release` → `released:true`，实例已停 |
| 实例 6（adb 16576，无 owner） | **未获取、未触碰** |
| PI 主程序 / 供应商配置 / 源码 | **未改、未杀** |

---

## 八、证据清单

目录：`./\`

**身份与门禁**
- `identity.json`（commit / APK bytes / SHA / headDiffExit=0）
- `verify-ci.json` + `verify-ci.log`（389/389）
- `focused.json` + `focused.log`（49/49）

**限制①（短超时重选）**
- `short-arm.json`、`short-state.json`、`short-trace.json`、`short-attachment-summary.json`、`short-clear-tray.json`、`short-compose.json`
- `picker-2.xml`、`picker-2-docs.xml`、`picker-2-docs2.xml`、`picker-3-late.xml`、`picker-4-third.xml`
- `fixture-sent-brief.json`（发送内容 + 文件 SHA）
- `QA5A7A_01_short_reopen.png`、`QA5A7A_02_third_pick.png`、`QA5A7A_03_sent.png`、`QA5A7A_04_final.png`（均 1080×1920）

**限制②（PI 宿主桥）**
- `host-control-probe.json`（**已作废**，协议错误）
- `host-control-probe-v2.json`（正确帧格式，pipe server 有应答）
- `host-control-via-bridge.json`（真实链路 → `Plugin host process is no longer active`）
- `INVALID-hostprobe-exclusion.json`（排除记录 + 根因边界）

**分页**
- `paging-verification.json`、`paging-fixture-server.json`

**环境**
- `device-restoration.json`、`qa-user-cleanup.json`、`cdp-connection.json`

---

## 九、对上游的明确回复

1. **限制①已独立补齐并通过**：超时取消、同进程重开、迟到结果丢弃、第三次可用、字节一致、只发一次。开发侧"未稳定完成"的顾虑在新包上不再成立。
2. **限制②如实受阻**：不是"没测"，而是用正确协议实证到 `pi.desktop.invoke` 这一层才失败；pipe server 本身正常。根因未定，需要宿主侧恢复插件宿主绑定后才能测真实两轮。
3. **纠正已接受**：原 `host-control-probe.json` 的 timeout 是我探针协议错误，已在报告与证据中显式降级/排除，不写成功能故障证据，也不由 OOM 推根因。
4. 未发布任何候选、未动 v2.1.1、未改源码、未杀宿主、退役 IP 零访问。
