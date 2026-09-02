# Windows 多电脑部署

本仓库包含服务端、Windows 守护脚本和 Android 客户端源码。每台电脑运行一套独立服务，并在 codex-Turnloom APP 中保存为一台独立设备。

## 设计原则

- 每台电脑使用独立的访问码。
- 每台电脑使用独立的公网 URL 或公网端口。
- Codex 数据、访问码、SSH 私钥和服务器凭据只保存在电脑本地，不进入 Git。
- 服务和 SSH 隧道由两个 Watchdog 监控，退出后约 5 秒自动重启。
- 关机时进程自然退出；Windows 登录后计划任务自动恢复。

## 本地部署

前置条件：

- Windows 10/11
- Codex Desktop 已安装并至少启动过一次
- Node.js 18+
- Git
- 需要公网隧道时启用 Windows OpenSSH Client

在 PowerShell 中运行：

```powershell
git clone <private-repository-url>
Set-Location .\codex-Turnloom
npm ci
.\scripts\install-windows.ps1 -MachineName "办公室电脑"
```

安装程序会：

1. 自动定位最近使用的 Codex 数据目录。
2. 生成一条六位访问码。
3. 将配置写入 `%LOCALAPPDATA%\CodexPocket\config.json`。
4. 创建 codex-Turnloom 后台守护任务（已有安装会继续沿用旧任务名）。
5. 在后台启动服务，并在异常退出后重新启动。

若电脑存在多个 `.codex` 目录，应明确指定：

```powershell
.\scripts\install-windows.ps1 `
  -MachineName "办公室电脑" `
  -CodexHome "<Codex 数据目录>"
```

## 公网访问和多电脑端口

使用同一台中转服务器时，每台电脑必须分配不同的远端回环端口。例如：

| 电脑 | 本地端口 | 服务器回环端口 | 对外 URL |
| --- | ---: | ---: | --- |
| 家里电脑 | 8787 | 29001 | `https://home.example.com` |
| 办公室电脑 | 8787 | 29002 | `https://office.example.com` |
| 笔记本 | 8787 | 29003 | `https://laptop.example.com` |

服务器上的 Caddy/Nginx 只需把每个域名或外部端口分别反向代理到对应的 `127.0.0.1:<服务器回环端口>`。不要让反向 SSH 端口直接监听公网地址。

电脑本地准备好仅供隧道使用的 SSH 密钥和 `known_hosts` 后运行：

```powershell
.\scripts\install-windows.ps1 `
  -MachineName "办公室电脑" `
  -CodexHome "<Codex 数据目录>" `
  -PublicUrl "https://office.example.com" `
  -TunnelHost "server.example.com" `
  -TunnelUser "codextunnel" `
  -RemotePort 29002 `
  -SshKeyPath "$env:USERPROFILE\.ssh\codex_pocket_office_ed25519"
```

安装完成后会直接打印设备二维码。也可以随时重新打印：

```powershell
npm run device:qr
```

在 APP 首页点击“扫码”，扫描二维码后，新电脑会出现在机器列表中。扫描相同 URL 的新二维码会更新已有机器，而不是重复添加。

## 验证

```powershell
$config = Get-Content "$env:LOCALAPPDATA\CodexPocket\config.json" -Raw | ConvertFrom-Json
$headers = @{ "x-access-token" = $config.accessCode }
Invoke-RestMethod "http://127.0.0.1:$($config.port)/api/health" -Headers $headers
Invoke-RestMethod "http://127.0.0.1:$($config.port)/api/threads" -Headers $headers
```

计划任务应保持 `Running`。为兼容已有安装，任务内部名称暂时仍是旧标识：

```powershell
Get-ScheduledTask "Codex Pocket * Watchdog"
```

日志目录：

```text
%LOCALAPPDATA%\CodexPocket\logs
```

## 更新

```powershell
git pull --ff-only
npm ci
.\scripts\install-windows.ps1 `
  -MachineName "办公室电脑" `
  -CodexHome "<Codex 数据目录>" `
  -PublicUrl "https://office.example.com" `
  -TunnelHost "server.example.com" `
  -RemotePort 29002
```

更新安装会覆盖 Watchdog 任务，但保留 Codex 数据和本机配置。未显式传入的访问码、隧道参数和公网 URL 会自动沿用现有值。

## 卸载

```powershell
.\scripts\uninstall-windows.ps1
```

卸载仅移除计划任务，不删除本地配置、日志、Codex 数据或仓库。
