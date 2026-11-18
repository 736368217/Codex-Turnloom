# Codex-Turnloom 单线 App 实施合同（2026-11-11，用户确认后生效）

> 本文件覆盖此前规格包与仓库内「双线并行」、RN 基线、Flutter 实验线、旧 WebView 壳的所有冲突描述。
> 所有实施子 agent 必须先读本文件；**唯一决策权在主 agent**，任何与本文件冲突的旧文档以本文件为准。

## 2.1 修订：真实连接、独立 harness 与更新（覆盖下方旧行为）

- 用户最新明确：未连接时第一步必须显示连接页，成功验证机器配对后才能使用工作台、会话和监控。删除“连接可选/离线使用全部功能”的错误口径。无网可冷启动只表示本地界面可显示，不表示远程功能可用。
- 一机一码以 `shared/machine-pairing.cjs` v2 为准：机器 token 调 `/api/harnesses`，发现 Codex/Pi 及各自 token；用户切换的是发现的 harness，不是虚构的 `codex/local/http` 执行引擎。
- 列表、消息、缓存、草稿和异步响应均按机器与 harness 隔离。请求失败不能虚构 running 会话、成功发送或自动同步。
- 扫码必须内置相机预览与二维码解码，覆盖权限拒绝、取消、成功路径；声明 CAMERA 或方法存在不能算功能已实现。
- 恢复 App 更新检查、下载进度/取消/续传、包名/签名/版本/SHA 验证和系统安装确认；版本递增为 **2.1.0 / versionCode 81**，后续发布继续单调递增。更新清单与实际 staged APK 绑定，不读取旧 `android/` 或服务端 package.json 版本冒充 App 版本。
- 默认硬件加速；性能验收必须使用默认渲染路径和真实触摸。底栏缩放、窄屏溢出、键盘遮挡均需测量，不以 CSS 属性存在判定通过。
- 删除正常用户页面中的 ROUTE、Bridge 计数、占位能力说明及无用标语，保持蓝色原始环形 logo 和浅色界面。
- 验收见 `REPAIR_2_1_ACCEPTANCE.md`。先完成修改、冻结产物，再串行设备验收；同一 APK 哈希绑定所有证据。静态通过不等于扫码、网络、harness 或升级安装通过。

## 0. 用户最新指令与路线

- 用户明确：规格包原规划双线，现在**只要 App**；采用 **iOS 浅色毛玻璃风 / Option A / Cupertino Daylight Glass**；**不再是简单网页**。
- 用户点名：**引入 Konsta UI + Vaul 做 App 线**。
- 用户已确认技术底线：`ROUTE=dom-shell`，即 **React + Konsta UI + Vaul 打成可安装 APK，装在原生容器里**。
- 必须诚实标注：这是 **App 化 DOM 容器（含 WebView）**，不是非 WebView RN，也不是纯 Kotlin/Compose。禁止再叫「纯原生 App / 非 WebView 原生」。
- 「不是简单网页」的含义：可安装 APK、启动器图标、无地址栏/刷新/前进后退/footer/hamburger、全屏安全区、离线本地资源、原生相机/触觉/安全存储桥、底部毛玻璃 TabBar、Vaul 手势抽屉、按压反馈、系统返回栈接管、飞行模式仍能冷启动。

## 1. 唯一源码与产物目录

| 角色 | 路径 | 说明 |
|---|---|---|
| 单线 App 前端源码 | `app/` | React + Vite + TypeScript + Tailwind + Konsta UI + Vaul + Lucide + Framer Motion。**唯一维护的 App UI**。 |
| 单线 App 原生容器 | `native-shell/` | 独立 Android Java WebView 容器工程；加载本地 `assets/public/index.html`；不远程加载页面。 |
| 构建产物 | `dist-app/` | 最终 APK、SHA-256、delivery.html、QA 报告。 |
| 合同 | `docs/option-a/SINGLE_APP_CONTRACT.md` | 本文件。 |
| 视觉规范 | `docs/option-a/UI_SPEC.md` | 由 docs agent 写入，token 以第 4 节为准。 |
| 构建脚本 | `scripts/build-single-app.ps1` | 纯 ASCII PowerShell 5.1 可解析；负责 npm ci/build + Gradle + zipalign/sign。 |
| 静态验收 | `scripts/verify-single-app.mjs`、`test/single-app-contract.test.cjs` | 钉住 `ROUTE=dom-shell`、技术栈、无网页感、原生桥、离线资源。 |

冻结/归档，不作为交付线：

- `mobile-app/`：旧 Expo/RN 客户端，保留只读兼容，不再称当前 App。
- `public/`、`web-ui/`（若不存在不得新建）、`public-legacy/`：旧网页/PWA/Track A，不作为交付线。
- `android/`：旧 WebView 兼容壳，保留只读兼容；新容器只用 `native-shell/`。
- `dshgo/`、`dist-dshgo/`、`feature/dshgo-rebase`：Flutter 实验线，不作为交付线。

`server.js`、`backends/http-backend.js` 是共用后端，**继续保留 `/api/*` 契约**，不得为旧 `/threads` 路径改后端。

## 2. 身份、包名、构建

- 应用标签：`Codex-Turnloom`
- applicationId：`com.codex.turnloom.app`
- namespace：`com.codex.turnloom.app`
- versionName：`2.0.0-app`
- versionCode：`80`
- minSdk 26 / targetSdk 35 / compileSdk 35
- ABI：universal 或至少 arm64-v8a + x86_64
- 启动 Activity：`com.codex.turnloom.app.MainActivity`
- 本地入口：`file:///android_asset/public/index.html`
- 禁止 `server.url` / dev server / 远程 `index.html` / CDN 字体或脚本
- 签名：debug keystore 可用于本轮验收；v2/v3 verify 必须通过；发布签名缺口如实记录

## 3. 真实 API 契约

只使用当前后端 `/api/*`，禁止旧 `/threads` 五元组字面量。

必须封装：

- `GET /api/health`
- `POST /api/auth/session`
- `GET /api/threads`
- `GET /api/threads/:id/messages?limit&before`
- `GET /api/threads/:id/changes`
- `POST /api/new-thread`
- `POST /api/send`
- `POST /api/interrupt`
- `POST /api/approval`
- `GET /api/host/diff`
- `GET /api/projects`
- `GET /api/account`
- `POST/GET /api/queue/*`（至少类型定义占位）

鉴权：`x-access-token` 请求头；401 走重新输入访问码抽屉；不得把 token 写日志。
Server URL / token / machineName / 离线缓存由原生安全存储桥或加密 SharedPreferences 保存。

## 4. Option A 视觉 token（唯一真源）

| Token | 值 |
|---|---|
| canvas | `#F2F2F7` |
| surface | `#FFFFFF` |
| fill secondary | `#EFEFF4` |
| separator | `#E5E5EA` |
| label primary | `#1C1C1E` |
| label secondary | `#636366`（小字号正文达到 4.5:1，对比度复审修订） |
| blue | `#007AFF` |
| green | `#34C759` |
| red | `#FF3B30` |
| action blue / green / red | `#0062CC` / `#1F7A35` / `#B4231B`（白字按钮及小号状态文字，至少 4.5:1） |
| diff add bg/fg | `#E8F8EE` / `#1E7E34` |
| diff del bg/fg | `#FDECEC` / `#C82333` |
| sheet handle | `#C7C7CC`，36×6px |
| glass nav | `rgba(255,255,255,.82)` + `blur(20px) saturate(180%)` |
| glass thumb | `rgba(255,255,255,.85)` + `blur(24px) saturate(180%)` |
| glass sheet | `rgba(255,255,255,.95)` + `blur(40px) saturate(180%)` |
| card radius | 16px |
| sheet radius | 24px 仅上两角 |
| card shadow | `0 1px 3px rgba(0,0,0,.04)` |
| press | `scale(.98) opacity(.8) 150ms` |

全局硬锁浅色，禁止 dark mode、黑底、桌面栅格、网页居中 `max-w-[430px] mx-auto shadow-2xl` 壳。

## 5. 单线 App IA

- 4 个底部 Tab：`Home / Threads / Monitors / Settings`
- 中文可显示：`首页 / 会话 / 监控 / 设置`；激活色 `#007AFF`
- 聊天详情是全屏二级页，TabBar 隐藏，只保留 ThumbGlassBar
- 全局单例 `CupertinoSheetHost`，所有二级交互 100% 用 Vaul 底部抽屉，禁止居中 Modal
- Home：大标题 + 机器状态卡 + 引擎 Segmented + 扫码配对入口 + 活跃任务
- Threads：全部会话、搜索、状态胶囊、新建任务
- Monitors：运行态摘要、计时、错误、全局 Interrupt 入口
- Settings：连接、重配对、离线缓存、诊断，浅色锁
- ThreadDetail：消息流、AI Thinking / Terminal Log 折叠卡、浅色 Diff、ThumbGlassBar、Interrupt
- 审批抽屉：Vaul `shouldScaleBackground`，拖拽条，绿色 `Approve & Apply` / 灰色 `Reject`

## 6. 原生容器 JS Bridge

Android `MainActivity` 必须注入 `window.TurnloomNative`：

```text
secureGet(key): String|null
secureSet(key, value): boolean
secureRemove(key): boolean
haptic(kind): void                    // selection | success | warning | error
scanQr(requestId): void               // 原生 ZXing/MLKit 扫码，结果回调
getAppInfo(): String                  // JSON: label/version/route
setLightBars(): void
```

扫码结果由 Java 调：

```text
window.__turnloomNativeQrResult(requestId, value)   // value 为原始 QR 字符串或空
```

返回键由 Java 调：

```text
window.__turnloomBack() -> boolean
```

返回 `true` 表示 JS 已关闭抽屉/返回二级页；`false` 时 Java 执行 `moveTaskToBack(true)`。禁止 `WebView.goBack()`。

WebView 必须：

- 加载本地 `file:///android_asset/public/index.html`
- `setSupportZoom(false)` / `setBuiltInZoomControls(false)` / `setDisplayZoomControls(false)`
- `setOverScrollMode(View.OVER_SCROLL_NEVER)`
- `setLongClickable(false)`，并抑制非正文 ActionMode
- `setMixedContentMode(NEVER_ALLOW)`
- `setAllowUniversalAccessFromFileURLs(false)`
- release 关闭 `WebContentsDebuggingEnabled`
- 无地址栏 EditText、无刷新按钮、无外部浏览器跳转
- 权限：INTERNET / CAMERA / VIBRATE；usesCleartextTraffic 仅用 network_security_config 对 LAN 放通

## 7. Anti-Web / App 化硬判据

必须全部满足：

1. APK 可 `adb install`，启动器名称 `Codex-Turnloom`，无浏览器 chrome。
2. APK 内存在 `assets/public/index.html` + 本地 JS/CSS；无远程 `server.url`。
3. UI XML 冷启动 / 抽屉 / 离线 / 返回后均无地址栏、刷新、前进后退、footer、hamburger、面包屑。
4. 飞行模式冷启动能显示缓存会话或 OFFLINE 状态，不出现浏览器错误页。
5. Vaul 抽屉：顶部 36×6 拖拽条，背景缩放/压暗，真实指针可拖动或点击命中。
6. 所有可点元素按压反馈 + ≥44px 热区；非正文禁止文本选择。
7. 原生相机 QR、触觉、安全存储桥均在 Java / JS 两侧有静态证据；不得用 `getUserMedia` / `localStorage` 冒充原生能力。
8. `scripts/verify-single-app.mjs` 与 `test/single-app-contract.test.cjs` 通过。
9. MuMu phone 实机截图 + UI XML：4 Tab、状态卡、抽屉、详情 ThumbBar、浅色无黑底。
10. 文档与交付页必须写 `ROUTE=dom-shell` / `App 化 DOM 容器（含 WebView）`，禁止再写「纯原生 / 非 WebView 原生」。

## 8. 过时项裁决

- 双线并行：废弃，只保留一条 App 线。
- Track B Expo/RN 作为主线：废弃，`mobile-app/` 冻结。
- Track A 的 `web-ui/ -> public/` PWA/WebView 直连：废弃；改为 `app/ -> native-shell/assets/public`。
- 旧 API 路径 `/threads...`：废弃，统一 `/api/*`。
- `max-w-[430px] mx-auto shadow-2xl` 桌面预览壳：废弃，真机全屏 + 安全区。
- 规格包 `01` 预览中/右 Option B/C：只取左栏 Option A；`02` 三屏为验收基线。
- 规格色板与现网 `mobile-app/src/constants/optionA.ts` 的加深色冲突：以本文件第 4 节为唯一真源。
- 旧 `AGENTS.md` 中「WebView 壳明确淘汰 / 必须纯 Kotlin」等表述：被用户本次「接受原生容器 App」决策覆盖，docs agent 必须改写为「简单网页/远程 PWA 淘汰，`ROUTE=dom-shell` App 化容器为唯一交付线」。

## 9. 子 agent 文件边界

- frontend-core：只写 `app/` 下根目录配置、`index.html`、`src/main.tsx`、`src/AppRoot.tsx`、`src/theme/*`、`src/lib/*`、`src/state/*`。
- ui-components：只写 `app/src/components/*`、`app/src/screens/*`。
- native-shell：只写 `native-shell/**`；可复制 `android/gradlew*` 与必要 wrapper，不改 `android/`。
- docs-tests：只写 `docs/option-a/*`、`test/single-app-contract.test.cjs`、更新 `AGENTS.md` 与 `README.md` 中路线术语；不改 `app/`、`native-shell/`、`package.json`。
- build-qa：只写 `scripts/build-single-app.ps1`、`scripts/verify-single-app.mjs`、`scripts/qa/*`；不改源码与根配置。
- 主 agent：统一修改 `package.json` 增加脚本、合并冲突、跑构建/实机/最终交付。

任何 agent 不得启动可见 Windows 控制台、不得写登录自启任务、不得在 git worktree 里 `npm install`。npm 依赖只允许安装在会话 scratch 的单一构建树。

## 10. Windows 无黑框启动

后台服务必须使用无窗口启动链，例如 `wscript.exe` 调用 `WScript.Shell.Run(command, 0, False)`。
控制台退出只清理自己创建的进程，不得停止守护程序托管的服务或隧道。
本合同是可随 Git 检出的项目规范；机器路径、凭据和临时验收记录留在忽略的本机文件中。
