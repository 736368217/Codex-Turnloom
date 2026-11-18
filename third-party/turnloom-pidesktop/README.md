# turnloom-pidesktop — PI-Desktop 桥

把 PI-Desktop 的会话以 Codex 兼容格式镜像到门面目录 `~/.pidesktop-turnloom`，并在命名管道
`\\.\pipe\pidesktop-codex-ipc` 上扮演 Codex Desktop，于是 Codex-Turnloom 不用改接口就能
浏览 / 继续 / 停止 / 排队 / 发图 / 归档 PI 的会话。默认 `MIRROR_CODEX=0`（Codex 会话已有
独立设备，混进同一个列表会重复）。

## 安装

```powershell
node third-party/turnloom-pidesktop/install-plugin.cjs
```

安装器做四件事：

1. 把 `plugin/**` 复制到 `<PI dataRoot>/plugins/installed/cn.star.turnloom-bridge/`
   （dataRoot 由 `%APPDATA%\PI-Desktop\storage-location.json` 的 `roots.data` 决定，缺省
   `~/.pi-desktop`）；
2. 在 `plugins/registry.json` 里 upsert 插件条目（幂等，保留原 `path`）；
3. 把仓库根写进 `~/.pidesktop-turnloom/bridge.json` 的 `turnloomHome`
   —— 插件装深四层之后 `../../..` 猜不到仓库根，实测会解析成 `~/.pi-desktop`；
4. 首次运行生成**固定访问码** `~/.pidesktop-turnloom/access-code.txt`（10 位、去掉 0/O/1/I），
   并在控制台打印一次。之后每次启动都用这个码。

装完重启 **PI-Desktop**（只结束 `PI-Desktop` / `pi-desktop-host-core`），插件在启动时加载并接管：
创建 IPC 管道、每 3 秒同步一次门面、托管 8799 上的 Turnloom（没在监听就自己拉起）。

> 注意：从 Electron 里继承来的 `ELECTRON_RUN_AS_NODE=1` 会让 `PI-Desktop.exe` 变成 node 直接退出。
> 用脚本启动时要先 `Remove-Item Env:ELECTRON_RUN_AS_NODE`。

## 手机配对

访问码就是 `%USERPROFILE%\.pidesktop-turnloom\access-code.txt` 里的那一行（首次安装会在控制台打印）。
它是固定的：桥重启、PI 重启、Turnloom 重启都不变，所以手机配一次就够了。
Turnloom 日志里不会打印明文（后台启动时显示 `Access code: (masked …)`）。

## 手动起 Turnloom（不依赖插件托管）

```powershell
$code = (Get-Content "$env:USERPROFILE\.pidesktop-turnloom\access-code.txt" -Raw).Trim()
$env:CODEX_LAN_PASSWORD = $code      # 不要写在命令行里：同用户进程能读到 argv
node server.js --host 127.0.0.1 --port 8799 `
  --codex-home "$env:USERPROFILE\.pidesktop-turnloom" `
  --ipc-socket '\\.\pipe\pidesktop-codex-ipc'
```

## 数据与写入边界

- 只读 `pi.sqlite` 的 `sessions / turns / messages / turn_queue / providers / plan_approvals`；
- 写只走宿主 API（`pi.desktop.invoke`）或 PI 自己的权威表：排队写 `turn_queue`
  （`principal = turnloom-mobile`），归档写 `sidebar-preferences.json` 的
  `sessionMeta[id].archived`（和桌面端同一份事实），模型改 `sessions.provider_id/model_id/thinking_level`；
- **发送路径不调用 `session/configure`**：宿主把它标成 dangerous，会弹原生确认框，手机端没人能点。

## 回归测试

每个都能在**没有 PI-Desktop** 的情况下跑（临时库 / 临时管道 / 临时目录）：

```powershell
node third-party/turnloom-pidesktop/test-bridge-config.cjs   # 仓库根解析、访问码稳定、模型目录并集
node third-party/turnloom-pidesktop/test-model-routing.cjs   # 模型路由契约（发送路径 0 次 configure）
node third-party/turnloom-pidesktop/test-shared-queue.cjs    # 与桌面共享 turn_queue
node third-party/turnloom-pidesktop/test-attachments.cjs     # 图片落盘 → 宿主附件
node third-party/turnloom-pidesktop/test-fork.cjs            # session/fork 分叉点换算
node third-party/turnloom-pidesktop/test-host-capabilities.cjs
node third-party/turnloom-pidesktop/test-project-routing.cjs
node --test test/pi-send-model.test.js                       # 未选模型时沿用会话模型的规则
```
