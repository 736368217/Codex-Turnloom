# Turnloom 改进第一轮（P0 修复 + P2 性能）

本轮按 `TURNLOOM-IMPROVEMENTS.zh-CN.md` 的优先级，先处理会直接影响手机端使用的
P0 缺陷，并顺带完成几项低风险 P2 项；P1（后端适配器 / profile）留作下一轮。

## 已处理

| 编号 | 处理结果 |
|---|---|
| P0-1 | 所有 `execFile` / `spawn` 统一走 `execFileHidden` / `spawnHidden`，默认 `windowsHide: true`；新增回归测试，禁止裸调。 |
| P0-2 | `resolveRolloutPath()` 改为按行隔离：单条 rollout 缺失/越界只影响该会话（`state: unknown`），不会让 `/api/threads` 500；新增 `GET /api/admin/diagnostics` 汇总缺失/越界 rollout。 |
| P0-3 | 新增可选状态列探测（`status_state` / `status_turn_id` / `status_started_ms` / `status_updated_ms`）与 `POST /api/adapters/status` 内存覆盖接口（带 TTL）；列表与详情均优先采用适配器状态。`--status-max-age-minutes` 控制信任窗口，`--active-turn-stale-minutes` 控制 rollout 回退判活阈值。 |
| P2-1 | rollout 状态按 `(size, mtimeMs)` 缓存 15 秒，并把状态解析并发限制为 12；重复 `/api/threads` 不再全量重解析。 |
| P2-2 | SQLite 查询优先 `node:sqlite`，CLI 仅兜底（`--sqlite-driver auto|node|cli`）。本机实测查询路径 `cliQueries=0`。 |
| P2-3 | `/api/threads` 支持 `?limit=&cursor=` 与 `ETag` / `304`；Web 端增加条件请求缓存。 |
| P2-4 | `[models] Using fallback model list` 同一原因 10 分钟内只记一次。 |

## 验证

- `npm run check` 通过。
- 旧数据兼容：facade 数据库没有状态列时自动回退 rollout 解析，无需迁移。
- 本机 8799 实例已重启并加载新代码；`/api/threads` 返回 76 个会话，`ETag` 条件请求返回 `304`。
- `npm test`：83 项全部通过（其中本轮新增 7 项；其余 76 项为既有服务端/前端/桌面控制台回归）。
- P0-2 验收：临时把一条 `rollout_path` 改成 `C:\nowhere\x.jsonl`，`/api/threads` 仍返回 200，诊断接口列出该 thread id。
- P0-3 验收：`POST /api/adapters/status` 标记 `running` 后列表/详情立即显示运行中；TTL 到期后回退。
- P2-1 实测（76 会话）：冷启动 669 ms，9 秒后 23 ms，17 秒后 107 ms。
- P2-2 实测：`/api/admin/diagnostics` 显示 `driver=node:sqlite`、`nodeQueries=4`、`cliQueries=0`。

## 新增接口 / 参数

```text
GET  /api/admin/diagnostics        诊断：状态列、坏 rollout、SQLite 驱动、缓存
GET  /api/adapters/status          查看内存状态覆盖
POST /api/adapters/status          上报 { threadId, state, turnId, startedAtMs, ttlMs }
DELETE /api/adapters/status?threadId=...
```

```text
--active-turn-stale-minutes <n>
--status-max-age-minutes <n>
--sqlite-driver auto|node|cli
```

详细契约见 [后端状态上报](ADAPTER_STATUS.zh-CN.md)。

> 状态通道说明：当前 8799 由 PI-Desktop 桥插件的 rollout 推断驱动；在桥插件尚未写入
> `status_*` 列（或调用 `POST /api/adapters/status`）之前，静默超过 10 分钟的运行中任务仍会
> 回退为 `ended`。服务端 P0-3 已就绪，桥端接入后即可消除该误判。

## 尚未处理（下一轮）

- P1-1 HTTP 后端适配器（`--backend http`）。
- P1-2 profile / 单端口多设备 / 独立口令。
- P3-1 同源双设备 `localStorage` key 隔离、P3-2 Android 扫码去重、P3-3 访问码换短期会话。
