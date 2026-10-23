# Codex-Turnloom 1.16.0 发布说明

- 发布日期：2026-10-23
- 版本：`1.16.0`（Android `versionCode` 20）
- 桌面安装包：`Codex-Turnloom-Console-1.16.0-x64.exe`
- 校验值：SHA-512 见 `dist-desktop/latest.yml`；SHA-256 `26FF0E88E82DACB19D2E7A5B97F721AA2BDFCDAADFE592C777926F82321834D1`

## 亮点

- **Windows 托盘控制台**：登录后静默驻留托盘，可启动/停止/重启本机服务、查看日志、显示手机配对二维码、管理 SSH 隧道；关闭窗口只最小化，托盘“退出控制台”会停止服务并清理 node/ssh 进程。
- **HTTP 后端适配器**：`--backend http` 可直接接入任意 agent，不读写 `CODEX_HOME`；浏览、读取消息、发送、中断全部可用。
- **多设备 profile**：`--profiles` 支持同一端口按 token 路由到 Codex 或 HTTP 后端，各设备访问码独立，跨 profile thread id 返回 404。
- **可靠性**：单条坏 rollout 不再拖垮 `/api/threads`；新增 `/api/admin/diagnostics`；支持可选 `status_*` 状态列和 `/api/adapters/status`。
- **性能**：优先 `node:sqlite`（无子进程），rollout 状态按文件签名缓存，线程列表支持分页/ETag/304。
- **移动端**：Loom Studio V2 视觉刷新、语义状态胶囊、权限决策卡、队列消息面板、Android 设备选择器升级；访问码按设备隔离，扫码设备按 `(origin, token)` 去重。

## 升级说明

- 已有 `install-windows.ps1` 安装会复用 `%LOCALAPPDATA%\CodexPocket\config.json`，无需重新配对。
- 首次使用托盘控制台会打开三步向导：检测 Codex 数据目录 → 设置端口/访问码 → 启动并显示配对二维码。
- 安装包未做代码签名，首次运行可能出现 SmartScreen 提示；正式分发前应配置代码签名证书。
- HTTP 后端模式暂不支持插件、技能、goal、置顶、compact、branch、审批和发送队列；同一 profiles 文件目前只支持一个 Codex home。

## 验证

- `npm run check` 通过。
- `npm test`：87 项全部通过。
- `npm run desktop:check` 通过。
- Electron 开发模式与打包后的 `win-unpacked` 均通过 `--smoke-test`（`state: running`）。
- NSIS 安装包已生成：`dist-desktop/Codex-Turnloom-Console-1.16.0-x64.exe`（约 108 MB）。
