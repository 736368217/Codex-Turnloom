# Turnloom 改进第二轮（P1 适配器 / Profile / P3-2）

## 已完成

| 编号 | 内容 |
|---|---|
| P1-1 | 新增 `backends/http-backend.js`，Turnloom 可用 `--backend http --backend-url ... --backend-token ...` 完整浏览会话、读取消息、发送消息、中断任务；默认 `--backend codex` 行为不变，HTTP 模式不读写任何 `CODEX_HOME` 文件。 |
| P1-2 | 新增 `--profiles <path>`：同一端口按 token 路由到不同的 Codex home 或 HTTP 后端；`/api/health` 回显 profile 与 backend；跨 profile 读取 thread id 返回 404。 |
| P3-2 | Android 扫码导入去重键从 URL 全串改为 `(origin, token)`，同源不同访问码的两台设备不再被合并。 |

## 使用方式

```powershell
# 单 HTTP 后端
node server.js --port 8790 --password desk-code `
  --backend http --backend-url http://127.0.0.1:9000 --backend-token adapter-secret

# Codex + PI-Desktop 同端口
node server.js --port 8790 --profiles profiles.json
```

```json
[
  { "id": "codex", "label": "Codex", "token": "codex-code", "backend": "codex", "home": "D:\\codex\\.codex" },
  { "id": "pidesk", "label": "PI-Desktop", "token": "pidesk-code", "backend": "http", "backendUrl": "http://127.0.0.1:9000", "backendToken": "adapter-secret" }
]
```

HTTP 契约见 [HTTP 后端适配器](HTTP_BACKEND.zh-CN.md)。

## 验证

- `npm run check` 通过。
- `npm test`：92 项全部通过。
- 用临时 mock HTTP 适配器验证：`/api/threads`、`/api/threads/:id/messages`、`/api/send`、`/api/interrupt` 全部走通。
- Profile 验证：两个 Codex home token 分别看到 66 / 80 个会话，双向跨 profile thread id 均返回 404。
- HTTP 模式下 account/plugins/skills 返回安全空值；pin/goal/compact/branch/approval/queue 按扩展契约透传。

## 当前边界

- HTTP 模式的 pin/goal/compact/branch/approval/queue 已透传到扩展契约；插件/技能/账号返回安全空值，不访问本地 Codex 数据。
- 同一个 profiles 文件支持多个 Codex home 与多个 HTTP profile，线程列表缓存按 home 隔离。
- P3-1 已实现：localStorage key 支持 `?device=` / `#d=` 设备后缀，profile 二维码带 profile id。P3-3 已实现：token 可换 8 小时 HttpOnly session cookie，`/login` 302 去除 query，并支持 `/api/auth/logout` 吊销。
