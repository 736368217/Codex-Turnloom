> ## 当前唯一交付线：`ROUTE=dom-shell`
>
> **App 化 DOM 容器（含 WebView）** = `app/`（React + Vite + TypeScript + Tailwind + **Konsta UI** +
> **Vaul** + Lucide + Framer Motion）→ `native-shell/` 独立 Android Java WebView 容器 →
> 可安装 APK（`com.codex.turnloom.app`，加载本地 `file:///android_asset/public/index.html`）。
> 唯一真源：[docs/option-a/SINGLE_APP_CONTRACT.md](docs/option-a/SINGLE_APP_CONTRACT.md)；
> 视觉规范 [UI_SPEC.md](docs/option-a/UI_SPEC.md)、架构 / 桥 / 交付
> [ARCHITECTURE.md](docs/option-a/ARCHITECTURE.md) / [BRIDGE.md](docs/option-a/BRIDGE.md) / [DELIVERY.md](docs/option-a/DELIVERY.md)。
>
> 诚实术语：App 化 DOM 容器（含 WebView）**≠ 纯原生**（纯 Kotlin/Compose）**≠ 非 WebView RN**
> **≠ 简单网页 / 远程 PWA**。可安装 APK、启动器图标、无浏览器 chrome、离线本地资源、
> 原生相机 / 触觉 / 安全存储桥、毛玻璃 TabBar、Vaul 手势抽屉、系统返回栈接管。
>
> **冻结 / 归档（不作为交付线）**：`mobile-app/`（旧 Expo/RN）、`public/`（远程 PWA）、`web-ui/`、
> `android/`（旧 WebView 壳）、`dshgo/`、`dist-dshgo/`、`dist-native/`、`feature/dshgo-rebase`。
> 旧 [Track A](docs/option-a/Track_A_Web_App_Upgrade_Spec.md) / [Track B](docs/option-a/Track_B_Native_Mobile_App_Spec.md)
> 双线规划已归档；共用后端 `server.js` / `backends/http-backend.js` 继续保留 `/api/*` 契约。
>
> 一机一码配对协议、后端 `/api/*` 契约、Windows 托盘控制台、Windows 无黑框 / 无可见控制台硬规则
> 均继续有效（见 [docs/PROTOCOL.zh-CN.md](docs/PROTOCOL.zh-CN.md) 与 AGENTS.md）。

# Codex-Turnloom

<p align="center">
  <img src="docs/assets/hero.png" alt="Codex-Turnloom：把电脑上的 Codex 会话带到手机端" width="900" />
</p>

<p align="center">
  <strong>自托管、本地优先的 Codex 手机工作台</strong><br />
  在电脑上运行服务，手机用 **ROUTE=dom-shell App 化 DOM 容器（含 WebView）** 查看会话、继续对话、处理审批（可安装 APK，非简单网页）。
</p>

<p align="center">
  <a href="https://github.com/736368217/Codex-Turnloom/actions/workflows/ci.yml"><img alt="Verify" src="https://img.shields.io/github/actions/workflow/status/736368217/Codex-Turnloom/ci.yml?branch=main&label=verify&style=for-the-badge" /></a>
  <a href="https://github.com/736368217/Codex-Turnloom/releases/latest"><img alt="下载 Android APK" src="https://img.shields.io/badge/下载-Android%20APK-0065D1?style=for-the-badge" /></a>
  <a href="LICENSE"><img alt="MIT 许可" src="https://img.shields.io/badge/许可-MIT-16713A?style=for-the-badge" /></a>
</p>

---

## 它解决什么问题

Codex Desktop 的会话、项目目录和运行记录都在电脑上。Codex-Turnloom 在 **电脑本机** 启动一个受访问码保护的 HTTP 服务，手机通过局域网连接该服务，查看、发送、审批等操作由电脑端代理完成；项目不提供云端账号或托管存储。

当前唯一交付线是 `app/ + native-shell/` 的 **ROUTE=dom-shell App 化 DOM 容器（含 WebView）**（React + Konsta UI + Vaul → Android Java WebView 容器 → 可安装 APK）。`public/`（服务内置网页 / 远程 PWA）、`android/`（旧 Android WebView 兼容壳）、`mobile-app/`（旧 Expo/RN）、`web-ui/`、`dshgo/`、`dist-dshgo/`、`dist-native/` 均标注**冻结 / 归档**，保留只读兼容但不作为交付线。`desktop/` 是 Windows 托盘控制台，`server.js` / `backends/http-backend.js` 继续提供 `/api/*` 契约。

> **安全边界**：项目按可信局域网设计。不要把服务直接暴露到公网；需要远程访问时，请自行放在有访问控制与 TLS 的私有网络后。详见 [SECURITY.md](SECURITY.md)。

## 真实界面

下列截图来自**冻结归档的旧 Expo / React Native 客户端**（`mobile-app/`，非 WebView、非纯原生），仅作历史功能说明；**不代表当前 `ROUTE=dom-shell` 交付线的界面**。当前单线 App 的浅色 Option A 视觉以 [UI_SPEC.md](docs/option-a/UI_SPEC.md) 为准。截图使用隔离的文档数据，不含真实访问码、二维码、账户或私人会话内容。

| 会话工作台 | 对话与审批 |
|:---:|:---:|
| <img src="docs/screenshots/app-home.png" width="280" alt="会话列表：搜索、状态筛选与项目分组" /> | <img src="docs/screenshots/app-thread.png" width="280" alt="对话详情：消息流、模型摘要、排队消息与输入舱" /> |
| 搜索、状态筛选、项目归属、运行状态一目了然 | 实时消息、运行状态、代码改动、排队发送、复制与停止 |
| **长审批固定操作区** | **模型与思考强度** |
| <img src="docs/screenshots/app-approval.png" width="280" alt="长审批滚动到文件列表末尾，批准与拒绝按钮仍固定在底部" /> | <img src="docs/screenshots/app-model.png" width="280" alt="模型与思考强度选择面板" /> |
| 20 项文件列表滚动到底后，「批准并应用 / 拒绝」仍可见 | 按会话选择模型与推理强度，并记住偏好 |
| **插件 / 技能引用** | **连接管理** |
| <img src="docs/screenshots/app-mentions.png" width="280" alt="插件接口失败时，技能列表仍可正常选择" /> | <img src="docs/screenshots/app-terminals.png" width="280" alt="终端管理：当前连接、测试连接、编辑与解除配对" /> |
| 插件接口异常不会掩盖技能列表，引用随消息发送 | 保存多台电脑、测试连接、编辑或解除配对 |
| **扫码 / 手动配对** | **真实数据说明** |
| <img src="docs/screenshots/app-pairing.png" width="280" alt="扫码配对抽屉与手动输入表单" /> | 截图由隔离文档 fixture 驱动：配对抽屉优先扫码，手动输入可展开；服务地址、访问码与会话内容均为演示数据，图中不展示真实二维码或密钥。 |

## 主要能力

- **会话管理**：列表、搜索、状态筛选、项目分组、逐会话草稿与缓存隔离。
- **消息流**：历史消息、长轮询更新、排队 / 插队 / 取消、发送失败重试、中断当前任务。
- **审批**：真实服务审批数据驱动；长文件列表可滚动，批准 / 拒绝按钮固定可见。
- **模型配置**：从服务健康接口读取模型目录，逐会话保存模型与思考强度。
- **引用能力**：插件和技能分别读取；一侧接口失败不会清空另一侧列表。
- **附件与复制**：图片/文件选择、消息复制、引用标签；可选原生模块缺失时安全降级。
- **连接与安全**：二维码或手动配对、多电脑隔离、访问码鉴权、401 恢复、只读模式、登录失败限流。
- **客户端**：当前唯一交付线为 `ROUTE=dom-shell` **App 化 DOM 容器（含 WebView）**（React + Konsta UI + Vaul → Android WebView 容器 APK）。旧 Expo / React Native 客户端（`mobile-app/`）、远程 PWA（`public/`）、旧 WebView 壳（`android/`）、Flutter 实验线（`dshgo/` / `dist-dshgo/` / `dist-native/`）均已**冻结 / 归档**；纯 Kotlin/Compose 原生 App 本轮未采用，不得把当前容器假称纯原生。服务端保留兼容网页入口（归档）与 Windows 托盘控制台。

## 快速开始

### 1. 环境要求

- **Node.js 22.5+**（与根目录 `package.json` 的 `engines.node`、CI 的 Node 22.23.4 对齐）
- Windows / macOS / Linux 上可运行 Codex Desktop 的电脑
- Android 手机或模拟器，与电脑处于可达网络

### 2. 在电脑上启动服务

```bash
git clone https://github.com/736368217/Codex-Turnloom.git
cd Codex-Turnloom
npm ci
node server.js --host 0.0.0.0 --port 8787 --password "<自定义强访问码>"
```

健康检查：

```bash
curl http://127.0.0.1:8787/api/health
```

返回 JSON 中 `ok: true` 即表示服务已就绪。不要复用示例访问码；未指定 `--password` 时服务会生成临时访问码，并在交互式终端或控制台显示。

Windows 用户可用安装脚本注册后台服务并打印配对二维码：

```powershell
.\scripts\install-windows.ps1 -MachineName "<电脑名称>" -Password "<自定义强访问码>"
npm run device:qr
```

### 3. 安装 Android App

从 [Releases](https://github.com/736368217/Codex-Turnloom/releases/latest) 下载对应 APK 安装。当前唯一交付线的构建入口是 `scripts/build-single-app.ps1`（`app/` 的 npm ci/build + `native-shell/` Gradle + zipalign/sign），产物在 `dist-app/`；静态验收 `scripts/verify-single-app.mjs` 与 `node --test test/single-app-contract.test.cjs`。仓库 CI 的 `android/gradlew testDebugUnitTest assembleDebug` 属于**冻结归档的旧 WebView 兼容壳**检查，不是本轮 App 交付线。

> 发布包与从源码完整构建 APK 的说明，以 `docs/option-a/DELIVERY.md` 和 `scripts/build-single-app.ps1` 为准；完整构建依赖本机 Android SDK。旧 `mobile-app/` Expo 原生依赖说明已归档，不再是当前交付线依据。

### 4. 连接手机

首次打开 App →「连接电脑」→ 扫码，或点「输入地址和访问码」：

| 字段 | 示例 |
|---|---|
| 服务地址 | `http://<电脑局域网 IP>:8787` |
| 访问码 | 启动服务时设置的 `--password` |

保存并测试连接后，回到「对话」即可看到电脑上的会话。也可以直接扫描服务生成的配对二维码。

## 项目结构

```text
server.js              本机服务：/api/* API、鉴权、会话读写、队列、审批、只读模式（继续有效）
app/                   唯一 App UI 源码：React + Vite + Konsta UI + Vaul（ROUTE=dom-shell）
native-shell/          独立 Android Java WebView 容器（加载本地 assets/public/index.html）
dist-app/              最终产物：APK + SHA-256 + delivery.html + QA 报告
docs/option-a/         单线合同 / UI_SPEC / ARCHITECTURE / BRIDGE / DELIVERY（唯一真源）
scripts/               build-single-app.ps1 / verify-single-app.mjs / 安装·守护·二维码·CI 校验
test/                  Node 回归测试（含 single-app-contract.test.cjs）
desktop/               Windows 托盘控制台（继续有效）
backends/              HTTP 后端适配器（/api/* 契约，继续有效）
public/                服务内置网页 / 远程 PWA（冻结归档，非交付线）
mobile-app/            旧 Expo / RN 客户端（冻结归档，非交付线）
android/               旧 Android WebView 兼容壳（冻结归档，非交付线）
dist-native/ dist-dshgo/  旧 RN / Flutter 交付页与包（冻结归档，非交付线）
```

## 开发与验证

根目录常用命令：

```bash
npm test
npm run check
npm run desktop:check
npm run verify:ci
```

`npm run verify:ci` 会额外用 CI 对应的 Node 22 运行测试，并检查测试汇总中的 `fail` / `cancelled` 是否为 0。

`app/` 常用命令（当前唯一交付线）：

```bash
cd app
npm ci
npm run typecheck
npm run build
node --test ../test/single-app-contract.test.cjs
```

旧 `mobile-app/`（Expo / RN）命令已归档，不再作为交付线验证依据。

GitHub Actions 的 `Verify` 工作流覆盖：

- Windows + Node 22.23.4：完整 Node 测试、语法检查、桌面端语法检查、PowerShell 脚本解析。
- Ubuntu + Java 17 + Android SDK：`android/gradlew testDebugUnitTest assembleDebug`（**冻结归档的旧 WebView 壳 CI 检查，非本轮 App 交付线**；当前交付线构建见 `scripts/build-single-app.ps1`）。

接口契约与 HTTP 后端模式见：

- [HTTP 后端适配器](docs/HTTP_BACKEND.zh-CN.md)
- [状态适配说明](docs/ADAPTER_STATUS.zh-CN.md)
- [安全说明](SECURITY.md)

## 安全约定

- 默认只面向可信局域网；不要直接公网暴露服务。
- 始终启用访问码；不要在 README、Issue、截图或日志中公开访问码与二维码。
- 只读浏览场景可使用 `node server.js --readonly`。
- 服务能读取本机 Codex 会话、项目路径与用量信息；任何能访问服务并通过鉴权的客户端都能看到这些内容。
- 项目依赖 Codex Desktop 的本地文件与私有 IPC 行为，上游版本变化可能影响兼容性。

## 许可

[MIT](LICENSE)。项目最初基于 MIT 许可的 `dreamingboat/codex-lan-companion` 思路扩展。
