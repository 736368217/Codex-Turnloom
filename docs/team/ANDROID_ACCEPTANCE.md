# Android 单线 App 验收记录（ROUTE=dom-shell）

本轮目标：把这台机器上的 APK 构建跑成可复现命令 + 模拟器真实验收，并给出每项的结论与证据。
所有截图在 `docs/qa/android/`，文件名与下文编号对应。

## 1. 工具链（本机实测值，全部自动探测，无硬编码路径）

| 项 | 值 | 来源 |
|---|---|---|
| Node / npm | v24.22.3 / 11.19.1 | `node -v` |
| JDK | 21.0.12.1 Temurin `C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot` | `java -version` |
| Android SDK | `C:\Users\Administrator\tools\android-sdk` | 目录探测 |
| build-tools | **35.0.0**（本轮由 `sdkmanager` 安装；原有 33.0.2 / 34.0.0） | `Find-BuildToolsDir` 选最高可用版本 |
| platforms | android-33、34、**35**（本轮安装，`compileSdk=35` 需要） | `sdkmanager --install "platforms;android-35"` |
| adb | `C:\Users\Administrator\tools\platform-tools\adb.exe` | — |
| Gradle | 8.10.2（wrapper） | `native-shell/gradle/wrapper/gradle-wrapper.properties` |
| AVD | `paopao_api33`（x86_64 / API 33 / google_apis） | `emulator -list-avds` |
| 视图尺寸 | `wm size 780x1688` + `wm density 320` ⇒ **CSS 390×844 @2x** | `screenshot 780×1688` |

首次构建的两个环境前提（如实记录，不是“应该没事”）：

1. Gradle wrapper 需要 `gradle-8.10.2-bin.zip`，直连 60s 超时；本轮用 `curl -x http://127.0.0.1:7897` 下载 130.3 MB 后手工装入 `~\.gradle\wrapper\dists\gradle-8.10.2-bin\<hash>\`（含 `.ok` 标记）。之后再跑不再需要网络。
2. AGP 8.7.3 与 androidx/zxing 依赖走 `-HttpProxy`（脚本新参数）转发的代理解析成功。

## 2. 构建脚本改动（`scripts/build-single-app.ps1`）

原脚本写死另一台机器，在这台机器上一步都跑不动；改动：

| 问题 | 修法 |
|---|---|
| `-RepoRoot 'D:\pi11\11\Codex-Turnloom'`、`$Gradlew` 同路径 | 默认 `Split-Path -Parent $PSScriptRoot` |
| `-ZipAlign/-ApkSigner/-Aapt2/-Adb` 指向 `C:\Users\WIN10\...\build-tools\35.0.0` | 新增 `Find-BuildToolsDir`：取 SDK 下**最高**且同时具备 zipalign/apksigner/aapt2 的版本；adb 取 `platform-tools\adb.exe` |
| `-AndroidHome/-JavaHome/-GradleUserHome` 写死 | 依次取参数 → 环境变量 → 常见安装位置 → `java.exe` 反推；`GRADLE_USER_HOME` 缺省回 `%USERPROFILE%\.gradle` |
| `PI_SCRATCH_DIR` 未设置即 `Fail` | 缺省回 `<repo>\.scratch`；仍拒绝 junction/symlink 根、仍做包含性校验 |
| scratch 树要求预装 `node_modules` | 缺时从工作树 `app/node_modules` 复制（不联网 `npm install`），再退化为 scratch 内 `npm ci` |
| 只有 release 一条路，必须先有 keystore + 两个口令 | 新增 `-BuildType debug`：`assembleDebug`，AGP 用 debug key 签名，不需要口令；release 路径与 zipalign/apksigner/sidecar 完全保留 |
| 产物名固定 `-app.apk` | release 仍是 `Codex-Turnloom-<versionName>-app.apk`（逐字不变），debug 另加 `-app-debug.apk`，互不覆盖 |
| 输出已存在直接拒绝 | 新增 `-Force`；不带仍拒绝 |
| 下载无代理支持 | 新增 `-HttpProxy` / `TURNLOOM_BUILD_PROXY`，同时注入 `GRADLE_OPTS` 与 launcher `-D` |

配套测试同步更新：`test/single-app-build-contract.test.cjs`（仅改两处语义真变了的断言：scratch 根回落、命名新增 debug 分支；其余字面量原样保留）。`node --test test/single-app-build-contract.test.cjs` = **9 pass / 0 fail**。

## 3. 可复现命令

```powershell
# 1) 前端门禁
npm run app:typecheck
npm run app:build

# 2) 出可安装 APK（无需 release keystore）
$env:TURNLOOM_BUILD_PROXY='http://127.0.0.1:7897'   # 只有在需要联网解析 Gradle/AGP 时
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-single-app.ps1 -BuildType debug

# 3) 静态门禁（含 APK ZIP 断言：assets/public/index.html 存在、无 libflutter.so）
npm run app:verify
```

实测输出：`npm run app:verify` = **18/18 PASS**；脚本 exit 0；8 个步骤全部 `ok`。

## 4. 产出的 APK（每个哈希绑定它自己的证据）

| APK | 大小 | SHA-256 | 用途 |
|---|---|---|---|
| `dist-app\Codex-Turnloom-2.1.7-app-debug.apk` | 2,224,713 B | `9e9d4d940febb9fdfbdc61ef1cfe6c6a621178120557e9b947c5c8a2aa513a1f` | 本文 **01–29 号截图**全部来自这个包（当时工作树只有我的脚本改动） |
| 同上（再次构建） | 2,224,713 B | 同上一行 | 两次独立构建**字节完全相同**，证明脚本可复现 |
| 同上（集成包） | 2,226,413 B | `2b7b98e69520e459bdec43a689194f43f6546f4add8153a388017f351da7b04c` | **35 号**：并入 @Vera/@Iris 未提交改动后的冒烟，Home 正常、机器名不再重复 |

签名：v2/v3，`apksigner verify --print-certs` 通过；`aapt2 dump badging` = `com.codex.turnloom.app` / `2.1.7` / `88`，与 `native-shell/app/build.gradle.kts` 一致。

## 5. 验收逐项结论

| # | 项目 | 结论 | 证据 |
|---|---|---|---|
| 1 | 冷启动不闪连接页、无崩溃 | **通过**（见风险 R1：WebView 首帧前有 1.5–6.6s 空白画布） | `01-coldstart.png`（首启到连接页）、`24/25/26`、`30–34`、`burst-*`；`logcat` 无 `FATAL/AndroidRuntime` 异常，`Displayed +1.1~2.0s` |
| 2 | 配对页手动输入 + 校验 | **通过** | `02`–`08`：展开手动表单 → 输入 `http://10.0.2.2:8801` + 访问码 → 失败文案 → 成功进入工作台 |
| 3 | WebView 加载本地 `file:///android_asset/public/index.html` | **通过** | APK ZIP 断言（`npm run app:verify`）；`MainActivity.shouldOverrideUrlLoading` 拒绝一切非打包页；`shouldInterceptRequest` 拦截全部 http(s) 子资源 |
| 4 | 连接本机 Turnloom：列表 / 会话 | **通过** | `10`（按项目 49/49）、`11`（按时间，真实 Codex 会话摘要）、`12`（会话详情：工具卡、折叠、composer） |
| 5 | 键盘不遮挡输入框 | **通过** | `03`（连接页聚焦，表单整体上移，按钮在键盘上方）、`05`、`13`（会话输入舱完整可见，发送键可用）、`18` |
| 6 | 系统返回不退出应用 | **通过** | 详情页返回 → 会话列表 `15`；抽屉打开时返回 → 关闭抽屉 `21`；键盘弹出时先收键盘 `14`；`topResumedActivity` 始终是 `MainActivity` |
| 7 | 抽屉（Vaul）可打开/关闭 | **通过** | `20`（切换服务抽屉，可见 36×6 拖拽条、背景缩放压暗）、`21` |
| 8 | 发送链路与错误语义 | **部分通过** | `19`：`--readonly` 服务端 → `403` → 文案「电脑端当前不允许写入…草稿和附件已保留」且草稿未丢。**真实成功发送未做**（见风险 R2） |
| 9 | 断线 / 恢复 | **通过** | 杀掉服务端后 `离线：显示上次缓存的内容` + 重试 `22`；恢复服务端后点重试 → `在线`、同步时间刷新 `23` |
| 10 | 401 语义 | **不通过**（缺陷 D2，非本线文件） | 服务端 09:05:30 记录 `GET /api/health 401`、`GET /api/harnesses 401`；App 显示 `离线` 徽标与 `离线：显示上次缓存的内容` `20/22` — 违反「服务端已应答的 4xx 不得显示为离线」 |
| 11 | 文件选择器 / 相机扫码 | **未验证** | 本轮未跑，不写成通过 |

## 6. 发现的缺陷（跨范围，交 owner）

- **D1（P1，`server.js` → @Atlas）**：用 `--machine-token` 与 `--token` 取不同值时，`GET /api/harnesses` 会把**机器令牌**当成 harness 令牌返回（`server.js:8284`：`token: isHarnessToken ? ACCESS_TOKEN : profile?.token || requestedToken`），而 `/api/health` 只认 `ACCESS_TOKEN` ⇒ 发现成功、随后 401，App 报「机器访问码不正确或已更换」（误导，令牌其实是对的）。复现：`--token A --machine-token B`，用 B 请求 `/api/harnesses` 得 200 且返回 `"token":"B"`，再用 B 请求 `/api/health` 得 401。本轮验收改用单令牌（`--token qa-machine-7b31`）绕过。
- **D2（P1，`app/src/state` + `AppShell.tsx` → @Vera）**：401 被渲染成「离线」。`AppShell.tsx:66` 用 `session.status !== 'ready'` 决定离线横幅，而 `sessionStore.ts:161` 的 `setConnectionError()` 对任何失败都写 `online:false`。结果是：服务端明确回了 401，用户看到「离线 / 显示上次缓存」，点「重试」只会重复同一个 401；唯一出路是去设置页「忘记这台电脑」再重新配对。建议 401 走「重新配对」入口而不是离线横幅。
- **D3（P3，`ThreadsScreen`）**：从会话详情返回列表后，分段控件从「按时间」重置回「按项目」，搜索词也丢失。
- **D4（P2，`native-shell` → 我）**：冷启动在系统 splash 退出与 WebView 首帧之间有 1.5–6.6s 的空白画布（`burst-3..5` 与 `25` 是同一帧）。我实现过「首帧前显示品牌封面」（`buildPageCover()` + `WebViewClient.onPageCommitVisible` + 12s 兜底）并连打三版，但**在模拟器上封面始终没有显示出来**（`burst-3/4/5` 全是纯画布，13,449 B 逐字节相同），无法证明有效，已 `git checkout` 回滚，不把未验证的原生改动留在树上。下一轮建议先在真机确认 `onPageCommitVisible` 是否触发再决定实现方式。
- **D5（P3，`ConnectScreen`）**：重新输入访问码时，上一次的红色错误卡仍然留在按钮下方（`07` 底部可见粉色条）。

## 7. 剩余风险

- **R1**：冷启动空白窗口（D4）。本机为软件渲染（`hw.gpu.enabled=no`），真机大概率短很多，但未实测。
- **R2**：**未做真实成功发送**。当前 Turnloom 服务指向用户真实 `~/.codex`，一条成功发送会在用户真实会话里开一轮 turn；我选择只验 `403` 错误路径 + 草稿保留，把成功路径留给有隔离 `CODEX_HOME` 的环境。同理审批成功路径也没有真机证据。
- **R3**：`adb shell input` 驱动、无真机触摸，未覆盖单手/拇指热区实测；触控目标尺寸由 @Vera 的 DOM 度量负责，我只验了「按得到」。
- **R4**：模拟器为 x86_64 API 33，`targetSdk=35` 的 edge-to-edge 行为未在 API 35 镜像上复核。
- **R5**：集成包（`2b7b98e6…`）只做了冷启动冒烟，未重跑 01–29 的完整流程；完整验收绑定的是 `9e9d4d94…`。

## 8. 复现验收的最小步骤

```powershell
$adb='C:\Users\Administrator\tools\platform-tools\adb.exe'
& $adb -s emulator-5554 shell wm size 780x1688
& $adb -s emulator-5554 shell wm density 320
& $adb -s emulator-5554 install -r -t dist-app\Codex-Turnloom-2.1.7-app-debug.apk
& $adb -s emulator-5554 shell am start -n com.codex.turnloom.app/.MainActivity
# 服务端（QA 实例，避开队友占用的 8799）
node server.js --port 8801 --host 0.0.0.0 --token <token>
```
