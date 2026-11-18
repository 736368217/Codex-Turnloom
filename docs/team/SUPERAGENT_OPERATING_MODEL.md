# Super-agent 运行模型（本项目的团队实现）

> 目标来自 DeepSeek 官方《Super-agent 设计探索：迈向更自主的 Agent 系统》。本文不是复述文章，而是把其中五个模块映射到 Codex-Turnloom 这次改造的实际运行方式，供后续接手的人复用。

## 1. 双层：Router + Workers

| 层 | 本项目的实现 | 职责 | 不做什么 |
|---|---|---|---|
| **Router** | @NB agent（项目 owner） | 接人类指令、拆 Task、定优先级、跨任务协调、最终验收与发布 | 不亲自写每个模块的实现；不在一线跟每个工具调用 |
| **Workers** | @Atlas / @Iris / @Vera / @Kai / @Rhea | 在各自上下文里独立完成一个 Task，带完整工具与文件边界 | 不直接对 Human 汇报；不跨边界改别人的文件；完成后把证据交回 Thread |
| **机械 Worker** | @Otto / @Lin（HY4） | 只执行精确清单：跑命令、记录、按模板整理 | 不做设计判断、不决定验收、不自由发挥 |

这与文章的判断一致：Router 不需要背每个任务的细节；Worker 用最强模型保证交付质量。HY4 只承担“Fast Path 式”的确定性执行，避免低能力模型做判断。

## 2. 事件驱动：Trigger、订阅与直通

- **Trigger**：Human 在 Main stream 的一句话、一个 Task 的创建/转移、Thread 里的 @、一次 review 结果。
- **过滤**：程序层（Task 边界、文件所有权、命令清单）先挡掉越界与重复；语义层（Router 读 Thread / 证据）判断是否需要行动。
- **订阅/直通**：Task 创建后，accountable Worker 自动被唤醒并 follow Thread；后续进展直接进该 Thread，不必经 Router 转发。跨 Task 的冲突在 Thread 里 @ 对方，或由 Router 转交。
- **不打扰**：常规进展不 @ Human；只有不可逆、需凭据、范围/优先级冲突才升级给 Human。

## 3. 上下文：Inline & Spill + 链式召回

- **Inline**：每个 Task 的正文包含目标、背景、边界、验收口径；仓库里有 `docs/team/PROJECT_BRIEF.md`、`docs/option-a/UI_SPEC.md`、`docs/PROTOCOL.zh-CN.md` 作为共享事实。
- **Spill**：长日志、截图、完整 diff 留在 `docs/qa/` 或本地 `D:\Turn-DSH\tools\`，Thread 只放结论、路径、关键行号；需要时再读。
- **链式召回**：Thread → Task ref → 文件/提交 → 证据路径；每个成员有自己的 `memory.md` + `notes/`，跨会话保持角色与项目知识。
- **原则**：不把整篇日志塞进上下文；不把“我猜的”写成“已验证”。

## 4. 面向人的交互：Human 只面对 Router

- Human 只和 @NB agent 对话；Worker 的中间推理、工具日志不直接涌向 Human。
- Router 对 Human 的输出固定为：**结论 → 关键证据 → 下一步 / 需要 Human 做的事**。
- 异步：Worker 并行跑，Router 不被单个命令阻塞；Human 可以随时插话，Router 在下一轮合并处理。
- 多信道：Thread/Main stream 用低打扰短消息；交付文档用结构化长文；APK/截图用附件或路径。

## 5. 计算、状态与环境分离 + Watchdog

- **计算**：每个 Member 是独立会话/进程，可重启、可替换；不把“某个会话还活着”当成任务状态。
- **状态**：Task/Thread 账本、Git 提交、`docs/qa` 证据、成员 memory；机器重启后从这些恢复，而不是靠对话记忆。
- **环境**：真实 Codex/PI-Desktop 留在本机；手机只是控制面。Codex 数据只读，PI 是可丢弃测试环境。
- **Watchdog**：@Atlas 作为独立 reviewer 复核 Worker 的 diff 与门禁；Router 做最终验收；Human 做产品验收。Agent 不能验收自己做的 Task（DSH 的 acceptance 规则）。
- **本轮 Watchdog 实例**：Atlas 发现并纠正了“模型目录导致发送失败”的因果误判；Rhea 的 build 脚本改动由 Atlas 复核；Vera 把 TabBar 高度问题精确交给 Iris。

## 6. 本轮的 Task 映射

| Task | Worker | 文章对应 |
|---|---|---|
| PI-Desktop 桥接 | @Kai | Worker + 环境解耦（本机 daemon/桥） |
| 视觉系统 | @Iris | 面向人的交互（信道带宽/视觉） |
| 易用性 + E2E | @Vera | 面向人的交互 + 全双工/无死路 |
| 后端门禁 | @Atlas | Watchdog + 状态可信 |
| Android 构建/验收 | @Rhea | 环境接入 + 持久交付 |
| 机械基线 | @Otto | Fast Path 执行 |
| 文档/素材 | @Lin | Spill / 可读交付 |

## 7. 本轮的边界与教训

- 没有上云、没有多 Human、没有常驻 Router 进程；这是单机 DSH 团队，不是文章里的云端 Super-agent 产品。
- 并行 Worker 共享一个工作树时，必须用文件所有权 + 及时提交隔离；本轮出现过 Rhea 改 build 脚本导致 Otto 基线 `npm test` 变红，靠 Atlas 复跑才定位为“并发改动”而非基线缺陷。
- 长任务（APK 构建、模拟器）必须走后台并留日志；不要让 Router 阻塞等待。
- 任何写入 Thread 的内容都会长期留存；访问码、密钥、真实私人对话不能进账本。
