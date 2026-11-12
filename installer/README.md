# installer/ — Windows 安装器与机器网关任务

这里是**脚本与说明**，不是 NSIS 工程。安装包由 `package.json` 的 `build` 配置通过
electron-builder 生成；本目录提供机器网关的登录自启安装/卸载脚本。

## 1. NSIS 安装包产物

```powershell
npm ci
npm run desktop:build          # electron-builder --win nsis
```

| 项 | 值 |
| :--- | :--- |
| 目标 | `build.win.target=nsis`（当前用户安装 `perMachine=false`） |
| 产物目录 | `build.directories.output` → `dist-desktop/` |
| 文件名 | `Codex-Turnloom-Console-${version}-${arch}.exe` |
| 图标 / 资源 | `desktop/assets/app.ico`、`buildResources=desktop/assets` |
| 快捷方式 | `Codex-Turnloom 控制台`（桌面 + 开始菜单） |

安装后启动 Electron 托盘控制台（`desktop/main.cjs` + `desktop/service/*`），
首次设置生成机器访问码与**唯一一张机器二维码**。

## 2. install / uninstall 脚本用法

> 两个脚本都是模板，**不会自动执行**；需要管理员以外的权限（每用户任务，
> `-RunLevel Limited`）。所有生成文件均为 UTF-8 无 BOM。两个 `.ps1` 本身刻意保持
> 纯 ASCII：Windows PowerShell 5.1 会把无 BOM 文件按 ANSI 解码，含中文会乱码并
> 破坏语法；中文说明以本 README 与 `docs/*.zh-CN.md` 为准。

```powershell
# 注册机器网关登录自启任务（默认 8787 端口，配置 %LOCALAPPDATA%\CodexPocket\machine.json）
powershell.exe -NoProfile -ExecutionPolicy Bypass -File installer\install-machine-service.ps1

# 自定义端口 / 配置 / node 路径 / 任务名；-Force 会重新生成 machineToken（需重新扫码）
powershell.exe -NoProfile -ExecutionPolicy Bypass -File installer\install-machine-service.ps1 `
  -Port 8787 -ConfigPath "$env:LOCALAPPDATA\CodexPocket\machine.json" -Force

# 移除任务（保留配置与日志）
powershell.exe -NoProfile -ExecutionPolicy Bypass -File installer\uninstall-machine-service.ps1
```

`install-machine-service.ps1` 会：

1. 校验 Node >= 22.5 与 `server\machine-gateway.cjs`、`shared\machine-pairing.cjs`、
   `deploy\machine.example.json` 存在；
2. 从模板生成配置并写入随机 `machineToken` / 各 harness token（`.NET`
   `RandomNumberGenerator` → base64url），UTF-8 无 BOM、收紧为当前用户 ACL；
3. 生成与 `scripts\link-watchdog-launcher.vbs` 同风格的无窗口 VBS 启动器到配置目录；
4. 用 `Register-ScheduledTask` 注册 `-AtLogOn -RunLevel Limited` 任务
   `Codex-Turnloom Machine Gateway`（失败时 `schtasks.exe /SC ONLOGON /RL LIMITED /IT /F` 兜底）；
5. 输出调用 `node -e ... machinePairingPayload(...)` 生成机器二维码 payload 的提示。

仓库里**没有**可直接启动网关的现成 VBS（`link-watchdog-launcher.vbs` 写死
`link-watchdog.mjs`，`windows-supervisor-launcher.vbs` 写死 `windows-supervisor.ps1`），
因此安装器在运行时生成一个同款 VBS。若 WSH 不可用或显式 `-UsePowerShellHidden`，
改用 `powershell.exe -WindowStyle Hidden` + `Start-Process -WindowStyle Hidden` 兜底；
单独对 `node.exe` 使用 Hidden 仍可能闪出 conhost，VBS 链更可靠。

托盘控制台的登录任务由 `scripts/install-console.ps1` 注册、
`scripts/uninstall-console.ps1` 移除（`npm run desktop:install` /
`npm run desktop:uninstall`），与本目录的两个脚本互不影响。

## 3. 机器网关计划任务与托盘控制台的关系

| 组件 | 任务 | 职责 |
| :--- | :--- | :--- |
| 托盘控制台 | `Codex-Turnloom Console` | Electron 托盘 UI、设置向导、状态显示；先查 `/api/health`，健康则接管已运行服务（`external:true`），不重复 spawn。 |
| 机器网关 | `Codex-Turnloom Machine Gateway` | 单端口对外、`GET /api/harnesses` 发现、按 harness token 代理到各后端 `127.0.0.1` 端口，并守护后端进程。 |
| 既有守护 | `Codex-Turnloom Link Watchdog` 等 | 带鉴权健康探测、故障自愈；与网关并存。 |

三者都是**登录时无窗口计划任务 + 托盘/看门狗监督**，不是 Windows SCM 服务：
网关需要访问当前用户的 Codex 数据目录与交互会话。托盘控制台不拥有网关进程，
「停止 / 重启」只作用于它自己 spawn 的 child；卸载网关任务不会关闭托盘控制台，
反之亦然。
## 4. 「一机一码」下 Windows 侧只需要一个二维码

```
手机扫一次 codex-turnloom://pair/add?v=2&protocol=codex-turnloom&machine=<显示名>&mid=<机器标识>&url=<根地址>&token=<机器访问码>&discover=/api/harnesses
  → GET <url>/api/harnesses（x-access-token: 机器访问码）
  → 一次拿到该机全部 harness 及各自的 token
  → 后续 <url>/api/* 用对应 harness 的 token，由网关路由到 127.0.0.1 端口
```

- 机器访问码**只用于发现**；不得当 harness token 使用（单 harness 兼容部署除外）。
- 新增 / 删除 harness 只需编辑 `machine.json` 并重启网关，手机端**重新发现即可，
  无需重新扫码**；只有 `machineToken` 变化才需要重新扫码。
- 协议编解码在 Node 侧的唯一实现是 `shared/machine-pairing.cjs`（CJS）；服务端 / 控制台
  都以此为准，手机 Flutter 侧镜像同样的字段规则（`lib/turnloom/turnloom_hosts.dart`，须同步），
  不要各自复制一份宽松的解析逻辑。
- 旧 `codexpocket://add` 与 `/login?token=` 仍可用；`deploy/machine.example.json` 中的
  `REPLACE_WITH_*` 必须全部替换，且各 harness token 互不相同、不得等于 `machineToken`。
- 全部示例 token 均为占位符；二维码即 bearer 凭据，不要写进日志或截图外发。

详见 `docs/PROTOCOL.zh-CN.md` 与 `docs/INSTALL.zh-CN.md`。

## 5. 一机一码：从旧版双后端调度器迁移（可逆）

现状风险：旧版 `dual/server.js` 也监听 8787 并能通过 `/api/health`，但它的
`/api/harnesses` 只返回默认 harness。**不要**把它的健康响应当作新网关。
`desktop/service/machine-gateway.cjs` 的 `checkGatewayDiscovery` 同时校验
`GET /__turnloom/health`（协议、版本、machineId、harnessCount）和带机器访问码的
`GET /api/harnesses`（身份、全部 harness token、默认 harness），两者都通过才接管。

推荐流程（全部需要人工确认；脚本不改计划任务、不启停进程、不写兄弟仓库）：

```powershell
# 0) 只查看计划；默认 --dry-run，不写任何文件
node scripts\configure-machine-gateway.cjs --dry-run `
  --config "$env:LOCALAPPDATA\CodexPocket\config.json" `
  --machine-config "$env:LOCALAPPDATA\CodexPocket\machine.json" `
  --import-config "D:\pi11\11\turnloom-pidesktop\dual\config.json" `
  --origin "https://<你的固定访问地址>"

# 1) 复核输出中的 harness 数量、端口、tokenPresent、qrMatchesDiscovery，再应用
node scripts\configure-machine-gateway.cjs --apply `
  --config "$env:LOCALAPPDATA\CodexPocket\config.json" `
  --machine-config "$env:LOCALAPPDATA\CodexPocket\machine.json" `
  --import-config "D:\pi11\11\turnloom-pidesktop\dual\config.json" `
  --origin "https://<你的固定访问地址>"

# 2) 人工切换运行时：先退出托盘控制台（不会停止外部守护服务），
#    再停止占用公共端口的旧调度器任务/进程，启动新的机器网关任务。
#    具体任务名与端口以本机实际计划任务为准，脚本不会替你做这一步。

# 3) 只读验证：不打印 token，返回 machineId / harness 数量 / 默认项
node scripts\configure-machine-gateway.cjs --dry-run --probe --json `
  --config "$env:LOCALAPPDATA\CodexPocket\config.json" `
  --machine-config "$env:LOCALAPPDATA\CodexPocket\machine.json"

# 4) 回滚：两种都可逆，均保留 machine.json 与所有备份
#    a) 只关掉运行时开关（回到旧版单 harness 启动）
node scripts\configure-machine-gateway.cjs --apply --disable `
  --config "$env:LOCALAPPDATA\CodexPocket\config.json" `
  --machine-config "$env:LOCALAPPDATA\CodexPocket\machine.json"
#    b) 完整恢复上一次 config.json 备份
node scripts\configure-machine-gateway.cjs --apply --restore "<上一步输出的 .bak-... 路径>" `
  --config "$env:LOCALAPPDATA\CodexPocket\config.json"
```

`--import-config` 显式指定、只读导入：真实的 `port / entry / codexHome / token /
extraArgs / defaultDevice` 全部来自该文件；机器访问码是**新生成且稳定**的随机值，
与所有 harness 访问码不同。默认 `--no-spawn`（等效于网关命令行 `--no-spawn`），
**不会**拉起或杀死已由外部守护拥有的后端；只有显式 `--spawn-backends` 才让网关
自己守护后端。控制台的 watchdog 复用规则不变：`external:true` 的服务只断开显示，
绝不 `taskkill` 外部进程。

凭据只写入每用户配置目录（`%LOCALAPPDATA%\CodexPocket`），写入前生成带时间戳的
备份；`stdout` 只输出脱敏计划。默认拒绝把含凭据的配置写回源码仓库。所有示例
端口、地址、路径都只是示例，必须由 `--config / --machine-config / --origin` 明确给出。
机器二维码仍然只有一张，来自 `machine.json` 的同一 machineId / machineName /
machineToken / origin，与 `/api/harnesses` 响应严格一致。

## 6. 发布前核对

- `package.json` 的 `version`、NSIS 产物名中的 `version`、手机包
  `/api/health.appVersionName`、`android/app/build.gradle.kts` 的 `versionCode`
  各自独立，发布前逐一比对。
- 仓库内没有 release 签名密钥（`*.jks` / `*.keystore` 被 `.gitignore` 排除），
  正式 release APK 需自行签名。
- `server/machine-gateway.cjs` 由并行实现提供，本目录脚本只引用、不创建该文件。
