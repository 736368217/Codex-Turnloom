# 2.2.6 backlog（2026-11-19 冻结，2.2.5 发布后）

> **发布边界**：2.2.5 的产物对应 tag **`v2.2.5`**（`18b7bbf`，APK 实际嵌入的资产提交）。HEAD 在发布后已经前进（`c15dec3` 起是 2.2.6 的代码），**从 HEAD 构建出来的不是 2.2.5 的字节**。复核发布包只认 `dist-app/` 里那两份 + R2 上的字节。

按「先修体验、后加能力」排。每条都写了**为什么值得做**和**证据在哪**，接手的人不需要再问一遍上下文。

## A. 发布卫生（先做，代价小）

1. **`buildType=release`**：2.2.3/2.2.4/2.2.5 都是 `buildType=debug`，产出 `android:debuggable="true"`。装在有 USB 调试的设备上，`adb shell run-as com.codex.turnloom.app` 能读应用私有数据（含本机保存的访问码）。改成 `release`（`minifyEnabled=false` 保持不变）后走同一套 zipalign + apksigner。**验收**：`aapt2 dump xmltree --file AndroidManifest.xml` 里 `debuggable` 为 false，且 WebView 调试开关（`turnloom.qaDebug`）行为不回归。证据：`docs/RELEASE_2_2_5_2026-11-19.md` 已知限制 1。

2. **版本号三处漂移**：`package.json` = 2.2.1、`app/package.json` = 2.2.4、`native-shell/app/build.gradle.kts` = 2.2.5。服务端对外版本靠 `VERSION.json`，所以不影响 `/api/health.version`；但开发态直接跑 `server.js` 时报的是 `package.json` 的值（实测 `current.version=2.2.1`）。**验收**：出包脚本把三处统一成同一版本，或明确「只有 VERSION.json 是真源」并让开发态也读它。

3. **裸解包起不来**：`turnloom-2.2.5-server.zip` 直接解压跑 `node server.js` 会缺 `qrcode-terminal` 等依赖，必须 `npm ci --omit=dev`。升级脚本会做这一步，但冒烟测试若直接裸跑会得到假红。**验收**：冒烟脚本固定成「解包 → npm ci → 起服务 → 读 health」，或在包里显式声明依赖。

3b. ✅ **已完成（`5c68386`，2026-11-19 21:30）**：`resolveLogDir()` 在 `NODE_TEST_CONTEXT` 存在时返回临时目录（`node --test` 给测试进程及其 spawn 的子进程都打这个标记），显式 `TURNLOOM_LOG_DIR` 仍优先、生产路径不变；`test/log-hygiene` 两层判据带负向对照。**我的独立复核**：跑 `http-approval-route` + `app-release` 共 8 个用例，生产日志里 `http-approval-thread` 计数 486 → 486（零增长）。

## B. 模型后端能力

4. **`piNativeQueue` 开关 + `modelsSource`**：目前切 PI 只能靠环境变量 `CODEX_LAN_PI_NATIVE_QUEUE=1` 或控制台「IPC 管道」填 `\\.\pipe\pidesktop-codex-ipc`，安装器/控制台/打包脚本一处都不注入（已 grep 确认）。建议：`config.json` 增开关、supervisor 启动时注入、`/api/health` 增 `modelsSource: "pi"|"codex"` 让手机端能认出后端（现在只能靠模型 id 猜）。**前置**：切换前必须确认 PI 桥在（`pipeReady` / `scripts/verify-pi-bridge.ps1`），否则 `enqueueSend` 的 `requestNativeQueue("push")` 直接把错误抛给手机。证据：`thread:2cd3ffab` 19:04–19:06 三条。

4b. **面板副标题按来源分叉**：现在真机上写的是「电脑端**已加入**的 16 个模型」，而 Codex 路径下 16 条是**完整目录**，没有「加入」这个概念——用户会以为自己加过 16 个。`modelsSource` 落地后一起改：PI → 「电脑端已加入的 N 个模型」，Codex → 「电脑端可用的 N 个模型」。证据：Vera 20:36 真机截图（`v225-panel.png`）。

## C. 聊天页视觉收口（Human 反复提的那一类）

5. **消息流套在一张白卡里**：`.tl-chat-list` 现在是白底 16px 圆角 + 12px 外边距，看起来像「聊天装在卡片里」。方案已定：白铺 `.tl-detail-body`（「加载更早消息」行留在 body 内、body 底 padding 12→4），list 去 margin/圆角/阴影；助手气泡换 `--tl-bubble-assistant: #E9E9EB`（**不要用 `#E5E5EA`，那是分隔线**）。证据：`docs/team/VISUAL_AUDIT.md:101`。

6. **等宽内容行为不一致**：代码块横向滚动、工具输出自动换行，两类同类内容表现不同。与「复制」按钮一起统一。**验收**：390/360/320 下代码块可横滑且不撑破气泡，工具输出不横向溢出。

7. **两个图标语义错误**：`MonitorsScreen.tsx:59` 的 `Cpu` → `MessageSquare`（会话指标用 CPU 图标）；`SettingsScreen.tsx:268` 的 `AlertTriangle` → `Info`（「版本」不是警告；`VISUAL_AUDIT.md:106` 记的是 222 行，文件已改动，实际在 268）。两处改完删对应 import。证据：`docs/team/VISUAL_AUDIT.md:106`。

## D. 验收补验（2.2.5 遗留）

8. **更新入口真机首点**：`查看并安装` 只在「清单版本 > 已装版本」时渲染，2.2.5 上线后装 94 的设备看到的已是「最新」，没有可点的按钮。**验收必须在 2.2.6 发布时做**：拿一台装 2.2.5 的设备，看到 2.2.6 的入口并点通（下载 → 校验 → 系统安装 → 授权引导）。证据：`docs/RELEASE_2_2_5_2026-11-19.md` 已知限制 3。

9. **控制台窗口内真人点击**：「上传日志」成功 toast 应有对象 key 与文件数（另有 `N 个未带` 时也要显示）；「检查更新」应显示 `current 2.2.5` 与「已是最新」。端点层已验（含缺令牌、R2 拒收两条失败分支）。

## E. 运维

10. **R2 日志前缀的保留策略**：`turnloom/logs/**` 目前没有 lifecycle，对象公开可读、永久保留。建议 30 天过期或定期按前缀清理；目前已有 3 个测试对象（`…-205c04a1.zip`、`…-dd58962e.zip`、2.2.5 验收那次）。证据：`docs/LOGS.zh-CN.md` §4.2。

11. **旧计划任务迁移**：这台机器上「Codex Pocket Supervisor」仍是 8787 与隧道的托管体，每 ~59 秒触发，写 `supervisor.log`。正确顺序是「新托管装好并确认能用 → 再结束旧任务」，不能反过来。**需要 Human 一句授权**，因为会让服务短暂失去看管。证据：`docs/LOGS.zh-CN.md` §4.1。

12. **隧道主机密钥**：`~/.ssh/known_hosts:9` 记的 `121.40.69.97` 与服务器现用 ED25519 不一致，`StrictHostKeyChecking=yes` 导致每 7 秒拒连、公网入口不可达。等 Human 确认「是否重装/换钥」后再改：备份 `known_hosts` → 删第 9 行 → `schtasks /Run` 以 SYSTEM 身份重拉 → 看 `tunnel-error.log` 是否变成 `Permission denied (publickey)`（那才是服务器侧掉了这把钥匙）。证据：`thread:e32e124e` 18:54/18:57/19:04 三条。

## F. Windows 控制台（本机从未安装过）

13. **控制台的安装路径没有任何真机记录**：这台机器上没有 `node_modules\electron\dist\electron.exe`、没有计划任务 `Codex-Turnloom Console`、没有开始菜单快捷方式、也没有 `%LOCALAPPDATA%\electron`。`scripts/install-console.ps1` 第一步就校验 electron.exe，缺失直接 throw——所以 `npm run desktop:install` 现在起不来。**后果**：「上传日志」「检查更新」两张卡片只有代码路径与端点证据，**没有任何一次在真实托盘窗口里的点击**；2.2.5 验收里这一格因此写成「本机未安装控制台，未验」而不是「通过」。**验收**：在一台干净 Windows 上 `npm ci && npm run desktop:install` → 托盘出现、两张卡片可点、更新显示 `current 2.2.5 / 已是最新`、上传返回对象 key → `npm run desktop:uninstall` 后计划任务与快捷方式都不残留。证据：`thread:e32e124e` 21:27 Rhea 的只读排查。
