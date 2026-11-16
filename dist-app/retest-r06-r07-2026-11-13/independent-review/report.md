# 手机优先独立复测报告 · 398f924a

日期：2026-11-14。执行：原独立审查会话 085b0cda-a463-419e-bafc-bafd3bad412f，本人执行，未委派子 agent。

**结论：R06（运行态 Enter 误停）与 R07（停止后跨页面状态不一致）在本轮覆盖场景中独立通过。17 项手机行为检查通过，未发现这两项原缺陷再次复现；这不等于手机全部场景或真实助手端到端已验收。**

[手机截图与结果画廊](index.html) · [17项明细](mobile-result.json) · [SHA清单](evidence-manifest.json)

## 1. 身份与独立证据

- 固定提交：398f924a29adca033db1857f9d5d285edc8fb651；隔离工作树以该提交检出，tracked diff 为0。
- 候选包：2.1.2 / 83，包名 com.codex.turnloom.app，1,776,469 bytes，未发布。
- APK SHA-256：16e38f0387142673c810a7e71e431f60d87a29976cfb064aaf20ad45c07775f0；本会话在 guest 实读 base.apk，前后与候选一致。
- 本次没有覆盖安装用户0的应用；已有实装包已核对一致，在自有 ephemeral Android 用户11执行 install-existing、配置合成配对和测试。
- APK 内 JS index-yc-RzmEq.js 及 HTML 与本会话从该提交独立构建的文件逐字节一致。
- Android15/API35，phone index1，实际1080×1920/440dpi，运行 PID3151。读取 APK 自带 QA WebView 调试入口测量 DOM，触点、Enter、Shift+Enter、Back 均由 Android input 执行；没有用 element.click() 代替业务触点。

证据：[主机身份](identity.json)、[实装记录](installed-identity.json)、[包内资源绑定](bundle-binding.json)。

## 2. R06 与 R07

| 原问题 | 本轮独立结果 | 关键证据 |
| --- | --- | --- |
| R06：运行态 Enter 触发 Stop | 运行态 Enter 显示阻止提示，发送0、停止0，草稿保留；Shift+Enter 实际插入换行；带文件提交保留正文与托盘；Stop 为独立 type=button，实点后仅中断当前 qa398-run。空闲 Enter 发出文件请求，未增加停止次数。 | [Enter](snapshot-running-enter.json)、[原始计数](fixture-running-enter.json)、[Stop](fixture-after-stop-late-poll.json) |
| R07：列表仍运行中而监控已停止 | Stop 前暂扣一条 running 状态轮询，Stop 后释放；详情仍空闲。首页卡片、列表徽标显示已结束，运行中筛选0，监控0及空态一致。手动刷新后服务仍返回旧 running 列表，界面没有复活任务。 | [暂扣轮询](fixture-poll-held-before-stop.json)、[迟到响应后](snapshot-after-stop-late-poll.json)、[列表](snapshot-refreshed-ended.json)、[筛选](snapshot-running-filter-empty.json)、[首页](snapshot-home-ended.json)、[监控](snapshot-monitor-zero.json) |

代码核对：[composerSubmit](source/app/src/lib/composerSubmit.ts:7)、[统一状态投影](source/app/src/lib/threadProjection.ts:17)、[发送与停止处理](source/app/src/screens/ChatDetailScreen.tsx:124)。手机行为与实现相互支持，未仅凭静态匹配判通过。

## 3. 日常消息补充检查

- 原生 DocumentsUI 选取本轮47字节 text/plain 测试文件；本地原文件、guest文件及 APK 传给 HTTP 服务的解码 SHA 均为 d9f146fb4462c0dfccccec20db9a88d1bc7ca44f28b64d05f2544604c3a2f786。
- HTTP503后正文、附件保留；重试沿用请求ID app-1794626194728-5lmopnaa，两次文件 SHA 一致；成功后正文和托盘清空。503属于业务服务失败，不等同真实网络断开。
- 系统 mInputShown=true、mIsInputViewShown=true；Send底部662.55 CSS px，小于675px视口，DOM中心命中。Android input tap 975 1833 后实际收到 Keyboard_Button_398 并清空输入，没有增加 interrupt。
- 新建任务内模型抽屉：打开时2层；第一次真实Back后保留新建任务、模型搜索框消失；第二次Back后0层，回到会话列表。

证据：[文件失败与载荷](fixture-file-503.json)、[同ID重试](fixture-file-retried.json)、[IME状态](phone/qa398-ime.txt)、[发送键几何](plan-send.json)、[触点后请求](fixture-ime-send.json)、[第一次Back](nested-first-back.json)、[第二次Back](nested-second-back.json)。

## 4. 独立回归与构建

| 检查 | 结果 |
| --- | --- |
| verify:ci · Node24 | 366 pass / 0 fail / 0 cancelled |
| verify:ci · Node22 | 366 pass / 0 fail / 0 cancelled |
| 状态恢复 + mobile-actions + chat-contract | 29/29，0失败、0取消 |
| TypeScript --noEmit | exit0 |
| Vite build | exit0；2256 modules，主JS727.95kB/gzip213.01kB，仍有大chunk警告 |

[CI结果](verify-ci-complete.json)、[专项结果](mobile-regressions.json)、[类型检查](typecheck.json)、[构建结果](app-build.json)。两套运行时是同一测试集，不合计为732个独立用例；29专项与全量有重叠。隔离树第一次全量因缺少jsdom等根依赖失败，复用本机现有依赖后门禁通过，未联网安装，旧失败日志保留。新原生Java逻辑未改，本轮未独立重跑Android JVM矩阵。

## 5. 环境异常与未覆盖范围

- 有效租约期间phone实例曾停止；通过租约入口恢复，没有操作其他实例。
- 新临时用户11首次启动时，WebView创建 webview_data.lock 报ENOENT并崩溃。仅 clear 自有QA用户11数据后冷启动恢复；[首次崩溃记录](initial-qa-crash.txt)保留。恢复后的PID3151完成本轮流程，[该PID crash缓冲](runtime-crash.txt)为空，不能据此抹掉第一次启动异常，也不能泛称所有首次安装场景通过。
- 第一次文件选取耗时很长、托盘未出现；客户端有180秒picker超时。未将该次计为通过，也未仅据此归因为R06。限时内重选记录到原生成功回调及文件托盘，随后字节校验通过。[回调观察](probe-read-picker-trace.json)只记录状态和元数据，不制造选取结果。
- 自有HTTP夹具进程曾结束，按原端口恢复；App PID没有变化，草稿和附件保留。Stop及迟到轮询在恢复后的同一夹具进程内完成。该意外中断未冒充受控断网验收。
- 本轮全部业务请求均为自有隔离夹具。固定 assistant 文本和合成HTTP成功不能证明真实助手回复。开发会话此前提供的真实Codex两轮、首轮effort被置high、PI供应商HTTP400等结论属于历史证据，未计入本会话独立通过数量。真实宿主model/effort、PI真实多轮、全部抽屉/长会话分页/服务切换组合仍未由本轮独立完成。
- 本轮不建立主观美观评分；只验证真实PNG、几何、触点和报告画廊加载，不能外推全部屏幕文字、遮挡和长期性能。

**旧公网服务器已退役，不适用。** 依据用户2026-11-14明确约束及项目AGENTS.md第10–13行，不再探测、连接、重试或恢复121.40.69.97的任何端口及其旧入口；本轮对此地址网络调用0次。不再将其列为待恢复故障，新入口须由用户另行指定。[退役口径](retired-endpoint.json)。

## 6. 环境恢复与交接

用户已切回0，临时用户11自动回收，用户列表只剩机主0；用户0配对/数据未写入或清空。本轮guest文件及47字节测试文件已删除，上一轮遗留的登录PNG已核对SHA后删除，修复了此前清理限制。自有调试映射14116已移除，QA PID3151退出；自有HTTP进程7288停止。phone index1 release返回released:true并停止、owner清空；没有操作car或其他phone实例。

真实PI/Codex QA任务创建0，真实用户任务发送/停止/审批0；未修改产品源码、提交、推送或发布。[设备恢复](device-restoration.json)、[宿主清理](host-cleanup.json)、[租约释放](lease-release.json)。

本轮结果将直接回报原修复会话a267b24d-319e-47b6-86d5-19d57bd827bd；回报以报告路径、固定身份和剩余范围为准。
