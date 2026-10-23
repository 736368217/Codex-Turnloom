# Codex-Turnloom 托盘控制台

Windows 托盘应用，用来启动、停止、诊断本机 Codex-Turnloom 服务，并查看手机配对信息。它接管原来由 `scripts/windows-supervisor.ps1` 完成的服务与 SSH 隧道守护。

## 开发运行

需要 Windows 10/11、Node.js 18+（建议 22+，服务端优先使用 `node:sqlite`）。

```powershell
npm ci
npm run desktop:dev
```

首次运行没有 `%LOCALAPPDATA%\CodexPocket\config.json` 时会打开三步设置向导：检测 Codex 数据目录、设置端口/访问码、启动并显示配对二维码。向导只识别 Codex Desktop 的 `state_5.sqlite`；PI-Desktop 的 `D:\pi-data\data\pi.sqlite` 是另一套 schema，不能通过选择目录导入。

## 选择哪个 Codex 数据目录

`C:\Users\<user>\.codex` 常是到 `D:\codex\.codex` 的 junction。两者指向同一份
`state_5.sqlite`，选择任意一个都能工作；推荐选择 `D:\codex\.codex`（`CODEX_HOME` 环境变量
通常也指向这里，路径更直接）。当前版本会按 `realpathSync` 的真实路径去重，因此向导只会显示
一个 Codex 数据目录，不再出现两个看起来重复的选项。

PI-Desktop 的 `D:\pi-data\data\pi.sqlite` 不能被托盘控制台直接导入：它是另一套 schema，
不是 Codex 的 `state_5.sqlite`。要在手机端同时和 Codex、PI-Desktop 对话，走
`turnloom-pidesktop` 插件提供的桥：它把 PI 会话镜像成 Codex 门面，并在
`\\.\pipe\pidesktop-codex-ipc` 上扮演 Codex Desktop。

## 同时连接 Codex 与 PI-Desktop

两种接法都支持：

1. **两台设备（推荐）**：控制台继续托管本机 Codex（默认 8787），PI-Desktop 桥由插件托管在 8799。
   在「设置 → 其他设备」点「检测 PI-Desktop 桥」，填入 PI 侧访问码后保存；配对页会出现
   「本机」和「PI-Desktop」两个标签，各生成一张二维码，手机应用里就是两台设备。
2. **单设备合并（高级）**：把「Codex 数据目录」指向门面目录（`%USERPROFILE%\.pidesktop-turnloom`），
   并在「Codex IPC 管道」填写 `\\.\pipe\pidesktop-codex-ipc`。门面里有多少会话就显示多少；
   若插件开启 `TURNLOOM_MIRROR_CODEX=1`，Codex 会话也会合并进同一个列表。

「其他设备」只接受 http/https 地址；访问码只保存在本机 `config.json`，不会写入日志或导出。

已经用 `scripts/install-windows.ps1` 安装过的电脑，控制台会读取现有配置并尝试停止旧计划任务 `Codex Pocket Supervisor`，不需要重新配对。旧脚本保留，供无桌面环境或回滚使用，不能和托盘控制台同时运行。

## 常用命令

```powershell
npm run desktop:dev      # 开发模式启动
npm run desktop:start    # 以当前仓库启动（隐藏窗口用 --hidden）
npm run desktop:pack     # 生成未安装的目录包
npm run desktop:build    # 生成 NSIS 安装包
npm test                 # 服务端 + 桌面控制台测试
```

只注册登录托盘启动项、不打开控制台：

```powershell
npm run desktop:install
npm run desktop:uninstall
```

## 退出与关闭语义

- 点击窗口关闭按钮：默认最小化到托盘，服务继续运行。
- 托盘菜单“停止服务”：只停止本机服务与 SSH 隧道，窗口保留。
- 托盘菜单“退出控制台”：停止服务并退出应用；不会有遗留 node/ssh 进程。
- 托盘图标状态：蓝色/绿点 = 运行中，琥珀 = 启动/重启/降级，灰色 = 已停止，红色 = 启动失败。

## 结构

```text
desktop/
├── main.cjs                 # Electron 主进程、托盘、窗口、IPC
├── preload.cjs              # contextBridge 白名单
├── service/
│   ├── config.cjs           # 配置读取/保存/迁移/校验
│   ├── controller.cjs       # node server.js 子进程与重启退避
│   ├── tunnel.cjs           # SSH 反向隧道与重连
│   ├── health.cjs           # /api/health、/api/debug/events、端口探测
│   ├── runtime.cjs          # 服务 + 隧道的整体状态
│   ├── logger.cjs           # 2000 行环形缓冲、文件日志、脱敏
│   ├── pairing.cjs          # codexpocket://add 配对二维码
│   └── legacy.cjs           # 旧计划任务/进程迁移
├── renderer/                # 概览、配对、日志、设置、初始向导
└── assets/                  # 托盘图标与 app.ico
```

## 性能说明

- 主窗口按需创建；隐藏 10 分钟后销毁渲染进程，只保留主进程和托盘。
- 健康检查每 5 秒一次，进程内存每 10 秒一次；最近任务只在窗口可见时每 30 秒刷新，隐藏即暂停。
- 日志只保留最近 2000 行，UI 最多渲染 500 行；日志文件超过 5 MB 启动时轮转。
- 不使用前端框架，不加载远程资源。

## 打包注意

- `electron-builder` 使用 `asar: false`，因为服务端 `server.js` 需要以真实文件路径启动。
- 安装包内置 `server.js`、`public/`、`scripts/`，但默认使用系统 `node.exe`（与现有安装一致）。如果目标电脑没有 Node，需要把便携版 `node.exe` 放进 `desktop/assets/runtime/` 并在 `config.nodePath` / 启动逻辑中指向它。
- 未签名安装包首次运行会触发 SmartScreen；正式分发前配置代码签名证书。
- 设计稿和视觉参考在 `docs/DESIGN_TRAY_CONSOLE.zh-CN.md`。
