# 后端状态上报（Adapter Status）

Turnloom 默认从 rollout 尾部推断会话状态。非 Codex 后端可以让 Codex 兼容数据目录
`state_5.sqlite` 的 `threads` 表携带状态列，或调用 HTTP 接口直接上报，从而跳过
rollout 解析并获得准确的 `running` / `waiting` / `ended`。

## 方式 A：状态列（推荐）

在 `state_5.sqlite` 中增加以下可选列；Turnloom 会在启动后自动探测，缺列时完全回退到原有
rollout 逻辑：

```sql
ALTER TABLE threads ADD COLUMN status_state TEXT;        -- running | waiting | ended
ALTER TABLE threads ADD COLUMN status_turn_id TEXT;
ALTER TABLE threads ADD COLUMN status_started_ms INTEGER;
ALTER TABLE threads ADD COLUMN status_updated_ms INTEGER;
```

- `status_updated_ms` 必须是毫秒时间戳；只有距今小于 `--status-max-age-minutes`（默认 60）的状态才会被采用。
- `status_state = 'ended'` 同样会直接生效，并跳过 rollout 解析。
- 适配器应定期刷新 `status_updated_ms`，例如每 30 秒一次；否则状态过期后会自动回退。
- `status_started_ms` 用于手机端的“已运行时长”。

## 方式 B：HTTP 接口

```http
POST /api/adapters/status
x-access-token: <access-code>
content-type: application/json

{
  "threadId": "c2bb6025-eae3-4363-a2a8-91736193eb7a",
  "state": "running",
  "turnId": "turn-1",
  "startedAtMs": 1792742531000,
  "ttlMs": 60000
}
```

- `state`：`running`、`waiting`、`ended`。
- `ttlMs`：可选，默认 `--status-max-age-minutes`；最短 1 秒，最长 24 小时。
- 再次上报同一会话会刷新状态；`state: "clear"` 或 `clear: true` 可撤销。
- `GET /api/adapters/status` 查看当前内存中的覆盖项。
- `DELETE /api/adapters/status?threadId=<id>` 撤销单个覆盖项。

内存覆盖优先于状态列，状态列优先于 rollout 推断。

## 诊断

```http
GET /api/admin/diagnostics
x-access-token: <access-code>
```

返回内容包含：

- `threads.statusColumns`：实际探测到的 `status_*` 列；
- `rolloutIssues`：缺失/越界 rollout 的 thread id 及原因（最多 100 条）；
- `adapterStatus`：当前内存覆盖项；
- `sqlite`：实际使用的驱动（`node:sqlite` 或 `sqlite3-cli`）及查询计数；
- `settings`：当前生效的过期时间窗口。

## 启动参数

```text
--active-turn-stale-minutes <n>   rollout 回退判活的静默阈值，默认 10
--status-max-age-minutes <n>      状态列/接口覆盖的信任窗口，默认 60
--sqlite-driver auto|node|cli     SQLite 驱动选择，默认 auto
```
