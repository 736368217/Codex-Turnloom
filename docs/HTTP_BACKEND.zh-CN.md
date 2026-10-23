# HTTP 后端适配器

Turnloom 默认读取 Codex 的 `CODEX_HOME`。使用 `--backend http` 时，Turnloom 不读写
任何 Codex 文件，而是通过下面这组 HTTP 接口工作；一个约 100 行的服务即可接入任意
agent（PI-Desktop、其他 CLI agent 等）。

## 启动

```powershell
node server.js --port 8790 --password desk-code `
  --backend http `
  --backend-url http://127.0.0.1:9000 `
  --backend-token adapter-secret
```

## 接口契约

所有响应使用 JSON。Turnloom 会把 `--backend-token` 同时放在
`x-access-token` 和 `Authorization: Bearer <token>` 头里。

### `GET /threads`

```json
[
  {
    "id": "thread-1",
    "title": "A task",
    "updatedAtMs": 1792742531000,
    "preview": "",
    "cwd": "D:/work",
    "model": "gpt-5",
    "pinned": false,
    "archived": false,
    "projectId": "p1",
    "projectName": "Project One",
    "status": {
      "state": "running",
      "turnId": "turn-1",
      "startedAtMs": 1792742531000
    }
  }
]
```

`state` 可为 `running` / `waiting` / `ended`；也接受 `in_progress`、`needs_input`、
`completed` 等别名。

### `GET /threads/:id/messages?limit=&before=`

```json
{
  "thread": { "id": "thread-1", "title": "A task" },
  "messages": [
    { "role": "user", "kind": "message", "content": "hello", "timestamp": "2026-10-23T08:00:00.000Z" }
  ],
  "status": { "state": "running", "turnId": "turn-1" },
  "totalMessages": 1
}
```

`thread` 必须在 `/threads` 列表中存在；否则 Turnloom 返回 404，从而保证 profile
之间不能互相读取会话。

### `POST /threads/:id/messages`

请求：`{ "text": "hello", "images": [] }`；响应：`{ "ok": true }`。

### `POST /threads`

请求：`{ "text": "hello" }`；响应：`{ "threadId": "thread-2" }`。

### `POST /threads/:id/interrupt`

响应：`{ "ok": true }`。

### 扩展能力（可选）

以下接口按需实现，未实现时对应操作会返回后端错误，不影响浏览/发送/中断：

```text
POST   /threads/:id/pin              { pinned }
GET    /threads/:id/goal             -> { goal }
PUT    /threads/:id/goal             { objective, status }
DELETE /threads/:id/goal
POST   /threads/:id/compact          -> { ok }
POST   /threads/:id/branch           { lastTurnId, beforeTurnId } -> { thread }
POST   /approval                     { threadId, requestId, decision, approvalKind }
POST   /queue/cancel                 { threadId, itemId, edit }
POST   /queue/steer                  { threadId, itemId }
GET    /threads/:id/changes?cursor=  -> { cursor, changed }
```

`/api/account`、`/api/plugins`、`/api/skills` 在 HTTP 模式下返回安全的空值，不访问本地 Codex 数据。

## Profile（单端口多设备）

`--profiles profiles.json` 可以同时提供多个后端和独立访问码：

```json
[
  { "id": "codex", "label": "Codex", "token": "codex-code", "backend": "codex", "home": "D:\\codex\\.codex" },
  { "id": "pidesk", "label": "PI-Desktop", "token": "pidesk-code", "backend": "http", "backendUrl": "http://127.0.0.1:9000", "backendToken": "adapter-secret" }
]
```

- 每个 token 只路由到自己的后端；跨 profile 的 thread id 返回 404。
- `/api/health` 回显 `profile`（id/label/backend）与 `backend.kind`。
- 同一个 profiles 文件可以包含多个 Codex home 和多个 HTTP 后端；每个 profile 的缓存与 thread 列表相互隔离。
