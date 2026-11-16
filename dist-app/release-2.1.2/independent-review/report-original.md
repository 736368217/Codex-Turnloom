# 主分支第六轮独立复测报告 — HEAD `48f081df`

- 产品 HEAD / `origin/main` = `48f081df3d9a0479f6fcd991a526ffacc4b49c1f`（桥修复 `332e163b` 保持；新增发送前 409 缓存修复与 `test/send-preflight-retry.test.js`）
- 发布 APK：`dist-app/release-2.1.2/Codex-Turnloom-2.1.2-app.apk`，2.1.2 / versionCode 83，**1,780,565 B**，SHA-256 `4129d2e04be72207bae6fc5a2fdcede221f8d2e95b9acda33f9c38863b3fc234`
- 设备实读 `base.apk` 与发布包 **逐字节同 SHA**（未重建、未改 app/native）
- 独立 worktree：`retest-332e`（detached `48f081df`，复用主仓 `node_modules` junction）
- 设备：MuMu phone index 1（1080×1920 / 440dpi），ephemeral 用户 10，机主用户 0 未触碰
- 真实后端：本机 8799（PI-Desktop 真实宿主，`pidesk` harness）
- 退役公网 `121.40.69.97`：本轮访问 **0 次**

> 本轮相对上轮的两个限制：**① 桥可用性**（上轮 BLOCKED）→ 本轮 **PASS**；**② 实际 PI 连续两轮**（上轮 BLOCKED）→ 本轮 **PASS**。

---

## 一、结论速览

| 项 | 结果 | 依据 |
|---|---|---|
| 身份绑定（HEAD / origin / 发布 APK / 设备实读 SHA） | **通过** | `identity-48f.json` |
| 桥副本一致性（源码 / 仓外 / installed） | **通过** | 源码 `0ead670a…`；运行副本 `acb00a3c…`（保留本机差异） |
| **限制① 正确帧只读 `host/invoke` 成功** | **通过** | `host-control-readonly-48f.json` |
| **限制① 热重载后自有连接恢复** | **通过** | `bridge-reload-verification.json` |
| 桥生命周期专项测试 | **通过** 2/2 | `pi-bridge-lifecycle.test.js` |
| 409 发送前闸门专项测试 | **通过** 2/2 | `send-preflight-retry.test.js` |
| **限制② 真实 PI 连续两轮** | **通过** | `host-turn1.json`、`host-turn2.json`、`rollout-turns.json` |
| 独立 CI（Node 24 / 22） | **通过** 393 / 393 | `verify-ci-48f.json` |
| 环境恢复 / QA 软删除 | **完成** | `device-restoration-48f.json` |

**一句话**：桥可用性与真实 PI 两轮这两个上轮阻塞项，本轮在独立身份下均已实证通过；唯一需要单独归因的是供应商侧行为，已与桥故障明确分开。

---

## 二、限制①：桥可用性 —— 通过

### 2.1 只读链路（正确帧协议）

用桥接真实协议（4 字节 UInt32LE 长度前缀 + `type:"request"`）走应用实际使用的链路 `turnloom/host/invoke`，只用**只读白名单**操作，未触碰任何真实会话/任务/审批：

| 操作 | 结果 |
|---|---|
| `plugin/list` | `resultType=success`，13 ms |
| `skill/list` | `resultType=success`，38 ms |

与上一轮同路径、同协议下的 `Plugin host process is no longer active`（8 ms / 1 ms）形成直接对照：**上轮的阻塞已消失**。

### 2.2 热重载恢复（自有连接，非并发真实发送）

在**没有并发真实发送**的前提下，仅 touch 已安装插件文件触发 dev 重载，日志序列为：

```
[turnloom-bridge] unloaded
[turnloom-bridge] loading: merged mirror ... + IPC facade + turnloom supervisor
[turnloom-bridge] codex IPC facade listening on \\.\pipe\pidesktop-codex-ipc
plugin.load.success  ok:true
plugin.reload.success ok:true
```

**没有出现 `EADDRINUSE`**（上轮是 reload.success 紧跟 EADDRINUSE）。重载后我用自己的连接立刻复验：

| 时点 | `plugin/list` | `skill/list` |
|---|---|---|
| 重载前 | success，13 ms | success，38 ms |
| 重载后 | success，**6 ms** | success，17 ms |

说明修复的三条语义在真机环境成立：`startPipeServer` 真正 listen 后才算加载成功；卸载时 destroy 自有 socket 并 await close；重载后新实例可正常接收 host 调用。

### 2.3 专项测试（独立执行）

```
node --test test/pi-bridge-lifecycle.test.js
✔ bridge unload closes persistent clients before a new instance accepts host calls
✔ bridge bind conflict rejects startup instead of reporting a loaded but unusable instance
→ 2 tests / 2 pass / 0 fail / 0 cancelled
```

---

## 三、限制②：真实 PI 连续两轮 —— 通过

### 3.1 选型（按要求显式指定）

在手机端「新建任务」的模型面板中显式筛选并选择：

- 供应商 chip：**wb反代**（`aria-pressed=true`）
- 模型：**`wb反代/deepseek-v4.1-flash`**
- 强度：**最高（max）**（`aria-pressed=true`）

选择后主按钮 aria 为 `模型与思考强度：deepseek-v4.1-flash · 最高`，确认 UI 与请求一致。

### 3.2 两轮实测

| 轮次 | 手机端显示 | 宿主落库 |
|---|---|---|
| 第 1 轮 | 真实 assistant `QA332E_TURN_ONE` | turn `1e543ac9-1a04-4f11-9d76-c36c8effc210`，`task_complete` 2205 ms |
| 第 2 轮 | 真实 assistant `QA332E_TURN_TWO` | turn `27b474cf-1935-46af-859d-13183b0de23d`，`task_complete` 3008 ms |

**新会话**：`c76aa111-59a6-47e7-ae78-91796054331d`，`source=pidesktop`，`model=deepseek-v4.1-flash`，`statusState=idle`。

### 3.3 三重证据交叉（不只看 HTTP 200）

1. **手机端 UI**：两轮 assistant 文本真实渲染（截图 `QA332E_10_turn1.png`、`QA332E_11_turn2.png`，均 1080×1920）。
2. **宿主消息接口**：`totalMessages=4`，user/assistant 各两条，两条 assistant 分属两个不同 `turnId`，`thinking=false`。
3. **rollout 落盘**：`sessions/rollout-2026-11-14T17-38-18-380Z-c76aa111-....jsonl`（1628 B，SHA-256 `3ce955cce60778b1…`）含两对 `task_started` / `task_complete`，以及 `agent_message` 原文 `QA332E_TURN_ONE` / `QA332E_TURN_TWO`。

### 3.4 与供应商失败分开归因

主会话记录的 `77625 free/deepseek-flash` 会话 `3ab49404…` 的 `PROVIDER_ERROR` 属**单一供应商失败**，与本轮桥可用性无关：

- 本轮桥链路全程 success（§二）；
- 本轮两轮使用 `wb反代/deepseek-v4.1-flash`，两次都真实完成；
- 因此「桥故障」与「某供应商失败」是两个独立事实，不互相推断。

---

## 四、本轮新增修复的独立验证

### 4.1 发送前 409 缓存修复

源码（`server.js`）语义已读实：

- `runIdempotentSend` 的 `catch` 只在 `error.sendNotStarted === true` 且 store 中仍是同一个 promise 时删除缓存；
- 定时器改为 `if (store.get(key)?.promise === promise) store.delete(key)`，只删自己的操作；
- `sendToCodex` 仅在两处**发送前 running 闸门**标记 `sendNotStarted = true`。

独立测试：

```
node --test test/send-preflight-retry.test.js
✔ a confirmed running gate allows the same draft ID after idle, then deduplicates success
✔ unknown execution failures remain deduplicated and cannot be replayed
→ 2 tests / 2 pass / 0 fail / 0 cancelled
```

即「明确未发送的拒绝可重试、可能已执行的失败仍去重」两条边界都被钉住。

### 4.2 全量 CI（独立 worktree，未沿用开发方通过数）

```
[verify-ci] node 22 --test (CI runtime): 393 pass, 0 fail, 0 cancelled
# tests 393 / # pass 393 / # fail 0 / # cancelled 0
[verify-ci] PASS: this commit would satisfy the GitHub Actions server job
```

日志 136,165 B，SHA-256 `1e59226e177e6222…`。

---

## 五、本轮遇到并如实记录的环境异常

| 现象 | 判定 |
|---|---|
| 新建 ephemeral 用户首次冷启动报 `WEBVIEW_INIT_FAILED`（"系统 WebView 初始化失败，请重试。配对信息已保留。"） | **产品原生错误恢复界面按设计工作**：点「重试」后正常进入配对页，无需清数据。保留现场 `webview-init-failed-first.xml` |
| 生产默认无 devtools（无 `--ez turnloom.qaDebug true` 时 `/proc/net/unix` 无 `webview_devtools_remote`） | **预期行为**，不是缺陷；按主会话给的 QA debug 入口重启后取得 CDP |
| `uiautomator dump` 偶发 `could not get idle state` 且不产出 XML | 工具侧现象，无 XML 不计产品失败；改用 CDP/截图取证 |
| 模型面板首次点击坐标落在面板内部，把模型切到 Kimi | 我的操作失误，已重新选回 `deepseek-v4.1-flash · max` 并在发送前二次核对 |

---

## 六、未做 / 未验证（如实列出）

| 项 | 状态 | 原因 |
|---|---|---|
| 旧包 17 项手机行为 | 按指示未重跑 | 上游明确此前独立 picker 恢复仍有效 |
| 设备侧 190 s SAF 慢选 | 未复现 | 上轮已覆盖，本轮不扩大范围 |
| 完整 Gradle JVM 套件 | 未做 | 离线缺 JUnit / org.json；不冒称全套通过 |
| 主会话 8799 部署新 server 代码后的手机复测 | 未做 | 8799 仍为旧内存 server；新代码已用 worktree 全量 CI + 专项覆盖，未把旧缓存问题判为新源码失败 |
| 真实用户任务 / 审批 | **全程未触碰** | 只操作自有 QA 会话 |
| 发布动作 | **未做** | 按约定由主会话发布，本轮只验包 |

---

## 七、环境恢复

| 项 | 状态 |
|---|---|
| ephemeral 用户 10 `CodexTurnloomQA332E` | 已 `pm remove-user 10`（`Success: removed user`），当前用户 **0**，仅剩 `UserInfo{0:机主:4c13}` |
| 自有 QA 会话 `c76aa111…` | 完整行备份（`qa-session-backup-c76aa111.json`，3137 B，含 6 条消息）后**软删除**，`deleted_at=1794678151645`，`changes=1` |
| 设备文件（7 份 XML + 3 张截图） | 全部删除并 `ls` 复核不存在 |
| adb forward `tcp:14070` | 已移除，`adb forward --list` 为空，14070 无监听 |
| MuMu index 1 租约 | `release` → `released:true`，实例已停 |
| 实例 6（adb 16576，无 owner） | 未获取、未触碰 |
| PI 主程序 / 供应商配置 / 源码 | 未杀、未改 |
| 退役公网 | 0 次访问 |

---

## 八、证据清单

目录：`D:\pi-data\data\scratch\085b0cda-a463-419e-bafc-bafd3bad412f\retest-332e-evidence\`

**身份与门禁**
- `identity-48f.json`、`verify-ci-48f.json`、`verify-ci-48f.log`

**限制①（桥）**
- `host-control-readonly-48f.json`（重载前只读 success）
- `host-control-after-reload.json`（重载后只读 success）
- `bridge-reload-verification.json`（reload 序列、无 EADDRINUSE、非并发）

**限制②（真实两轮）**
- `host-turn1.json`、`host-turn2.json`（宿主消息 + turnId）
- `rollout-turns.json`、`rollout-c76aa111.jsonl`（落盘 task_started/task_complete + assistant 原文）
- `QA332E_10_turn1.png`、`QA332E_11_turn2.png`（均 1080×1920）

**设备与清理**
- `webview-init-failed-first.xml`（首次启动恢复现场）
- `device-restoration-48f.json`
- `qa-session-backup-c76aa111.json`

---

## 九、对主会话的明确回复

1. **限制①已通过**：正确帧只读 `host/invoke` 两次 success；我自有连接在热重载后 6 ms 恢复 success；重载序列无 EADDRINUSE。
2. **限制②已通过**：手机端显式选 `wb反代/deepseek-v4.1-flash` + max，真实两轮 `QA332E_TURN_ONE` / `QA332E_TURN_TWO` 在 UI、宿主接口、rollout 落盘三处一致，两个不同 turnId 均 `task_complete`。
3. **供应商失败已分开**：`77625 free` 的 `PROVIDER_ERROR` 与桥可用性无因果关系，未据此判桥或产品失败。
4. **APK 可发布**：发布目录 APK 与设备实读 `base.apk` 同 SHA `4129d2e0…fc234`，未重建。
5. 环境已恢复，自有 QA 已备份并软删除；未发布、未动 v2.1.1、未杀 PI、未改 provider、退役 IP 零访问。
