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
- `npm test`：87 项全部通过。
- 用临时 mock HTTP 适配器验证：`/api/threads`、`/api/threads/:id/messages`、`/api/send`、`/api/interrupt` 全部走通。
- Profile 验证：`codex-token` 看到 76 个 Codex 会话，`http-token` 看到 2 个 HTTP 会话；双向跨 profile thread id 均返回 404。
- HTTP 后端模式下 `/api/account` 等未支持接口返回 501，不会误读本地 Codex 数据。

## 当前边界

- HTTP 模式暂不支持插件、技能、goal、置顶、compact、branch、审批和发送队列；这些接口返回 501。
- 同一 profiles 文件目前只允许一个 Codex home；多个 HTTP profile 不受限制。
- P3-1（同源双设备 localStorage key）与 P3-3（访问码换短期会话）待下一轮；P3-1 需要与 Web 端并行的 UI 改动合并后再做。
