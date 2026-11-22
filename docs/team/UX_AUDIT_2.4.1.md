# 2.4.1 设计门禁（NB3）

> 判据先立、实现后签。每条只有「证据」栏填满才算过；没证据的写「未验」，不写「应该可以」。
> 条目范围见 Task #20；本文件只记录**怎么算过**，不重复范围说明。
> 签发基线：`1c5e125`（2.4.1 / versionCode 100）；`npm test` 674 / 672 pass / 0 fail / 2 skipped，`app:typecheck` 退出 0。

| # | 条目 | 判据（缺一条不签） | 证据 | 状态 |
|---|---|---|---|---|
| 1 | 诊断里删掉手动「上传日志」 | 删的是入口不是链路：自动上传覆盖**所有**真实发送路径（`sendMessage` / `createThread` / `sendQueuedMessage`）；诊断 sheet 只剩运行信息 / 清缓存 / 重新同步；不留死代码与失效断言 | `bb8157a`；`app-ia.test.cjs:111-117`；**Vera 在最终 APK 字节上实测 `check-auto-upload` 9/0**（排队发送 200 → `logs/phone/736-WIN-20261122.jsonl` 新增 1 行 → sheet 写「最近上传 …」；canary 全文不出现）。**口径**：`uploadDiagnostics()` 无待传记录时直接 return 0、不发请求，所以只能说「发送成功后把**待上传的记录**送出」，不能说「每次发送都会上传」 | **已签** |
| 2 | `logs/phone` 按天总量上限 | 上限写死可读回；超限先删最旧的天、永不删最新那份、删了记一行日志；合成文件跑一遍 | `303da02` + `1c5e125`；`request-log.cjs:338-389`（16 MiB / 50 文件、最旧整份删、`phone log retention: …` 一行、`prune:false` 可关）；`phone-log-retention` **7/7** | **已签** |
| 3 | `Trash2 → LogOut` | 图标换掉只是表面；**确认文案必须说清「只解除配对，不删电脑上的会话」** | `bb8157a`；`SettingsScreen.tsx:393-395` 用 `LogOut`；`CupertinoSheetHost.tsx:28`「移除配对及这台电脑的本机会话缓存。电脑上的会话不会被删除。」 | **已签** |
| 4 | 等审批时的输入区提示 | `waiting`（`status.interactionRequired`，与头部「待你处理」同源）**优先于** `running`；只在有输入时出现；`notice` 最高优先；12 字 | `bb8157a`；`queueLogic.ts:288-301`；`app-queue-contract:236-248` 五条断言 + `:250-251` 屏幕接线；**29/29** | **已签**（320 折行随第 7 条） |
| 5 | `ThreadMessage` 收窄 | 声明真实字段后再删 index signature；`as` 只在边界；反向用例（字段名写错）**必须编译失败**；日期分隔用例仍绿 | `2eebbea`；`turnloomApi.ts:125-154` 24 字段、ThreadMessage 无 index signature；`normalizeThreadMessages` 在 `:475` / `:490-491` 边界调用；`message-type-guard` **1/1**；`app:typecheck` 0 | **已签** |
| 6 | 漂移哨兵搬 CI | 定时 + `release: published`；**能证明它会失败**；除 `GITHUB_TOKEN` 外不需要别的密钥 | `277232a`（workflow）+ `963038e`（`$LASTEXITCODE` → `$?`，首次手动 dispatch 绿）。**失败路径由我用真实旧清单验证**：`TURNLOOM_CHANNEL_URL=…/turnloom/history/2.4.0.json` → 输出 `version:v2.4.1:2.4.0` 与 `digest:v2.4.1:2.4.0` 两条事件；正常清单 → 无输出、exit 0 | **已签** |
| 7 | 三页无回归（发版前） | 会话 / 对话 / 设备 390 与 320 各一遍：无横向溢出、44px 命中区、无 JS 异常；`check-redesign --require` 的 `RESULT: PASS` | **390 内容**：Rhea 在发布字节 `54de7699` 上 **25 PASS / 0 FAIL**（53 行会话、27 行对话含 2 个日期分隔、设备 2 卡、设置五组 + 诊断 sheet，logcat 无 JS 异常）。**320 几何**：我在发布树上跑 `check-redesign --build --require` → **115 PASS / 0 FAIL / 0 SKIP，RESULT: PASS**（其中 33 条含 320 档）。**残项**：320 的三页*内容*未单独在设备上走查，本版不据此声称已验，2.4.2 常规回归补 | **已签（附残项）** |

## 已定口径（避免实现时二次讨论）

- **等待审批的那句文案**：`先处理审批，或排队下一条`。理由：只陈述「先做什么」和「发送的后果」，不承诺「发出去就会执行」。
- **`waiting` 的来源**：`status.interactionRequired`，与头部副标题「待你处理」同一个字段；三者（运行条计数、头部副标题、输入区提示）必须同源，任一走 `state==='running'` 就会再出现「说是待处理、界面没提示」。
- **范围外**：`ThreadSummary` 的 index signature 与当前电脑卡的平台标记都不在 2.4.1，进 2.5.0 或按 Human 要求单开。
