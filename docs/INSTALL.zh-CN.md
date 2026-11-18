# Codex-Turnloom 三端安装总览（规范化交付）

> 本文描述正式交付形态：**Windows 安装包 + 无窗口守护**、**手机原生 App**、**可选的服务端**。
> 所有命令中的 token、域名均为占位符（`REPLACE_WITH_*` / `*.example.com`），不含真实访问码、
> 真实公钥 IP 或密钥。协议细节见 `docs/PROTOCOL.zh-CN.md`。

前置条件：Node.js >= 22.5（`package.json` 的 `engines`）、`npm ci` 安装依赖；
手机与电脑在同一局域网时**不需要**额外服务端。

---

## 一、Windows（安装包 + 服务）

### 1. 构建安装包

```powershell
npm ci
npm run desktop:build
```

`package.json` 的 `build.win.target=nsis`，`buildResources=desktop/assets`，
图标 `desktop/assets/app.ico`，`artifactName=Codex-Turnloom-Console-${version}-${arch}.${ext}`。
产物落在 `build.directories.output`，即：

```
dist-desktop\Codex-Turnloom-Console-<version>-<arch>.exe
```

NSIS 为**当前用户**安装（`perMachine=false`、`oneClick=false`、可改安装目录），
创建桌面/开始菜单快捷方式，快捷方式名 `Codex-Turnloom 控制台`。

### 2. 安装与首次设置

1. 运行上面的 NSIS 安装包，启动托盘控制台（Electron，源码 `desktop/main.cjs` +
   `desktop/service/*`）。
2. 首次启动进入设置向导：生成机器访问码（`machineToken`）并展示**唯一一张机器二维码**。
   二维码 payload 由 `shared/machine-pairing.cjs` 的 `machinePairingPayload` 生成，
   含 `v=2&protocol=codex-turnloom&machine=<显示名>&mid=<机器标识>&url=<根地址>&token=<机器访问码>&discover=/api/harnesses`。
   当前 App 仅接受该 v2 机器配对码；旧 `codexpocket://add` 配对码需在电脑端更新后重新生成。
3. 手机端扫这一次码即可发现该机全部 harness，无需为每个后端各扫一次。

### 3. 开机自启 / 服务守护如何工作

| 组成 | 现有实现 | 作用 |
| :--- | :--- | :--- |
| 托盘控制台登录自启 | `scripts/install-console.ps1` + `scripts/console-launcher.vbs`（任务 `Codex-Turnloom Console`） | `wscript.exe //B //Nologo` → VBS 隐藏启动 Electron 托盘。 |
| 无窗口服务守护 | `scripts/windows-supervisor.ps1` + `scripts/windows-supervisor-launcher.vbs` | 按配置拉起/监管主服务，隐藏窗口运行。 |
| 链路看门狗 | `scripts/link-watchdog.mjs` + `scripts/link-watchdog-launcher.vbs`（任务 `Codex-Turnloom Link Watchdog`） | 带鉴权的真实 HTTP 健康探测，挂掉的后端/分发器自动重启，日志写 `watchdog.log`。 |
| v2 机器网关（新） | `installer/install-machine-service.ps1` → 登录任务 `Codex-Turnloom Machine Gateway` | 单端口对外、按 harness token 代理并守护各后端；与托盘控制台并存。 |

无窗口启动链条固定为
`任务计划程序 → wscript.exe //B //Nologo → *.vbs → WScript.Shell.Run(cmd, 0, False)`：
直接把 `node.exe` 作为任务动作即便勾了 Hidden 也仍会创建可见控制台/conhost。

控制台会先请求 `/api/health`，健康则「接管」已由守护拉起的服务（`external:true`），
不再重复 spawn 一套；「停止 / 重启」只作用于它自己启动的子进程，不会杀掉守护托管的服务。

> **「服务」在本项目里的含义**：Windows 侧所谓「服务」是**登录时触发的无窗口计划任务 +
> 托盘监督 / 看门狗守护**，**不是 Windows SCM 服务**（不在 `services.msc` 中，也不会在未登录时启动）。
> 理由：主服务需要读写**当前用户**的 Codex 数据目录（`CODEX_HOME` / `%USERPROFILE%\.codex`）、
> 与桌面端的 IPC socket 及交互式会话交互，并且要显示托盘 UI。SCM 服务运行在独立服务账户与
> Session 0，拿不到用户会话中的 Codex 状态、也弹不出托盘；按需登录启动反而更安全、无需管理员权限。

### 4. 配置与日志

| 内容 | 路径 |
| :--- | :--- |
| 控制台配置（访问码、端口、`publicUrl` 等） | `%LOCALAPPDATA%\CodexPocket\config.json` |
| 日志目录 | `%LOCALAPPDATA%\CodexPocket\logs\` |
| v2 机器网关配置 | `%LOCALAPPDATA%\CodexPocket\machine.json`（模板 `deploy\machine.example.json`） |
| 网关配置（Linux 服务端） | `/etc/codex-turnloom/machine.json` |

配置文件仅当前用户可读；模板中的 `REPLACE_WITH_*` 必须全部替换，且各 harness token
互不相同、不得等于 `machineToken`。

### 5. 升级

直接覆盖安装新版本 NSIS 包即可：`%LOCALAPPDATA%\CodexPocket` **保留**，
`config.json`、`machine.json`、`logs\` 不会被删除。建议顺序：退出托盘 → 覆盖安装 →
重启托盘/守护任务 → 核对 `/api/health` 与 `/api/harnesses`。只要 `machineToken` 没变，
**手机端无需重新扫码**；若换了 `machineToken`，按 `docs/PROTOCOL.zh-CN.md` 的轮换步骤重新扫码。

### 6. 卸载

```powershell
# 移除托盘控制台登录任务（配置与日志保留）
npm run desktop:uninstall        # scripts/uninstall-console.ps1

# 若注册过机器网关登录任务
powershell.exe -NoProfile -ExecutionPolicy Bypass -File installer\uninstall-machine-service.ps1
```

也可以直接运行 NSIS 安装目录里的卸载器。两者都**不会**删除
`%LOCALAPPDATA%\CodexPocket`；该目录需手动清理（见卸载脚本输出提示）。

---

## 二、手机 App（当前唯一交付线）

当前 App 为 `app/` React/Konsta UI/Vaul → `native-shell/` Android Java WebView 容器，
即 **App 化 DOM 容器（含 WebView）**。`dshgo/`、`mobile-app/`、`android/` 是冻结归档，
不作为当前安装包来源。

### 获取与连接

1. 使用 `dist-app/` 中带版本号的 `Codex-Turnloom-<版本>-app.apk`，核对同名 `.sha256`。
2. 首次打开直接进入「连接电脑」。扫描电脑端 v2 配对码，或点「输入地址和访问码」。
3. 输入电脑配对页显示的服务根地址与**机器访问码**。同一局域网可使用 HTTP 私网 IP；
   公网连接使用有效证书的 HTTPS。地址中不要附带 token 或 `/api` 路径。
4. 验证成功后进入工作台，显示机器实际发现的 Codex / Pi 等服务；切换服务无需再次扫码。

机器访问码只用于 `/api/harnesses` 发现；业务请求使用对应服务的独立 token。
冷启动与返回前台会重新验证。验证失败时可重试、更新访问码或连接其他已发现服务；
未验证连接不会显示伪造的运行任务。

### 更新与签名

设置 → 应用更新 → 检查更新。元数据来自经过认证的 `/api/app/update`，并绑定实际暂存 APK
的包名、versionCode、大小、SHA-256 和构建清单，不从根服务端 `package.json` 推断 App 版本。
下载支持暂停续传，校验包名、版本及签名后才允许打开 Android 系统安装器，仍需用户确认。

当前开发交付使用既有测试签名。覆盖升级必须保持 `com.codex.turnloom.app` 和相同签名；
正式分发前应单独安排发布签名迁移，不能直接更换密钥后宣称可覆盖升级。

「忘记这台电脑」需确认，移除本机配对与该电脑的会话缓存；不会删除电脑上的会话。

---

## 三、服务器服务端（可选）

**不需要公网 / 常驻中转时不要装这一节**：在 Windows 机器上 `npm start`，手机连同一局域网的
`http://<机器局域网地址>:8787` 即可直连，数据只留在本机。

仅在以下场景需要额外的服务端：跨公网访问、长期在线中转、或把已有的 Linux / macOS 机器
作为常驻入口。

### 1. Linux（systemd）

```sh
sudo sh deploy/install-server.sh --systemd --prefix /opt/codex-turnloom \
  --config /etc/codex-turnloom/machine.json --port 8787 --user codex-turnloom
```

单元模板 `deploy/systemd/codex-turnloom-gateway.service`：以 `codex-turnloom` 用户运行
`/opt/codex-turnloom/server/machine-gateway.cjs`，`Restart=always`、`RestartSec=3`、
`ProtectSystem=strict` + 明确的读写例外，日志进 journal。安装器会创建用户/目录、
复制 `deploy/machine.example.json`（若目标不存在）、生成随机 `machineToken`、设置 `0600`、
生成并安装/启用单元。卸载用 `--uninstall`（**不删除配置与数据**）。

### 2. macOS（现有 LaunchAgent）

```sh
npm run service:install        # scripts/install-service.js
npm run service:uninstall      # scripts/uninstall-service.js
```

label 为 `com.openclaw.codex-lan-companion`，plist 位于
`~/Library/LaunchAgents/com.openclaw.codex-lan-companion.plist`。
命令行参数（如 `--readonly --port 8790`）会原样传给 `server.js`。

### 3. 常用启动参数

| 参数 | 作用 |
| :--- | :--- |
| `--readonly` | 只读模式：禁止发消息/改会话，仅查看；适合演示或半公开入口。 |
| `--no-auth` | 关闭访问码校验；**仅限隔离的可信网络**，不要用于公网。 |
| `--port <n>` | 监听端口，默认 8787。 |
| `--password <code>` | 指定访问码（占位示例：`REPLACE_WITH_ACCESS_CODE`）；不指定则启动时随机生成。 |
| `--codex-home <path>` | 指定 Codex 数据目录。 |
| `--public-url <url>` | 生成配对二维码用的对外地址，如 `https://turnloom.example.com`。 |
| `--ipc-socket <path>` | 覆盖桌面端 IPC socket 路径。 |

### 4. 公网部署建议

用 nginx / Caddy 做 HTTPS 反向代理终结 TLS，再转发到网关单端口；给主服务配
`--public-url https://<你的域名>`，让二维码使用外网地址。反代需放行长连接（SSE / WebSocket
升级）并关闭响应缓冲。**只暴露网关端口**，后端 `127.0.0.1` 端口（如 18788 / 8799）
不对外；访问码与 harness token 只在请求头传递，不要塞进 URL 查询串。
建议同时启用 `--readonly` 做只读预览、按来源限速、日志脱敏（见协议文档 §6）。

---

## 四、多 harness 一机一码

`server/machine-gateway.cjs` 读取 `deploy/machine.json`（安装后可能是
`%LOCALAPPDATA%\CodexPocket\machine.json` 或 `/etc/codex-turnloom/machine.json`），
单端口对外，按 harness token 把 `/api/*` 代理到各后端 `127.0.0.1` 端口，并守护后端进程。

增加第二个 harness（例如 Codex + PI-Desktop）的步骤：

1. 复制模板：`deploy/machine.example.json` → `deploy/machine.json`，替换全部
   `REPLACE_WITH_*`（含 `machineToken`、各 `token`、`entry`、`codexHome`）。
2. 在 `harnesses` 数组中保留/新增两项，各自有唯一的 `id`、`token`、`port`、`entry`、
   `codexHome`，示例：

```json
{
  "id": "pidesk",
  "name": "PI-Desktop",
  "token": "REPLACE_WITH_PIDESK_HARNESS_TOKEN",
  "kind": "codex",
  "port": 8799,
  "entry": "C:/path/to/Codex-Turnloom/server.js",
  "codexHome": "C:/path/to/REPLACE_WITH_PIDESK_HOME",
  "spawn": true,
  "extraArgs": ["--readonly"]
}
```

3. 确认 `defaultHarness` 指向存在的 id、所有 token 互不相同且不等于 `machineToken`，
   配置权限 `0600` / 仅当前用户。
4. **重启网关**：
   - Windows：`Stop-ScheduledTask -TaskName "Codex-Turnloom Machine Gateway"` 后
     `Start-ScheduledTask -TaskName "Codex-Turnloom Machine Gateway"`；
   - Linux：`sudo systemctl restart codex-turnloom-gateway`。
5. 手机端**无需重新扫码**，在设备页「重新发现」（重新请求 `GET /api/harnesses`）即可看到
   新 harness；只有 `machineToken` 变化才需要重新扫码。

历史上用 `turnloom-pidesktop/dual/server.js` 按「每个 harness 一个访问码」分流、手机扫两个
二维码的做法，由本节的「一机一码 + 一次发现」取代。

---

## 五、版本与发布矩阵

| 端 | 组件 | 版本来源 | 构建 / 安装命令 | 产物路径 |
| :--- | :--- | :--- | :--- | :--- |
| Windows 控制台 | `desktop/main.cjs` + `desktop/service/*`（Electron 托盘） | `package.json` 的 `version`（当前 `1.17.31`） | `npm run desktop:build`（electron-builder `--win nsis`） | `dist-desktop/Codex-Turnloom-Console-${version}-${arch}.exe` |
| Windows 服务 / 守护 | `server.js`、`scripts/windows-supervisor.ps1`、`scripts/link-watchdog.mjs`、机器网关 `server/machine-gateway.cjs` | `package.json` 的 `version` + `shared/machine-pairing.cjs` 的 `VERSION=2` | `npm start` / `powershell -File scripts/install-console.ps1` / `powershell -File installer/install-machine-service.ps1` | 无独立产物；配置 `%LOCALAPPDATA%\CodexPocket\config.json` 与 `machine.json`，日志同目录 `logs\` |
| 手机（正式） | Flutter 原生 `dshgo/app`（release APK 标签 `Codex-Turnloom`，原图标） | 该工程的 pubspec 版本 / release 标签 | 在 `dshgo/app` 执行对应的 Flutter release 构建，产物暂存为 `Codex-Turnloom-*.apk` | `public/downloads/Codex-Turnloom-*.apk` → `GET /api/apk` |
| 手机（历史） | Android WebView 壳 `android/`、Expo 版 `mobile-app/` | `android/app/build.gradle.kts` 的 `versionCode` + `package.json` 的 `version` | `npm run android:build`（含 `scripts/stage-apk.js`） | `public/downloads/Codex-Turnloom.apk` 及同目录旧包 |
| 服务端（可选） | `server.js` / 机器网关 / systemd 单元 / LaunchAgent | `package.json` 的 `version`、Node `>=22.5` | `npm start`；Linux `sh deploy/install-server.sh --systemd`；macOS `npm run service:install` | `/etc/systemd/system/codex-turnloom-gateway.service`、`~/Library/LaunchAgents/com.openclaw.codex-lan-companion.plist` |
| 协议层 | `shared/machine-pairing.cjs`（Node 侧 CJS 唯一实现；Flutter 侧镜像 `lib/turnloom/turnloom_hosts.dart`） | `PROTOCOL=codex-turnloom`、`VERSION=2`、`HARNESS_PATH=/api/harnesses` | 无需构建，Node 侧运行时 `require`；三端发布前须核对字段规则同步 | 仓库内单一文件，随各端一起分发 |

> 三端的版本号彼此独立；`/api/health.appVersionName` 只描述**手机包**版本，
> 不代表 Windows 控制台或网关版本。发布前请核对三者一致性（见 `installer/README.md` 提示）。

---

相关文件：`docs/PROTOCOL.zh-CN.md`、`deploy/machine.example.json`、
`deploy/systemd/codex-turnloom-gateway.service`、`deploy/install-server.sh`、
`installer/install-machine-service.ps1`、`installer/uninstall-machine-service.ps1`、
`installer/README.md`。
