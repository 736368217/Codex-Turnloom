# 2.4.1 设计门禁（NB3）

> 判据先立、实现后签。每条只有「证据」栏填满才算过；没证据的写「未验」，不写「应该可以」。
> 条目范围见 Task #20；本文件只记录**怎么算过**，不重复范围说明。

| # | 条目 | 判据（缺一条不签） | 证据 | 状态 |
|---|---|---|---|---|
| 1 | 诊断里删掉手动「上传日志」 | 删的是入口不是链路：`dataStore.ts:419` 的自动上传仍在、测试仍断言它被调用；诊断 sheet 只剩运行信息 / 清缓存 / 重新同步；`SettingsScreen`、`CupertinoSheetHost` 不留死代码与失效断言 | — | 待 |
| 2 | `logs/phone` 按天总量上限 | 上限写死在代码里可读回；超限先删最旧的天、**永不删当天**、删了记一行日志；合成文件跑一遍：未超限不删、超限后老文件消失、当天与昨天仍在 | — | 待 |
| 3 | `Trash2 → LogOut` | 图标换掉只是表面；**确认文案必须说清「只解除配对，不删电脑上的会话」**，否则用户仍以为删数据 | — | 待 |
| 4 | 等审批时的输入区提示 | `waiting`（= `status.interactionRequired`，与头部「待你处理」同源）**优先于** `running`；只在有输入时出现；`notice` 仍最高优先；文案 12 字、320 不折行；`role="status" aria-live="polite"` 不动；`app-queue-contract` 五条断言全绿 | — | 待 |
| 5 | `ThreadMessage` 收窄 | 先声明真实字段再删 `[key: string]: unknown`；`as` 只出现在边界归一化；反向用例（`test/fixtures/message-typo.ts` + 独立 `tsc --noEmit`）**退出非 0**；日期分隔 `app-chat-contract` 仍 16/16 | — | 待 |
| 6 | 漂移哨兵搬 CI | 同一个 `release-drift.ps1`，`workflow_dispatch` + 定时各一次；**能证明它会失败**（指向旧的 `latest.json` 必须红）；除 `GITHUB_TOKEN` 外不需要别的密钥 | — | 待 |
| 7 | 三页无回归（发版前） | 会话 / 对话 / 设备 390 与 320 各一遍：无横向溢出、44px 命中区、无 JS 异常；设计门禁 `check-redesign --require` 的 `RESULT: PASS`（页检查计数按 `^PASS ` 数，夹具自证 `PASS(应失败)` 单列） | — | 待 |

## 已定口径（避免实现时二次讨论）

- **等待审批的那句文案**：`先处理审批，或排队下一条`。理由：只陈述「先做什么」和「发送的后果」，不承诺「发出去就会执行」。
- **`waiting` 的来源**：`status.interactionRequired`，与头部副标题「待你处理」同一个字段；三者（运行条计数、头部副标题、输入区提示）必须同源，任一走 `state==='running'` 就会再出现「说是待处理、界面没提示」。
- **范围外**：`ThreadSummary` 的 index signature 与当前电脑卡的平台标记都不在 2.4.1，进 2.5.0 或按 Human 要求单开。
