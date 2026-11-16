# R06/R07 恢复交接 — 2026-11-14

**来源**：会话 `4a7f0fb3`（从被取消的 `a267b24d` 磁盘状态恢复；该会话因 AGENT_SIDECAR_OOM 中断，死在真实宿主多轮测试之后、生成画廊与推送之前）。

## 交付身份

| 项 | 值 |
|---|---|
| 修复提交 | `398f924a29adca033db1857f9d5d285edc8fb651`（`fix: keep running Enter from stopping and unify thread status`），由被取消会话在 01:11:39 创建，本轮确认其源码与工作区一致并推送到 `origin/main` |
| 基线 | `074266ffded3a07ddae1c47e60e0544a7634ea07`（推送前 origin/main） |
| APK | `Codex-Turnloom-2.1.2-app.apk`，SHA-256 `16e38f0387142673c810a7e71e431f60d87a29976cfb064aaf20ad45c07775f0`，1,776,469 bytes，versionName 2.1.2 / versionCode 83，**未发布候选**；`v2.1.1` 发布保持不变 |
| 实测包身份 | 安装后拉回的 `base.apk` 与构建产物 SHA 一致；7 张手机专项 PNG 绑定该 APK SHA |
| 源码归属 | 47 个前端/构建输入文件哈希与工作区逐个一致，0 处不符；APK 内嵌 `index-yc-RzmEq.js` 与构建 JS SHA 一致 |
| 远端 CI | `Verify` run `43544532891`（headSha 同修复提交）**success**：server job 的 "Test suite (fail on cancelled subtests)" / check / desktop:check / 脚本解析，以及 android job 的 `gradlew testDebugUnitTest assembleDebug` 全部 success |

## 本轮补齐的缺失交付物

被取消会话的文档已声称 `dist-app/retest-r06-r07-2026-11-13/`，但该目录从未生成。本轮从 scratch 结构化结果 + PNG 重建；最终以磁盘上的 `index.html` / `manifest.json`（10:09:33 写入的分组版）为准，其身份与本轮校验一致：

- `index.html`：离线画廊，13 张 1080×1920 原生截图（7 张绑定 APK SHA 的 R06/R07 专项 + 3 张文件/网络 + 3 张真实宿主），13 个 base64 内联图、0 外链、可点击放大；逐张重新校验 SHA。
- `manifest.json`（最终版）：`commit` / `apkSha256` / `version` / `device` / `sourceBinding`（47 文件 0 不符）/ 22 项 `checks`（12 R06/R07 + 5 文件网络 + 5 真实宿主，全 pass）/ `screenshots` / `realHost` / `eightItems` / `scope`。
- `Codex-Turnloom-2.1.2-app.apk` 及 `.sha256` / `.idsig` / `build-manifest-2.1.2.json`：从 scratch 复制并逐个校验，供独立复测直接安装，不依赖被取消会话的 scratch。

原始构建、安装、设备与真实宿主结果仍在 `D:\pi-data\data\scratch\a267b24d-319e-47b6-86d5-19d57bd827bd\retest-r06-r07\`。

## 本轮从当前磁盘重跑的验证

- `node --test test/app-state-recovery.test.cjs test/app-mobile-actions.test.cjs test/app-chat-contract.test.cjs`：**29/29 通过，0 失败、0 取消**（含 R06 决策、R07 投影、Stop 前迟到轮询、旧列表覆盖、嵌套返回）。
- `npm run verify:ci`：**最终 PASS**；Node 24 与 Node 22 各 **366 pass、0 fail、0 cancelled**。
- `npm run check`、`npm run desktop:check`、构建树工具链 `tsc --noEmit`：均退出码 0。
- 构建清单 9 步（validate / sync-source / vite-build / copy-assets / assembleRelease / zipalign / apksigner-sign / apksigner-verify / aapt2-badging）全部 `ok`。

注：工作区 `app/node_modules` 未安装（构建走 scratch 镜像），因此 `npm run app:typecheck` 在主工作区报 `tsc` 找不到；本轮用构建树的 `tsc.cmd --noEmit -p <build-tree>/tsconfig.json` 直接验证，退出码 0。这不是产品缺陷。

## 独立复测已完成（2026-11-14）

原审查会话 `085b0cda-a463-419e-bafc-bafd3bad412f` 已按实际 APK 独立验证以下场景：17 项行为检查通过、14 张 1080×1920 原生截图。无需重复送测同一修复。

1. R06：运行中按 Enter（应不发送、不停止、草稿保留）、附件提交、独立停止按钮；空闲 Enter 正常发送；真实软键盘弹出时发送键触点可达。
2. R07：Stop 前后列表徽标、运行中筛选、首页任务卡、监控运行数的同源状态；旧列表不能复活 running。
独立业务请求均使用隔离夹具；其17项与开发自测22项分别计数，不将固定 assistant 文本当真实回复。[独立报告](independent-review/report.md)与[独立画廊](independent-review/index.html)已归档；主会话复核原清单39个条目、APK及原报告/画廊SHA一致。

## 剩余阻塞（不得据此宣称「手机全部无问题」）

- **旧公网服务器已退役，不适用**：用户 2026-11-14 永久停用 `121.40.69.97`。禁止再探测、连接、重试、部署或恢复任何端口和旧入口；新入口须由用户另行指定。
- 真实宿主 model/effort **部分通过、待定位**：历史请求 low 而新建首轮实际 high，第二轮 low 生效；直接接口也复现。后端到宿主之间的具体丢参位置尚未定位，不将“宿主限制”当已确认根因。本轮独立验收未覆盖。
- PI 默认供应商此前上游 HTTP 400 未修复、未重测；真实 Codex 多轮通过不能外推到 PI。
- 全部抽屉 / 长会话分页 / 服务切换组合流程未在手机上走完；仅单测覆盖分页与 harness 切换。
- 主观视觉评分未建立；候选 APK 未发布，`v2.1.1` 标签与产物保持不动。

独立报告如实保留 QA 用户首次启动 WebView ENOENT、慢选文件首次托盘未出现和夹具意外中断；恢复后流程通过不等于这些异常已修复。真实宿主/PI多轮、受控断网、通用首次安装与完整组合流程仍有独立验收缺口。

原审查设备收尾记录：回到 Android 用户0、QA 用户回收、自有文件及映射清理、index1 合法 release 后停止。此收尾仅离线核对证据，没有再次启动 MuMu；候选 APK 身份不变，未发布。
