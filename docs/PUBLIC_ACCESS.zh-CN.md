# 公网访问（本机 → 阿里云 18787）

手机不在同一局域网时，Codex-Turnloom 走的是**自建公网入口**，不使用 Cloudflare、ngrok 之类的第三方隧道。

```
手机
  │  https://121.40.69.97:18787   （阿里云 ECS 公网 + Let's Encrypt IP 证书）
  ▼
阿里云 Nginx  :18787
  │  反代到 127.0.0.1:18786
  ▼
SSH 反向隧道（Windows 主动外连，restrict + permitlisten=127.0.0.1:18786）
  │
  ▼
Windows 8787  →  dual dispatcher（按访问码分流）
                   ├─ :18788  Codex 后端（D:\codex\.codex）
                   └─ :8799   PI-Desktop 后端（~/.pidesktop-turnloom，走 codex IPC 门面）
```

**一个公网端口，两个设备**：手机里存两条设备记录，地址相同，只有访问码不同。访问码本身就是路由键。

## 手机端设备表

| 名称 | 地址 | 说明 |
|---|---|---|
| Codex | `https://121.40.69.97:18787` | 访问码见控制台「手机配对」页（默认设备） |
| PI-Desktop | `https://121.40.69.97:18787` | 访问码见控制台「其他设备」条目的配对二维码 |

两条设备同源，浏览器里不要勾「记住」，App 里保存的是 token 字段，没问题。

## 本机组成

| 组件 | 位置 / 说明 |
|---|---|
| 桌面控制台 | `dist-desktop\win-unpacked\Codex-Turnloom Console.exe`，计划任务 `Codex-Turnloom Console` 开机拉起 |
| 8787 入口 | `D:\pi11\11\turnloom-pidesktop\dual\server.js`（控制台的 `repoRoot` 指向它） |
| 设备表 | `D:\pi11\11\turnloom-pidesktop\dual\config.json` |
| 反向隧道 | 控制台内置（`desktop/service/tunnel.cjs`），配置在 `%LOCALAPPDATA%\CodexPocket\config.json` 的 `tunnel` 段 |
| 隧道私钥 | `C:\Users\WIN10\.ssh\codex_pocket_ed25519`（VPS 上限制为 `permitlisten="127.0.0.1:18786"`） |
| PI-Desktop 桥 | PI-Desktop 插件 `cn.star.turnloom-bridge`，提供 `\\.\pipe\pidesktop-codex-ipc` |

## 排障顺序

1. 本机：`curl http://127.0.0.1:8787/__dual/ -H "x-access-token: <访问码>"` → 两个后端都应为 `up: true`。
2. 本机：`Get-Content %LOCALAPPDATA%\CodexPocket\logs\tunnel-error.log -Tail 20` → 有 `Permission denied` 说明 VPS 上的公钥没授权。
3. 公网：`curl -k -o NUL -w "%{http_code}" https://121.40.69.97:18787/login` → 期望 `302`；`502` 表示阿里云上 18786 没有隧道在听。
4. 阿里云上确认：`ss -lntp | grep 1878` 应看到 `127.0.0.1:18786`（sshd 转发）和 `0.0.0.0:18787`（nginx）。

## 换机器 / 重装后要做的事

1. 生成新密钥：`ssh-keygen -t ed25519 -N "" -f C:\Users\WIN10\.ssh\codex_pocket_ed25519`
2. 在阿里云 `codextunnel` 用户的 `~/.ssh/authorized_keys` 追加一行（保持限制）：

   ```
   restrict,port-forwarding,permitlisten="127.0.0.1:18786" ssh-ed25519 AAAA...公钥... <备注>
   ```

3. `%LOCALAPPDATA%\CodexPocket\config.json` 的 `tunnel` 段：
   `host=121.40.69.97`、`user=codextunnel`、`remotePort=18786`、`enabled=true`，
   `keyPath` / `knownHostsPath` 指向上面两个文件。
4. `known_hosts` 必须含该主机公钥，否则 `StrictHostKeyChecking=yes` 会直接失败：
   `ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=C:\Users\WIN10\.ssh\known_hosts codextunnel@121.40.69.97 exit`

## 兼容性约束

- 手机里已保存的访问码不要随意更换；换了就要重新配对。
- `dual` 分流依赖访问码，所以后端 `--password` 必须与设备表一致。
- 两个后端同源，`turnloom_session` cookie 会互相覆盖；dispatcher 因此额外下发
  `turnloom_dual` 路由 cookie，并在转发时补上 `?token=`，保证浏览器里两台互不干扰。
