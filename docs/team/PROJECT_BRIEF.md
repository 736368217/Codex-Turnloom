# Codex-Turnloom — 项目简报（团队共用）

## 目标

把 Codex-Turnloom 做成一个**对标国际大厂成熟手机 AI / 聊天产品**的移动工作台：

- 手机端能可靠连接电脑上的 **Codex Desktop** 与 **PI-Desktop**；
- 浏览会话、继续对话、处理审批、查看工具/思考/文件、管理多台电脑；
- 视觉达到 iOS 级完成度：浅色 Option A（Cupertino Daylight Glass），毛玻璃、圆角分组卡、底部手势抽屉、拇指区输入舱；
- 易用性经得起真实手机尺寸与单手操作：无遮挡、无死路、错误可恢复、状态可信；
- 可构建、可安装、可验收：`app/` → `native-shell/` → APK，附自动化与真机/模拟器证据。

## 当前基线

- 仓库：`D:\Turn-DSH\Codex-Turnloom`（upstream main 快照，2026-11-18，README 标注 2.1.2 / app 2.1.7）。
- 唯一交付线：`ROUTE=dom-shell`，`app/`（React + Vite + Konsta UI + Vaul）+ `native-shell/`（Android Java WebView）→ APK。
- `public/`、`mobile-app/`、`android/` 是冻结归档，不作为交付线，不要以它们为依据做新功能。
- 已有质量审计：`main-branch-quality-audit.md`（P1 审批绑定、行高、监控中断、干净检出测试；P2 Markdown、离线误判、计时、分页）。部分已在 2.1.7 修复，必须复核而不是照抄。
- PI 桥：`third-party/turnloom-pidesktop/`，把 PI-Desktop + Codex 会话镜像到门面目录 `~/.pidesktop-turnloom`，并在 `\\.\pipe\pidesktop-codex-ipc` 扮演 Codex Desktop；默认 `MIRROR_CODEX=0`。本机 PI-Desktop 已安装并在运行，尚未装桥插件。

## 硬约束

1. **不要修改 Codex Desktop 的数据与安装**；Codex 会话只读，写操作只能走它自己的 IPC 代理。
2. PI-Desktop 是本机临时安装，可重启、可装桥、可造测试会话；但不要删除用户已有项目/凭据。
3. 视觉遵循 `docs/option-a` 与 `tools/specs/AGENTS.md` 的 Option A；不要引入暗色主界面、桌面网页布局、居中弹窗。
4. 所有结论必须有证据：命令输出、截图、测试结果、真实 API 响应；禁止把“应该可以”写成“已验证”。
5. 文件所有权按 Task 划分，跨范围修改先在 Thread 里说明，避免并行冲突。
6. 不提交密钥、访问码、真实私人对话、APK、`node_modules`、构建产物。

## 环境

- Windows，Node 24（仓库要求 >=22.5），JDK 21，Android SDK 在 `C:\Users\Administrator\tools\android-sdk`，AVD 已有 `paopao_api33` 等。
- 本机 `PI-Desktop` 进程与 `%APPDATA%\PI-Desktop`、`%USERPROFILE%\.pi-desktop` 可用。
- 端口约定：Turnloom 8799；PI host-core 25800；不要抢占 Codex 的命名管道 `\\.\pipe\codex-ipc`。
- 网络：GitHub git 协议被重置，codeload / raw / jsDelivr 可用；不要在任务里反复重试 `git clone`。

## 验收口径

- `npm test`、`npm run check`、`npm run app:typecheck`、`npm run app:build` 通过。
- `npm run app:android` 或 `scripts/build-single-app.ps1` 能产出可安装 APK，并通过 `scripts/verify-single-app.mjs`。
- 390×844（以及 320/360/768）下无横向溢出、无遮挡、触控目标 ≥44px。
- 关键流程：配对 → 会话列表 → 打开会话 → 发送 → 流式/轮询更新 → 停止 → 审批（真实请求绑定）→ 断线恢复 → 重启冷启动。
- PI-Desktop：会话可见、可继续、可停止、排队/附件/归档/模型选择至少各有一条真实验证记录。

## 团队与边界

| 成员 | 角色 | 主责范围 |
|---|---|---|
| @NB agent | 项目 owner / 集成 | 目标、任务、最终验收、跨模块集成、发布 |
| @Atlas | 技术负责人 | `server.js` 核心/审批/API、`backends/`、测试与质量门禁、代码评审 |
| @Iris | 产品设计 | `app/src/theme/**`、`ui.tsx`、GlassTabBar、MachineHubHeader、StatusCard、Segmented、VaulSheet、`globals.css` 视觉层 |
| @Vera | 可用性/前端质量 | `app/src/screens/**`、`app/src/state/**`、`app/src/lib/**` 交互、E2E/可访问性 |
| @Kai | PI-Desktop 适配 | `third-party/turnloom-pidesktop/**`、`server.js` PI 专属段、PI 验证脚本 |
| @Rhea | Android/移动端工程 | `native-shell/**`、`scripts/build-single-app.ps1`、`app/vite.config.ts`、模拟器/APK |
| @Otto | 机械执行 | 跑测试/构建/截图矩阵并汇总；不改源码 |
| @Lin | 素材/文档执行 | 按给定模板整理文档、裁图、清单；不做架构判断 |

## 工作方式

- 每个 Task 在自己的 Thread 里推进；开始时用一句话 Claim 方向，完成后报告“做了什么 / 验证了什么 / 还有什么风险”。
- 需要别人配合时，在 Thread 里 @ 对应成员，不要私下拉人做整块工作。
- 修改前先 `git status`，不要回滚别人的未提交改动。
- 视觉类改动附 390×844 截图；交互类改动附操作步骤与结果；后端类改动附测试名。
