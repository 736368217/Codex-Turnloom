# PI-Desktop 接入指南（手机端 Turnloom）

> 适用版本：Codex-Turnloom 2.2.x / `third-party/turnloom-pidesktop` 1.0.x。  
> 目标：让手机像用 Codex 一样浏览、继续、停止 PI-Desktop 的会话；普通收发不需要在电脑前点任何确认框。

## 1. 前置条件

- Windows 10/11，已安装并登录 **PI-Desktop**（`C:\Program Files\PI-Desktop`）。
- 本机已安装 Node.js 22.5+。
- 手机与电脑在同一局域网 / VPN，或已有可访问的 HTTPS 转发。

## 2. 安装桥插件（只需一次）

在仓库根目录执行：

```powershell
node third-party/turnloom-pidesktop/install-plugin.cjs
```

安装器会：

1. 把 `plugin/` 复制到 PI 的插件目录；
2. 在 PI 的 `registry.json` 注册 `cn.star.turnloom-bridge`；
3. 写 `bridge.json`（记录 Turnloom 仓库根，插件不再靠 `../../..` 猜路径）；
4. 首次生成固定访问码，文件在：

```text
%USERPROFILE%\.pidesktop-turnloom\access-code.txt
```

然后**重启 PI-Desktop**（只结束 `PI-Desktop.exe` / `pi-desktop-host-core.exe`，不要动 Codex）。

## 3. 启动 Turnloom

桥插件会在 PI-Desktop 启动后自动拉起 Turnloom（端口 8799，门面目录 `%USERPROFILE%\.pidesktop-turnloom`）。也可以手动启动：

```powershell
node server.js --host 0.0.0.0 --port 8799 `
  --password "<access-code.txt 里的码>" `
  --codex-home "$env:USERPROFILE\.pidesktop-turnloom" `
  --ipc-socket "\\.\pipe\pidesktop-codex-ipc"
```

自检：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-pidesk-bridge.ps1
```

应看到 `Facade` / `IPC pipe` / `Port 8799` 三项 `Ok=True`。

## 4. 手机配对

1. 打开 App →「连接电脑」→「输入地址和访问码」。
2. 地址填 `http://<电脑局域网 IP>:8799`（不要填 `localhost`）。
3. 访问码填 `access-code.txt` 里的值。
4. 连接后会在「会话」里看到 PI-Desktop 的会话（以及 Codex 会话，如果启用了 Codex 镜像）。

也可以在电脑端控制台生成二维码；PI 桥的码与 Codex 的码是两套独立实例，扫哪个就连哪个。

## 5. 行为边界（重要）

- **普通发送/停止/排队**：不会调用 PI 的 `session/configure`，不会弹原生确认框；手机端不需要人在电脑前。
- **模型切换**：手机端显式切换模型时，由 Turnloom 的 PI 段直接改写 `sessions` 行并回读校验；桥的发送路径不再调用 dangerous 的 `session/configure`。如果 PI 宿主拒绝或模型不可用，服务端会返回 409 并在手机上说明原因，不会静默改坏会话。
- **审批、归档、删除、计划确认**：这些仍属于 PI 宿主的 dangerous 桌面操作；不同 PI 版本可能要求桌面端确认。手机端会显示真实原因，不会假装成功。不要把需要这类操作的任务当成完全无人值守。
- **Codex 会话**：默认 `MIRROR_CODEX=0`，桥默认只镜像 PI；如要让同一实例也显示 Codex 会话，设置 `TURNLOOM_MIRROR_CODEX=1` 后重启，且 Codex 数据只读、写操作走 Codex 自己的 IPC。

## 6. 故障排查

| 现象 | 检查 |
| :--- | :--- |
| 手机连不上 8799 | `Test-NetConnection 127.0.0.1 -Port 8799`；防火墙是否放行；手机与电脑是否同网段 |
| 连上但会话为空 | `%USERPROFILE%\.pidesktop-turnloom\state_5.sqlite` 是否存在；`scripts/check-pidesk-bridge.ps1` 的 Facade 项 |
| 原生授权框反复弹 | 看 `%USERPROFILE%\.pi-desktop\logs\app\plugin.log` 的 `desktop.invoke`；正常发送不应出现 `session/configure`。若出现，升级到本版本桥并确认安装目录是当前 `plugin/**` |
| 访问码丢了 | 删除 `access-code.txt`，重启 PI-Desktop，让安装器/桥重新生成；手机端重新配对 |
| 桥升级后 8799 起不来 | 看 `%USERPROFILE%\.pidesktop-turnloom\bridge.json` 的 `turnloomHome` 是否指向当前仓库；重跑 `install-plugin.cjs` |

## 7. 安全

- 访问码等同本机控制面凭据，不要发到公开群、截图或提交仓库。
- 需要轮换时：删除 `access-code.txt` → 重启 PI-Desktop / 8799 → 手机重新配对。
- 不要把 8799 直接暴露到公网；需要远程时放在有 TLS 和访问控制的私有网络/反向代理后。
- PI-Desktop 与本桥都以当前 Windows 用户权限运行；只在你信任的机器上安装。
