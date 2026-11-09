# Codex-Turnloom

[![Release](https://img.shields.io/github/v/release/736368217/Codex-Turnloom?label=release)](https://github.com/736368217/Codex-Turnloom/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Codex-Turnloom** 是一个自托管的移动遥控台：把电脑上正在运行的 Codex / PI-Desktop 会话，安全地延续到手机。对话、文件与凭据始终留在你的电脑上，手机只负责查看、发送消息与处理待办审批。

> 非 OpenAI 官方项目，与 PI-Desktop / Codex Desktop 无隶属关系。它依赖宿主的本地数据与接口，宿主升级后可能需要同步适配。

---

## 为什么用它

- **数据不出本机**：服务端读取本机 Codex 数据目录，手机端只通过 HTTP API 与本机服务通信，不经过第三方云。
- **原生 App 优先**：`mobile-app/` 是 Expo / React Native 独立安卓应用，聊天详情是全屏、无底栏的沉浸视图；Web 端仅作为兼容入口保留，不再投入新功能。
- **完整的会话控制**：会话列表与搜索、消息流、模型与思考强度、插件 / 技能引用、附件、排队 / 插队、中断、审批、Diff 展示。
- **可离线自测**：提供单文件离线演示页与独立包名的演示 APK，不联网也能逐页体验界面与交互。
- **可验证**：172 条服务端回归测试 + TypeScript 严格检查 + 真机（Android 15 / 1080×1920）功能验收。

---

## 5 分钟上手（新用户）

### 1. 准备

| 项目 | 要求 |
|---|---|
| 电脑 | Windows 10 / 11，已运行 Codex Desktop 或 PI-Desktop |
| 运行时 | Node.js 18+（推荐 20/22/24）、Git、npm |
| 手机 | Android 8+（arm64-v8a，交付包约 96 MB） |
| 网络 | 手机与电脑在同一局域网；或已配置 HTTPS 反向代理 |

### 2. 在电脑上启动服务

```powershell
git clone https://github.com/736368217/Codex-Turnloom.git
cd Codex-Turnloom
npm ci

node server.js --host 0.0.0.0 --port 8787 --password 684271
```

- `--password` 是手机端访问码，请改成自己的 6 位数字。
- 默认读取本机 `CODEX_HOME`；可用 `--codex-home <路径>` 显式指定。
- 若使用 PI-Desktop 提供的桥接，追加 `--ipc-socket \\.\pipe\pidesktop-codex-ipc`。
- 看到 `http://127.0.0.1:8787/api/health` 返回 `{"ok":true,...}` 即启动成功。

长期后台运行（Windows）：

```powershell
.\scripts\install-windows.ps1 -MachineName "我的电脑" -Password "684271"
npm run device:qr     # 随时重新打印配对二维码
```

托盘控制台（不装计划任务）：`npm run desktop:dev`。

### 3. 在手机上安装

从 [Releases](https://github.com/736368217/Codex-Turnloom/releases/latest) 下载 **`Codex-Turnloom-Native.apk`** 并安装。

| 文件 | 适用 |
|---|---|
| `Codex-Turnloom-Native.apk` | **推荐**，arm64-v8a 单架构，约 96 MB |
| `Codex-Turnloom-Native-universal.apk` | 旧设备 / x86 模拟器，约 267 MB |
| `Codex-Turnloom-离线演示.html` | 不联网、不装 App，直接在手机浏览器打开演示 |

> 两个原生包使用相同签名与包名，可覆盖升级；演示 APK 使用独立包名，可与正式包共存。

### 4. 连接电脑

1. 打开 App，首次进入会列出可连接的电脑（内置 `本机 · de` 与离线演示）。
2. 选 **本机 · de**，或在「终端」页扫码 / 手动填写：
   - 服务地址：`http://<电脑局域网 IP>:8787`
   - 访问码：第 2 步设置的密码
3. 点「保存」，提示「终端信息已保存 · 当前地址 …」后，回到「对话」即可看到真实会话列表。

也可扫描配对码，格式：`codexpocket://add?name=<名称>&url=<地址>&token=<访问码>`。

### 5. 常用操作

| 想做什么 | 怎么做 |
|---|---|
| 找会话 | 列表顶部搜索框，按标题 / 预览 / 项目过滤 |
| 继续指挥 | 点会话进入全屏聊天详情，底部输入消息后点蓝色发送 |
| 运行中发消息 | 有内容时按钮是「发送」（自动排队）；空输入且运行中按钮变红「停止」 |
| 换模型 / 思考强度 | 聊天页顶部胶囊 → 选模型 → 选强度；按会话记忆 |
| 引用插件 / 技能 | 输入舱 `@` 按钮 → 搜索并选中 → 发送时自动附加到消息 |
| 新建会话 | 列表右上「＋」→ 可选归档项目 → 输入第一条指令 |
| 复制消息 | 消息卡右上「复制」按钮，或长按消息 |
| 切换 / 新增电脑 | 底部「终端」页 |

完整功能对照与验收截图见 [带图交付报告](docs/option-a/REPORT.html)。

---

## 架构

```
┌────────────────────┐        HTTPS / LAN        ┌──────────────────────────┐
│  Android App       │  ───────────────────────►  │  Node.js 本机服务         │
│  Expo / RN 0.88    │  ◄───────────────────────  │  server.js (:8787)       │
│  NativeWind / RNR  │     /api/* + x-access-token│  ├─ Codex 数据读取       │
└────────────────────┘                            │  ├─ Desktop IPC 桥       │
        ▲                                        │  ├─ 队列 / 审批 / 发送   │
        │ 静态页面（兼容）                        │  └─ 静态托管 /downloads  │
┌───────┴────────────┐                            └────────────┬─────────────┘
│ web-ui (Vite)      │                                         │ 本地数据 / IPC
│ public/option-a/   │                            ┌────────────▼─────────────┐
└────────────────────┘                            │ Codex Desktop / PI-Desktop│
                                                 │ （对话与文件留在本机）    │
                                                 └──────────────────────────┘
```

| 目录 | 职责 |
|---|---|
| `server.js` | 本机 HTTP 服务、鉴权、会话读取、写入、队列、审批、静态托管 |
| `backends/` | 可替换的后端适配器（Codex 本地数据 / HTTP 后端） |
| `public/` | 兼容版手机 Web 界面与其缓存 / 交互逻辑 |
| `web-ui/` | Vite / React / TypeScript 新版 Web 壳源码（产物输出到 `public/option-a/`） |
| `mobile-app/` | **主线**：Expo / React Native 原生 App 源码 |
| `android/` | Android WebView 兼容壳与离线演示包源码 |
| `desktop/` | Windows 托盘控制台（Electron） |
| `scripts/` | 安装、守护、隧道、二维码与验证脚本 |
| `test/` | 服务端协议与行为回归测试 |
| `docs/` | 用户文档、部署说明与交付报告 |

---

## API 与鉴权

所有接口在 `/api/*` 下，请求头带 `x-access-token: <访问码>`；也可通过 `/login?token=<访问码>` 换取 8 小时 HttpOnly 会话 Cookie。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/health` | 健康、模型目录、只读标记 |
| GET | `/api/threads` | 会话列表（支持 ETag / 304） |
| GET | `/api/threads/:id/messages` | 消息流与运行状态 |
| GET | `/api/threads/:id/changes` | 变更长轮询 |
| POST | `/api/send` | 发送 / 排队 / 新建会话（带模型、强度、项目） |
| POST | `/api/interrupt` | 中断当前轮次 |
| POST | `/api/approval` | 审批决策 |
| POST | `/api/queue/{cancel,steer,retry}` | 队列管理 |
| GET | `/api/projects` `/api/plugins` `/api/skills` | 项目 / 插件 / 技能目录 |
| GET | `/api/host/diff` | 宿主工作区 Diff |

详细契约见 [HTTP 后端适配器](docs/HTTP_BACKEND.zh-CN.md)、[状态上报](docs/ADAPTER_STATUS.zh-CN.md) 与 [PI 桥接约定](docs/PI_BRIDGE_CONTRACT.zh-CN.md)。

---

## 开发与验证

```powershell
npm test            # 服务端回归（171+ 断言）
npm run check       # 语法检查
npm run android:build

cd web-ui && npm run build       # 产物写入 public/option-a/
cd mobile-app && npx tsc --noEmit
```

原生 APK 通过「重建 JS bundle + 热替换进已签名包 + 按 ABI 拆分 + 重签」交付：`apksigner verify` V3 与 `zipalign -c -p 4` 均为构建门禁的一部分。完整流程与体积构成见报告第 11、12 章。

---

## 安全与隐私

- 对话、文件、目标与凭据保留在电脑本机；服务端不做云端转发。
- 默认强制访问码；公网入口必须启用 HTTPS 反向代理。
- Android 端访问码使用 Keystore / SecureStore 加密保存。
- 仓库不提交 Codex 数据、访问码、SSH 私钥、本机配置、APK 与运行日志；截图均为脱敏素材或测试数据。
- 本机配置位于 `%LOCALAPPDATA%/CodexPocket/config.json`，不在版本库内。

---

## 兼容性与已知边界

- 验证宿主：Codex Desktop 本地数据后端；PI-Desktop **0.22.0**（`@pi-desktop/desktop`），其桥接通过 `--ipc-socket \\.\pipe\pidesktop-codex-ipc` 接入。
- Codex / PI-Desktop 的本地数据结构与 IPC 属于非公开实现，宿主升级可能导致 `/api/host/diff` 等桥接接口需要重新对齐；核心会话读取与发送不依赖该桥。
- 电脑关机、休眠或断网时手机无法访问；公网可用性取决于本机服务、隧道与 TLS。
- 当前 APK 为 debug 签名，正式分发前应配置独立 release 签名；release/R8 构建受 Windows 长路径限制，交付采用 ABI 拆分达到约 96 MB。
- Web 端仅作兼容保留，不再新增功能。

---

## 来源与许可

服务端最初基于 MIT 许可的 `dreamingboat/codex-lan-companion` 扩展，现已加入原生 App、多电脑管理、消息写入、任务状态、队列、审批、附件、离线演示与 Windows 静默守护等能力。

[MIT License](LICENSE) · [Releases](https://github.com/736368217/Codex-Turnloom/releases) · [带图报告](docs/option-a/REPORT.html)
