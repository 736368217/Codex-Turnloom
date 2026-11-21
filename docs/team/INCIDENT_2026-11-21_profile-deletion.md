# 事故复盘：2026-11-21 00:14 用户目录被递归删除

> 作者：@NB3 · 2026-11-21 14:45 · 只读复盘，未执行任何恢复
> 证据：`dsh-cleanup-stderr.log`（SHA-256 `492C03D0D25D027DD74038DC28EBB3AAE9BF4D4245330ECF4A4A791CE20418E6`，1,132 行 `Remove-Item`）
> 关联：Human 的《本机模型配置误删事故报告》（2026-11-21）与《误删恢复与清理结果》（2026-11-21 14:10）

## 结论（一句话）

一个 PowerShell 清理脚本给只读自动变量 **`$HOME` 赋值**；赋值失败但脚本继续执行，随后
`Remove-Item -Recurse -Force` 用的仍是真实的 `$HOME`（用户目录），把整个 profile 下的
`.dsh` / `.zcode` / `.codex` / `.ssh` / `.android` / `.cache` / `.local` / `AppData` 递归删了一遍。

## 证据链

1. **stderr 第一行就是赋值失败**：

   ```text
   WriteError: 无法覆盖变量 HOME ，因为它是只读变量或常量。
   ```

   PowerShell 的 `$HOME` 是只读自动变量。脚本里的 `$HOME = <某个夹具目录>` 只会产生
   一个**非终止错误**；除非 `$ErrorActionPreference = 'Stop'`，后面的语句照常执行，而且
   `$HOME` 仍然是 `C:\Users\<当前用户>`。

2. **紧接着的删除目标就是整个 profile**。日志里的错误按顶层目录统计：

   | 顶层目录 | 错误行数（约） |
   |---|---:|
   | `%USERPROFILE%\AppData` | 1,057 |
   | `%USERPROFILE%\.zcode` | 22 |
   | `%USERPROFILE%\.android`（含 `paopao_api33.avd`） | 15 |
   | `%USERPROFILE%\.dsh` | 14 |
   | `%USERPROFILE%\.codex` | 11 |
   | `%USERPROFILE%\.local` | 7 |
   | `%USERPROFILE%\.cache` | 3 |
   | `%USERPROFILE%\.ssh` | 2 |
   | `%USERPROFILE%\.zcode-model-puller` | 1 |

   这些行全部是「文件被占用 / 目录不是空的 / 访问被拒绝」——也就是 `Remove-Item -Recurse`
   在删这些目录时留下的**失败项**；删除成功的文件不会出现在 stderr 里。这与 Human 报告
   中「模型配置、Codex、ZCode、SSH、AppData 同时丢失」的范围一致。

3. **触发时间与现场吻合**：stderr 最后写入 00:15:46；同一时段 Android AVD 正在跑
   （`paopao_api33.avd` 的 `hardware-qemu.ini.lock`、`userdata-qemu.img` 被占用），
   说明清理进程与模拟器测试并行。这就是为什么 AVD 的锁文件先报错。

## 根因链（不是「DSH 抽风」，是四层都失守）

1. **变量名撞了只读自动变量**：想用 `$HOME` 当夹具根目录，PowerShell 不允许；
   赋值报错被忽略。
2. **没有 `$ErrorActionPreference = 'Stop'`**：赋值失败没有中止脚本，删除继续。
3. **删除目标没有校验**：没有检查「解析后的绝对路径是否在本次创建的临时目录内」，
   没有拒绝空值 / 用户目录 / 卷根 / 工作根本身，直接 `-Recurse -Force`。
4. **执行环境没有兜底**：该会话是 `danger-full-access` + 审批策略 `never`，
   递归删除用户目录不需要任何人点确认。

## 我们查不到的部分

- **具体是哪条命令、哪个任务触发的**：事故时 `~/.dsh/sessions` 与当晚的会话记录一起被删，
  当前缓存里没有 23:50–00:15 的原始 transcript；Windows 进程记录也没有保留完整命令行。
  这与 Human 报告里的「无法确认具体脚本、参数或触发它的任务」一致。
- 因此复盘的落点不是「找出谁」，而是**让同类命令在下一步就失败**。

## 立即生效的规则（已写进仓库 `AGENTS.md`）

1. PowerShell 里**永远不要给 `$HOME` 赋值**；用 `$FixtureHome`，脚本开头
   `$ErrorActionPreference = 'Stop'` + `Set-StrictMode -Version Latest`。
2. 递归删除只允许指向**本次创建**的根：`%TEMP%\turnloom-qa-<run-id>` 或
   `.scratch\<run-id>`；删除前 `Resolve-Path` 校验（存在、是目录、不是 reparse point、
   不是 `$HOME` / `$env:USERPROFILE` / 卷根 / 工作根本身），失败就退出，绝不回退到当前目录。
3. 测试要「干净 home」时用合成 `--codex-home`，**不清理真实** `~/.codex`、`~/.dsh`、
   `~/.zcode`、真实 AVD。
4. 工作区外的破坏性命令必须有人工审批；`danger-full-access` 是按任务申请，不是默认。
5. 破坏性命令**逐条审核，不是一刀切禁用**（Human 2026-11-21 17:00 明确）：执行前打印
   解析后的绝对目标、对象数量与可恢复性，先跑 `-WhatIf` / `git clean -ndx`；本次运行
   没创建的目标，必须在 Thread 里拿到**点名目标与数量**的批准；优先移到
   `.scratch\<run-id>\quarantine\` 而不是直接删除。命令、目标、数量、结果写进任务报告。

## 给 DSH 宿主的建议（需要 Human 决定）

- 把「递归删除 / 格式化 / 重置」列为需要确认的命令类，尤其目标在工作区外时；
- 团队 Agent 默认 `workspace-write`，只有明确需要时才升到 `danger-full-access`；
- 对 `Remove-Item -Recurse`、`rd /s`、`git clean -fdx` 记录「解析后的目标路径」到审计日志，
  便于下次在删除前就能看到「目标 = 用户目录」并拦截。

## 验收方式（下次改清理脚本时照做）

- 空路径、`..`、同名前缀的兄弟目录、指向工作区外的目录联接，四种输入都必须被拒绝，
  且工作区外的哨兵文件保持不变；
- 成功用例只删除本次创建的目录；
- 用 `-WhatIf` 先跑一遍，确认输出里没有 `%USERPROFILE%`、盘根、仓库根。
