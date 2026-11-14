# 剩余问题修复与手机候选验收（2026-11-14）

本轮修复首轮 model/effort 丢失、PI 模型思考档位失真、WebView 启动失败恢复、系统文件选择超时取消，并补齐消息历史翻页。候选为 **2.1.2 / 83，ROUTE=dom-shell 的 App 化 DOM 容器（含 WebView）**。未发布，v2.1.1 标签与发布不变。

## 身份与自动检查

- APK：`dist-app/remaining-2026-11-14/Codex-Turnloom-2.1.2-app.apk`，1,780,565 字节。
- SHA-256：`4129d2e04be72207bae6fc5a2fdcede221f8d2e95b9acda33f9c38863b3fc234`；实际设备拉回的 base.apk 一致。
- 构建时 67 个源文件哈希与工作区一致；包内 HTML 与 `index-BcyB_JNg.js` 和冻结构建逐字节一致。提交身份由交付目录后续的 `source-commit.json` 绑定。
- 最终本地 `npm run verify:ci`：Node 24.19.0 与 Node 22 各 **389 pass / 0 fail / 0 cancelled**，最终 PASS。TypeScript 检查通过。
- 原生生产 helper 的直接 JUnit **8/8**、release Java 编译及离线 assembleRelease 通过。完整 Gradle JVM 单测仍因本地缺少 JUnit/org.json 依赖受阻，未联网下载，不能将 8 项当成整套 Gradle 单测。

## 实现及实测

| 问题 | 修复与证据 | 当前结果 |
|---|---|---|
| Codex 新会话首轮丢失 effort | 用正式 `initialize → thread/start → turn/start` 协议替代 debug CLI；明确传 model、effort、cwd。仅明确未执行时降级，超时或缺确认不重放 | 实际 APK 两轮真实助手回复，rollout 两轮都是 `gpt-5.6-sol / low` |
| PI 模型统一伪造档位 | 桥按供应商精确模型读取 thinkingLevels/defaultThinkingLevel；空档位保留，未知不编造，非法档位拒绝 | 新后端保留 220 模型，其中 181 个无档位；max-only/off 等真实声明保留 |
| 旧 sidecar 覆盖真实目录 | 查出第二写入器仍固定 medium；提供唯一锚点校验、备份和哈希回读的迁移脚本，补回已存在计划任务缺失的无窗口启动器 | 计划任务结果 0，进程跨 shell 存活且窗口句柄 0；能力目录稳定 |
| WebView 首次启动崩溃 | 只准备本应用私有目录，捕获初始化错误，浅色原生失败页和显式重试，保留配对数据 | Android 用户 10 首次启动未清数据直接成功。未复现底层 ENOENT，不宣称已证明所有设备根因消失 |
| 系统文件慢选/超时 | 默认等待 10 分钟、超时精确取消原生请求、requestCode 不复用、旧 worker/ActivityResult 不得认领新请求；同步并发守卫 | 开发实测 SAF 打开 **190,001ms** 后返回托盘；原审查会话在同一新包独立补齐短超时后同进程重选、迟到结果丢弃、第三次选择及 178B 文件 SHA/单次发送，已通过 |
| 长消息历史不可访问 | 新增“加载更早消息”，按后端 olderCursor 翻页；保留历史、去重、旧页不改变运行态 | 实际 APK **80→160→205** 条，后续轮询仍 205 条 |
| 列表分页与双服务组合 | 沿用 /api 契约和 scope/generation 隔离 | 125 会话三页；同 threadId 的草稿、模型和消息互不混入；暂扣 A 响应后切 B 再释放不污染 |
| 网络失败恢复 | 保持草稿与幂等请求 | 实际关闭本地服务使连接失败，恢复同端口后重试成功且只收到一次发送 |

文件字节证据：265 B，SHA `08b5404ccef823238e5635f0f3d2dcef90d15ca42b03ea89f2e449488d49e8ad`。HTTP503 后正文与附件保留，成功重试沿用 `app-1794642291071-tnej9jpw`，解码字节及 SHA 一致。

真实 Codex 会话 `01a1d910-033e-7843-83a5-3cf3dfb00d8e`，两轮 turn 为 `01a1d910-0e91-7d32-a912-2b6c05a00b4e`、`01a1d912-eef8-76a3-8abd-40429dd6f4ca`，真实回复 `REMAINING_CODEX_ONE/TWO`。第二轮最初遇默认 IPC `ENOENT`，草稿保留，管道恢复后重试成功；两轮 task_complete 已核对。该 QA 会话已精确备份并归档。

## 验收边界与剩余阻塞

1. **PI 真实两轮仍被宿主绑定阻塞**：开发两次真实 POST /api/send 返回 `Plugin host process is no longer active`，未创建专用 QA 会话。独立审查用正确的 UInt32LE 长度前缀帧确认管道可应答；真实只读链路 `turnloom/host/invoke → plugin/list` 在 8ms、`skill/list` 在 1ms 返回同一错误。因此当前阻塞位于 `pi.desktop.invoke` 背后的插件宿主绑定，具体根因仍未定。已确认 dev reload 后仍失败，不能承诺再重载一次即可恢复。最短后续路径是宿主侧恢复该绑定，先验证只读调用成功，再补 PI 真实两轮；不得强杀正在执行任务的 PI 主程序。历史供应商 HTTP400 当前状态仍未知。
2. **短超时后同进程再次选中文件已独立通过**：PID 2043 未重启、未清数据；仅将一次生产 600000ms 定时器缩短为 2000ms，真实取消后同进程重选成功，迟到结果丢弃，第三次选择成功。178 B `text/plain` 文件 SHA 为 `7a8e112c1d74ea53b9bd5517c859e80ece1e32eca56d8a9e9e72f020f928eb23`，夹具只收到一次发送，requestId 不同。开发原先的工具失败记录保留，由新独立证据补齐限制。
3. 全新用户启动成功仅覆盖本次 Android35/MuMu。初始化失败页由生产 Java helper 测试证明，未在本次设备强行制造 WebView 库故障。
4. 本轮实际抽屉包含新任务、模型、项目选项、服务切换、运行信息、忘记电脑确认和系统 Back；链接确认结果以交付 `link-result.json` 为准。不作主观视觉评分。
5. 本轮仍使用缓存依赖；未在线安装。现有 18788/8799 HTTP 服务未被重启，其 server.js 内存代码仍是旧版；本轮真实与能力验收使用新代码临时后端 7473/7474。桥和 sidecar 本机部署单独记录，不把文件同步当成服务已重载。

旧公网服务器已退役，不适用；本轮没有探测、连接、重试该 IP 的任何端口或旧入口。新公网入口需另行指定。

## 证据与收尾

交付画廊与机器可读结果放在 `dist-app/remaining-2026-11-14/`，独立原报告、4 张原生 PNG、正确/作废探针和机器可读清单归档在其 `independent-review/`。独立 Node24/22 各 389 项、49 项专项、13 项设置专项与分页 9 项断言分别记数，不相加充数；分页独立检查为契约复算，开发侧有实际 APK 205 条滚动/轮询证据。旧包 `398f924a` 的独立 17 项与 14 张截图保持原记录，本轮不继承其数量。无效换行 JSON 探针已明确排除；同期 OOM 不作为已证根因。

本轮只清自有 Android QA 用户、精确标记的 QA 会话、自有端口映射和临时服务；机主配对数据保留。设备/进程最终回执见交付 `cleanup.json`，远端 exact-head CI 与原审查会话新包交接见 `completion.json`。
