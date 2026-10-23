# PI-Desktop 桥接入契约（托盘控制台侧）

> 适用：`cn.star.turnloom-bridge`（turnloom-pidesktop 插件）与 Codex-Turnloom 托盘控制台。
> 目的：让手机端在同一台电脑上同时对话 Codex Desktop 与 PI-Desktop，不复制数据库、不在服务端引入第二套 schema。

## 桥提供什么

| 项 | 值 |
|---|---|
| 门面目录 | `%USERPROFILE%\.pidesktop-turnloom`（内含 `state_5.sqlite` + `sessions/*.jsonl`） |
| IPC 管道 | `\\.\pipe\pidesktop-codex-ipc`（Codex Desktop 帧协议：4 字节小端长度 + JSON） |
| 默认端口 | `8799`（插件托管；也可由外部进程托管） |
| 数据来源 | 只读 `pi.sqlite`；写入只经宿主 `agent/prompt` / `agent/abort` |

控制台不直接读 `pi.sqlite`，只把门面目录当作一个 Codex home，并通过 `--ipc-socket` 指向桥管道。

## 控制台如何接入

1. **两台设备（默认）**：控制台托管 Codex（8787）；插件托管 PI 桥（8799）。控制台「设置 → 其他设备」
   添加 `http://<LAN IP>:8799` 与 PI 侧访问码，配对页即可分别生成两台设备的二维码。
2. **单设备合并（可选）**：控制台把 `codexHome` 指向门面目录，`ipcSocket` 设为
   `\\.\pipe\pidesktop-codex-ipc`；若插件以 `TURNLOOM_MIRROR_CODEX=1` 运行，Codex 会话也会进入门面，
   手机端一个列表同时显示两类会话。

## 对插件的可选改进（不阻塞当前接入）

- `contributes.services` 声明了 `turnloom-bridge`，但 `main.js` 未调用 `pi.services.register(...)`；
  宿主日志会出现 `service not registered: turnloom-bridge`。补注册时需给 `onLoad` 加防重入。
- `MIRROR_CODEX` 目前只认环境变量。若希望控制台直接切换「合并显示」，建议改为读取
  `%USERPROFILE%\.pidesktop-turnloom\bridge.json` 的 `mirrorCodex` 布尔值（默认 false）。
- 插件内的访问码建议改为读取本机独立配置文件，避免版本升级时与已配对设备漂移。

## 验证命令

```powershell
node -e "const {DatabaseSync}=require('node:sqlite');const p=require('path').join(process.env.USERPROFILE,'.pidesktop-turnloom','state_5.sqlite');const db=new DatabaseSync(p,{readOnly:true});console.log(db.prepare('select count(*) c from threads').get())"
# 桥管道（插件加载后应存在）
[System.IO.Directory]::GetFiles('\\.\pipe\') | Where-Object { $_ -match 'pidesktop-codex-ipc' }
# 服务端
curl.exe -sS -H "x-access-token: <访问码>" http://127.0.0.1:8799/api/threads?limit=1
```
