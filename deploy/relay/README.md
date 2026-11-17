# 公网入口中继（relay）

手机 → 中继服务器 → SSH 反向隧道 → Windows 主机上的机器网关 → 各 harness 后端。
当前本机网关端口为 **42873**（2026-11-17 从 8787 迁移）；新安装的默认值仍为 8787，以 `config.json` 的 `port` 为准。

```
phone ──https──▶ tl.z736.cc.cd (47.98.97.102)
                    │  nginx :443  ──▶ 127.0.0.1:18786
                    │                     ▲
                    │        ssh -R 127.0.0.1:18786:127.0.0.1:42873
                    ▼                     │
             (备用) tl-cf.z736.cc.cd ── Cloudflare Tunnel ──▶ 127.0.0.1:18786
                                          Windows 主机 42873 machine-gateway.cjs
                                                     ├── 18788 codex
                                                     └── 8799  pidesk (--ipc-socket)
```

中继只做 TLS 终结与端口转发，**不运行任何 Turnloom 后端**：Codex / PI 数据始终留在 Windows 主机。
本机端口变动后，守护与隧道必须一起同步；公网域名、服务器 443/18786 和手机配对凭据无需改动。

## 为什么是两条通道

- 主通道 `tl.z736.cc.cd` 直连 `47.98.97.102:443`：实测热请求 58 ms，TLS 由 Let's Encrypt 签发。
- 备用通道 `tl-cf.z736.cc.cd` 走 Cloudflare Tunnel（cloudflared 常驻中继，仅出站连接）。
  同一台机器实测隧道模式每请求多 0.5–0.9 s，且 Cloudflare 给本机选的边缘是 AMS/LAX，
  所以不作为默认路径。
- 备用通道存在的意义：主通道若被 ICP/备案策略拦截，只需把 `tl.z736.cc.cd` 的 DNS 改回
  指向隧道的 CNAME，客户端地址与证书都不用动。

## 中继上的组件

| 组件 | 位置 | 作用 |
|---|---|---|
| `codextunnel` 用户 | `/home/codextunnel` | 只允许一条 remote forward（`PermitListen 127.0.0.1:18786`），无 shell |
| nginx 站点 | `/etc/nginx/sites-available/turnloom` | 443 TLS 终结 → `127.0.0.1:18786`，SSE 不缓冲 |
| 证书 | `/etc/letsencrypt/live/tl.z736.cc.cd/` | Let's Encrypt，DNS-01（Cloudflare），systemd timer 续期 |
| cloudflared | `cloudflared-turnloom.service` | 备用通道；token 在 `/etc/cloudflared/turnloom.env`（0600） |

## 安装

```sh
# 1) 隧道账号（把 Windows 主机 ~/.ssh/codex_pocket_ed25519.pub 的内容传进去）
sudo sh deploy/relay/setup-tunnel-user.sh 'ssh-ed25519 AAAA... codextunnel@host' 18786

# 2) 证书（需要能改 DNS 的 Cloudflare token）
sudo install -d -m 0700 /root/.secrets
printf 'dns_cloudflare_api_token = <token>\n' | sudo tee /root/.secrets/cloudflare.ini >/dev/null
sudo chmod 0600 /root/.secrets/cloudflare.ini
sudo certbot certonly --dns-cloudflare --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \
  -d tl.z736.cc.cd --non-interactive --agree-tos -m <email> \
  --deploy-hook 'systemctl reload nginx'

# 3) 站点
sudo sed 's/__PUBLIC_HOST__/tl.z736.cc.cd/g' deploy/relay/nginx-turnloom.conf \
  | sudo tee /etc/nginx/sites-available/turnloom >/dev/null
sudo ln -sfn /etc/nginx/sites-available/turnloom /etc/nginx/sites-enabled/turnloom
sudo nginx -t && sudo systemctl reload nginx

# 4) 备用隧道（仅当需要时）
sudo install -d -m 0700 /etc/cloudflared
printf 'TUNNEL_TOKEN="<connector-token>"\n' | sudo tee /etc/cloudflared/turnloom.env >/dev/null
sudo chmod 0600 /etc/cloudflared/turnloom.env
sudo install -m 0644 deploy/relay/cloudflared-turnloom.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now cloudflared-turnloom
```

Windows 主机侧：`%LOCALAPPDATA%\CodexPocket\config.json` 的 `publicUrl` / `tunnel.host`
/ `machineGateway.origin` 指向该入口，`~/.ssh/known_hosts` 必须已收录中继主机键，
`scripts/link-watchdog.mjs --loop` 会在公网探测失败时自动重建隧道。

## 验收

```sh
curl -sS https://tl.z736.cc.cd/api/harnesses -H "x-access-token: <machineToken>"   # 200 + 发现 JSON
curl -sS https://tl.z736.cc.cd/api/threads?limit=3 -H "x-access-token: <harnessToken>"  # 200 + 真实会话
curl -sS https://tl.z736.cc.cd/api/app/update -H "x-access-token: <harnessToken>"   # 版本/ SHA 与发布一致
```

中继本机：`ss -lntp | grep 18786`（sshd 持有）、`systemctl status nginx cloudflared-turnloom`、
`tail /var/log/nginx/turnloom-access.log`。

## 回滚

主通道异常时把 `tl.z736.cc.cd` 的 A 记录改回 `CNAME <tunnel-id>.cfargotunnel.com`（proxied），
客户端无需改动；完全废弃时删除 sites-enabled/turnloom、证书与 `codextunnel` 用户即可。
