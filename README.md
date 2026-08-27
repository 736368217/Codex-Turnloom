# Codex Pocket

Codex Pocket 是一个私有、自托管的 Codex Desktop 手机控制方案。它由本机服务、移动网页、Android APP 和 Windows 守护脚本组成，可在一部手机中扫码添加并切换多台电脑。

## 功能

- 查看 Codex 对话、思考状态和工具调用
- 从手机发送、插入、排队、编辑或取消消息
- 查看对话中的图片并下载本地文件
- 为指定对话启用完成通知；空闲时不显示常驻监测通知
- 对话列表隐藏子 Agent 任务，并按桌面端置顶和项目目录分组
- 扫码添加和切换多台电脑，并为每台电脑设置手机本地备注
- Codex 数据目录迁移兼容
- Windows 服务与 SSH 隧道异常退出后自动恢复
- 电脑关机时停止，下一次 Windows 登录时恢复

## 结构

```text
server.js       Codex Desktop 本机服务与 IPC
public/         手机交互页面
android/        Codex Pocket Android 源码
scripts/        安装、守护和设备二维码工具
test/           服务端回归测试
docs/           多电脑部署与安全说明
```

## 新电脑部署

前置条件：Windows 10/11、Codex Desktop、Node.js 18+、Git。克隆私有仓库后运行：

```powershell
npm ci
.\scripts\install-windows.ps1 -MachineName "办公室电脑"
```

如果需要通过公网访问，需要为每台电脑分配独立的服务器回环端口和公网 URL：

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

安装完成后会显示 APP 可识别的设备二维码。以后可重新显示：

```powershell
npm run device:qr
```

完整步骤见 [Windows 多电脑部署](docs/WINDOWS_MULTI_COMPUTER.zh-CN.md)。Codex 自动部署规则见 [AGENTS.md](AGENTS.md)。

## Android

测试与构建：

```powershell
npm run android:test
npm run android:build
```

调试 APK 位于 `android\app\build\outputs\apk\debug\app-debug.apk`。

APP 支持三种设备导入内容：

- `codexpocket://add?...` 设备二维码
- 含 `login` 或 `token` 参数的 HTTP(S) URL
- `{ "name": "...", "url": "...", "token": "..." }` JSON

完成提醒使用 Android WorkManager。手机发出任务或开启提醒后会立即开始跟踪运行中的对话；其余时间由系统周期任务兜底，因此不会再为后台监测显示常驻通知。

## 验证

```powershell
npm test
npm run check
npm run android:test
```

PowerShell 部署脚本同时兼容 Windows PowerShell 5.1 和 PowerShell 7。GitHub Actions 会在每次推送后运行服务端测试并构建 Android 调试 APK。

## 本地配置与安全

仓库不会包含 Codex 数据、访问码、SSH 私钥、服务器凭据、每台机器的公网地址配置、APK、Gradle 缓存或运行日志。

Windows 本地配置保存在 `%LOCALAPPDATA%\CodexPocket\config.json`。Android 端保存的设备访问码使用 Android Keystore 加密。公网入口应由 Caddy/Nginx 提供 TLS，并只将服务器本机回环端口转发给对应电脑。

## 来源与许可

服务端基于 MIT 许可的 `dreamingboat/codex-lan-companion` 扩展。当前项目是非官方个人工具，与 OpenAI 无关联。它依赖 Codex Desktop 的本地文件和 IPC 私有实现，Codex Desktop 更新后可能需要适配。
