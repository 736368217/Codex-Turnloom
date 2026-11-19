# 日志：在哪、怎么传、包里有什么、留多久

适用范围：Windows 电脑端服务（`server.js`）、Windows 控制台（`desktop/`）、手机端诊断上报。本文与代码对齐的版本是 2.2.5（`server/log-bundle.cjs`、`server/request-log.cjs`、`server.js` 的 `/api/admin/logs*`）。

## 1. 日志在哪

默认目录：`%LOCALAPPDATA%\CodexPocket\logs\`（可用 `TURNLOOM_LOG_DIR` 或 `CODEX_LAN_LOG_DIR` 覆盖）。

| 文件 | 写入者 | 内容 | 本地保留 |
|---|---|---|---|
| `server-YYYYMMDD.log` | `server.js` | 每个 `/api/*` 一行 JSON：`ts/source/level/method/path/status/ms/harness/threadId/code`，5xx 带 `stack` | 按本地日期切文件；单文件满 **8 MiB** 轮转成 `.1`~`.3`（单日上限 32 MiB）。**旧日期的文件不会被自动删除** |
| `server-error.log` / `server-out.log` / `console.log` | 控制台托管进程的 stdout/stderr | 进程级输出 | 控制台启动时超过 **5 MiB** 改名为 `.1`（只留一代） |
| `tunnel-out.log` / `tunnel-error.log` | 控制台隧道 | 隧道输出与错误 | 同上（5 MiB / 单代） |
| `supervisor.log` | **旧版计划任务**「Codex Pocket Supervisor」 | 启停、隧道等自由文本 | **没有上限**。新版控制台不写它；控制台首次运行会执行 `desktop/service/legacy.cjs` 的迁移（结束旧计划任务并 `/Delete`）。本机实测 4.8 MB 且仍在增长——说明迁移没有生效，见第 4 节 |
| `phone\<machine>-<YYYYMMDD>.jsonl` | `POST /api/diagnostics` | 手机端主动上报的诊断；白名单字段，单条 ≤300 字 | 每个文件**只留最新 1000 行** |

两条与隐私相关的实现事实：

- `server-*.log` 从不写访问码、`x-access-token`、消息正文——查询串在落盘前就被剥掉（`request-log.cjs`）。Vera 在真实日志上扫过访问码与 `QA-SECRET-*` 标记，0 命中。
- 手机诊断只收白名单字段（`at/kind/phase/path/code/status/appVersion/machine`），单条 ≤2 KiB，单次 ≤200 条，请求体硬上限 256 KiB。

## 2. 怎么上传

两个入口，都是**手动**，默认不自动上传：

1. **Windows 控制台**：首页「上传日志」或设置页同名按钮 → IPC `logs:upload` → `POST /api/admin/logs/upload`。
2. **命令行**（排障时给运维用）：

```powershell
$code = "<访问码>"
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8799/api/admin/logs/upload" `
  -Headers @{ "x-access-token" = $code }
# → { ok: true, key: "turnloom/logs/<machine>/logs-<machine>-<stamp>-<8hex>.zip", bytes, files, omitted, droppedLines }
```

只下载不打远端（本地排查）：

```powershell
Invoke-WebRequest -Uri "http://127.0.0.1:8799/api/admin/logs" -Headers @{ "x-access-token" = $code } -OutFile logs.zip
```

上传令牌来自 `TURNLOOM_LOG_UPLOAD_TOKEN`，或本机文件 `Desktop\认证\r2-upload-token.txt`。**令牌不存在时不会上传**，返回 `200 {ok:false,error:"upload-token-missing"}`（控制台显示为可读提示）；R2 拒收返回 `502 {ok:false,error:"upload-failed",reason}`。两种情况本地日志都不动。

对象地址：`https://dl.736.de5.net/turnloom/logs/<machine>/<name>-<8hex>.zip`。**公开可读**（不需要令牌），所以 key 里带 32 位随机后缀防止被猜到；包内容本身已按白名单脱敏，即使链接泄漏也看不到消息正文或访问码。

## 3. 包里有什么

zip 是 **store 模式**（不压缩，无第三方依赖），第一个成员恒为 `manifest.json`：

```json
{
  "product": "codex-turnloom",
  "generatedAt": "2026-11-19T10:39:15.000Z",
  "machine": "736-WIN",
  "fields": { "server": ["ts","source","level","method","path","status","ms","harness","threadId","code"],
              "phone":  ["at","kind","phase","path","code","status","appVersion","machine"] },
  "limits": { "totalBytes": 8388608, "serverFiles": 2, "phoneFiles": 24, "supervisorTailBytes": 524288 },
  "totalBytes": 949181,
  "files": [{ "path": "server/server-20261119.log", "bytes": 385398, "sha256": "…" },
            { "path": "supervisor/supervisor.log", "bytes": 292608, "sha256": "…",
              "truncated": true, "fromBytes": 3918559 }],
  "filesOmitted": [{ "path": "server/server-20261116.log", "bytes": 268605 }],
  "droppedLines": 0
}
```

取样规则（全部写在 `server/log-bundle.cjs`）：

- `server-*.log`：按修改时间取**最近 2 个**文件。
- `phone/*.jsonl`：最多 24 个文件。
- `supervisor.log`：只取**尾部 512 KiB**，且**从换行处开始**（不会出现半行开头）；正文一律 `[text omitted]`，只留 `时间戳 [来源]`——能看出「隧道 7 秒重启」的密度，看不出具体报错原因。
- 总预算 **8 MiB**；超出时后进来的文件被截断到剩余预算。

**截断与被挡掉都是显式事实**：被截的文件在 `files` 里带 `truncated:true` + `fromBytes`（原文件里从这个字节开始），被条数上限挡掉的文件列在 `filesOmitted`（带真实字节数），上传回执里的 `omitted` 是同一份数量。看到包里只有一部分日志时，先看 manifest，不要把它当成「日志就这么多」。

**脱敏是字段白名单，不是整行删**：`server`/`phone` 只保留上面 `fields` 里列的键，其余字段（消息正文、备注、stack）根本不进包；已知密文（访问码、上传令牌）再做一次字面替换。`droppedLines` 记录因为不是合法 JSON 或没有可保留字段而被丢弃的行数。

## 4. 保留期限

| 位置 | 保留 | 谁负责删 |
|---|---|---|
| 本机 `server-YYYYMMDD.log` | 每日一个文件，单日上限 8 MiB × 4 代（`.1`~`.3`）；**按天的旧文件不自动删** | 需要人工（例：只留最近 7 天） |
| 本机 `phone/*.jsonl` | 每文件最新 1000 行 | 服务自己裁剪 |
| 本机 `console/server-out/server-error/tunnel-*.log` | 5 MiB，单代 `.1` | 控制台启动时轮转 |
| 本机 `supervisor.log` | **无上限**，旧计划任务持续追加 | 见下 |
| R2 `turnloom/logs/**` | **目前没有自动过期**：桶上没有 lifecycle 规则，对象会一直留着 | 人工，或在桶上配生命周期 |

### 4.1 本机这台机器上的真实状态：旧 supervisor 还在跑，隧道在崩溃循环

先给结论：**不要先删旧任务**。旧计划任务「Codex Pocket Supervisor」在这台机器上就是当前的托管体——`node server.js`（`0.0.0.0:8787`）和隧道都由它拉起。先 `/Delete` 会让 8787 和隧道一起失去看管。

实测到的事实（2026-11-19 18:54）：

1. 计划任务每 ~59 秒触发一次，执行的是**安装副本** `Documents\Codex\codex-turnloom\scripts\windows-supervisor.ps1`（2026-09-03，4,134 B），与仓库版不是同一份文件。
2. 新的承接者**不存在**：`schtasks /query /tn "Codex-Turnloom Machine Gateway"` 报「系统找不到指定的文件」，`%LOCALAPPDATA%\CodexPocket\machine.json` 也没有。所以“控制台接管”这条路在这台机器上从未完成——这也解释了 `desktop/service/legacy.cjs` 的迁移为什么没把这些任务删掉（迁移只在控制台真正启动时才跑）。
3. `supervisor.log` 长到 4.8 MB 不是因为它啰嗦，而是**隧道在崩溃循环**：最后 200 KB 里 2,325 行、跨 4 小时 27 分、平均 6.9 秒一行，全部是 `Starting tunnel to 121.40.69.97; remote port 18788`；同一时刻机器上 `ssh.exe` 计数为 0。也就是说隧道“起来→立刻死→再起”。
4. 对日志包的影响：512 KiB 尾部切片本身没问题，但切出来的内容 100% 是同一行的重复，等于没有信息。

**正确顺序**（这台机器上需要管理员，且要 Human 点头，因为会短暂断开 8787 与隧道）：

```powershell
# 1. 先确认新托管真能起来（控制台安装或 Machine Gateway 任务），并且它的健康检查能打到 8787
schtasks /Query /TN "Codex-Turnloom Machine Gateway"   # 现在会失败 = 还没装
# 2. 新托管确认接管之后，再结束旧任务
schtasks /End /TN "Codex Pocket Supervisor"
schtasks /Delete /TN "Codex Pocket Supervisor" /F
# 3. 归档旧日志（它已经没有诊断价值）
Rename-Item "$env:LOCALAPPDATA\CodexPocket\logs\supervisor.log" supervisor.log.old
```

**隧道崩溃循环本身是另一个问题，不要和日志打包混在一起**：它意味着公网入口（`121.40.69.97:18788`）这 4 个多小时里没有一次真正建立。要查的话从三处看：远程端口是否被占、ssh 密钥/known_hosts 是否变过、安装副本脚本里的 ssh 参数是否还是旧的。详见第 5 节。

### 4.2 R2 侧保留（尚未实施）

`turnloom/logs/` 前缀目前没有 lifecycle 规则：上传的对象永久保留，且**公开可读**（key 带 32 位随机后缀，内容已脱敏，但机器名与请求时序长期可读）。建议给该前缀配 **30 天** 过期，或定期按前缀列出后删除。这条需要桶凭据，未做。

## 5. 排障速查

| 现象 | 看哪里 |
|---|---|
| 控制台点「上传日志」没反应 | 服务是否在跑；控制台日志里 `logs:upload` 的返回值 |
| `upload-token-missing` | `Desktop\认证\r2-upload-token.txt` 是否存在、`TURNLOOM_LOG_UPLOAD_TOKEN` 是否设置 |
| `upload-failed` + `reason` | R2 侧状态码；网络是否能到 `dl.736.de5.net` |
| 包里没有某天的 server 日志 | 只取最近 2 个文件；更早的在本地已按 3 天轮转删掉 |
| 包里 supervisor 只有时间戳 | 设计如此：正文不进包 |
| 想知道某个 4xx 的原因 | `code` 字段 + 同一时刻 `docs/PROTOCOL.zh-CN.md` 的错误码表 |
