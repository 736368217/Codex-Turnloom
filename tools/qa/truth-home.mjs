#!/usr/bin/env node
/**
 * 2.4.0 status fixture — REAL server.js, synthetic Codex home, controlled activity.
 *
 * 三条"活会话"和分页边界是这套夹具存在的理由：
 *   - run-1/2/3：最新一页里 open turn（thinking）
 *   - wait-1/2：open turn + approval_request（interactionRequired）
 *   - run-page2：open turn，但 updated_at 排在第 61 位之后 —— 第 1 页永远看不到它
 * 55 条已结束会话把列表撑过一页。谁只过滤"已加载页"，就会数出 3+2，
 * 而真相是 4+2（wait 与 run 的关系由契约 A/B 决定，脚本只断言集合关系）。
 *
 * 这个模块只造数据，不起服务；check-active-api.mjs / check-truth.mjs 共用。
 */
import fs from "node:fs";
import path from "node:path";

export const RUN_IDS = [
  "aaaaaaaa-0000-4000-8000-000000000001",
  "aaaaaaaa-0000-4000-8000-000000000002",
  "aaaaaaaa-0000-4000-8000-000000000003"
];
export const WAIT_IDS = [
  "bbbbbbbb-0000-4000-8000-000000000001",
  "bbbbbbbb-0000-4000-8000-000000000002"
];
export const PAGE2_RUN_ID = "cccccccc-0000-4000-8000-000000000061";
export const PROJECT_NAME = "测试项目";
export const PAGE_SIZE = 60;

const uuid = (prefix, index) => `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`;

/** 一次完整 turn（开→关）。 */
function closedTurn(id, cwd, atMs, index) {
  return [
    { timestamp: new Date(atMs).toISOString(), type: "session_meta", payload: { id, cwd } },
    { timestamp: new Date(atMs + 1000).toISOString(), type: "event_msg", payload: { type: "task_started", turn_id: `${id}-t1`, started_at: Math.floor((atMs + 1000) / 1000) } },
    { timestamp: new Date(atMs + 2000).toISOString(), type: "event_msg", payload: { type: "user_message", message: `第 ${index} 条已结束的会话` } },
    { timestamp: new Date(atMs + 3000).toISOString(), type: "event_msg", payload: { type: "agent_message", message: "已经做完了。" } },
    { timestamp: new Date(atMs + 4000).toISOString(), type: "event_msg", payload: { type: "task_complete", turn_id: `${id}-t1`, completed_at: Math.floor((atMs + 4000) / 1000) } }
  ];
}

/** 只有开始、没有结束 → open turn。 */
function openTurn(id, cwd, atMs, text, approval = false) {
  const lines = [
    { timestamp: new Date(atMs).toISOString(), type: "session_meta", payload: { id, cwd } },
    { timestamp: new Date(atMs + 1000).toISOString(), type: "event_msg", payload: { type: "task_started", turn_id: `${id}-live`, started_at: Math.floor((atMs + 1000) / 1000) } },
    { timestamp: new Date(atMs + 2000).toISOString(), type: "event_msg", payload: { type: "user_message", message: text } },
    { timestamp: new Date(atMs + 3000).toISOString(), type: "event_msg", payload: { type: "agent_message", message: "开始处理。" } }
  ];
  if (approval) {
    lines.push({
      timestamp: new Date(atMs + 4000).toISOString(),
      type: "event_msg",
      payload: { type: "approval_request", request_id: `${id}-approval`, command: "rm -rf build", workdir: cwd }
    });
  }
  return lines;
}

export async function seedTruthHome(home, { nowMs = Date.now() } = {}) {
  const sessions = path.join(home, "sessions", "2026", "11", "21");
  fs.mkdirSync(sessions, { recursive: true });
  const rows = [];
  const write = (id, title, cwd, lines, atMs, archived = 0) => {
    const file = path.join(sessions, `rollout-2026-11-21T00-00-00-${id}.jsonl`);
    fs.writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
    rows.push({ id, title, cwd, rollout: path.relative(home, file), atMs, archived });
  };

  // 近 60 条：3 运行中 + 2 等授权排在最前，其余已结束。
  write(RUN_IDS[0], "运行中-1", "C:\\qa\\projects\\active\\one", openTurn(RUN_IDS[0], "C:\\qa\\projects\\active\\one", nowMs - 60_000, "跑一个长任务"), nowMs - 1000);
  write(RUN_IDS[1], "运行中-2", "C:\\qa\\projects\\active\\two", openTurn(RUN_IDS[1], "C:\\qa\\projects\\active\\two", nowMs - 70_000, "第二个长任务"), nowMs - 2000);
  write(RUN_IDS[2], "运行中-3", "C:\\qa\\projects\\active\\three", openTurn(RUN_IDS[2], "C:\\qa\\projects\\active\\three", nowMs - 80_000, "第三个长任务"), nowMs - 3000);
  write(WAIT_IDS[0], "等授权-1", "C:\\qa\\projects\\active\\four", openTurn(WAIT_IDS[0], "C:\\qa\\projects\\active\\four", nowMs - 90_000, "改一下构建脚本", true), nowMs - 4000);
  write(WAIT_IDS[1], "等授权-2", "C:\\qa\\projects\\active\\five", openTurn(WAIT_IDS[1], "C:\\qa\\projects\\active\\five", nowMs - 95_000, "清理临时目录", true), nowMs - 5000);

  for (let index = 0; index < 55; index += 1) {
    const id = uuid("dddddddd", index + 1);
    const cwd = `C:\\qa\\projects\\idle\\${String(index).padStart(2, "0")}`;
    write(id, `已结束-${String(index + 1).padStart(2, "0")}`, cwd, closedTurn(id, cwd, nowMs - 600_000 - index * 60_000, index + 1), nowMs - 10_000 - index * 1000);
  }

  // 第 61~70 位：全部早于第 1 页；其中第一条是运行中。
  write(PAGE2_RUN_ID, "第二页运行中", "C:\\qa\\projects\\active\\page2", openTurn(PAGE2_RUN_ID, "C:\\qa\\projects\\active\\page2", nowMs - 100_000, "这个任务排在第二页"), nowMs - 3_600_000);
  for (let index = 1; index < 10; index += 1) {
    const id = uuid("eeeeeeee", index);
    const cwd = `C:\\qa\\projects\\old\\${index}`;
    write(id, `很早的会话-${index}`, cwd, closedTurn(id, cwd, nowMs - 4_000_000 - index * 60_000, 100 + index), nowMs - 3_700_000 - index * 60_000);
  }

  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(home, "state_5.sqlite"));
  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY, title TEXT, rollout_path TEXT, archived INTEGER DEFAULT 0,
      created_at_ms INTEGER, updated_at_ms INTEGER, updated_at INTEGER,
      preview TEXT, cwd TEXT, model TEXT, source TEXT, thread_source TEXT, agent_path TEXT,
      is_pinned INTEGER DEFAULT 0, thread_section_id TEXT, section_position INTEGER, project_id TEXT
    );
    CREATE TABLE thread_sections (id TEXT PRIMARY KEY, name TEXT, appearance TEXT);
    CREATE TABLE thread_spawn_edges (child_thread_id TEXT, parent_thread_id TEXT);
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, position INTEGER);
    CREATE TABLE project_roots (project_id TEXT, path TEXT, position INTEGER);
  `);
  db.prepare("INSERT INTO projects (id, name, position) VALUES (?, ?, 1)").run("qa-project-active", PROJECT_NAME);
  db.prepare("INSERT INTO project_roots (project_id, path, position) VALUES (?, ?, 1)").run("qa-project-active", "C:\\qa\\projects");
  const insert = db.prepare(`
    INSERT INTO threads (id, title, rollout_path, archived, created_at_ms, updated_at_ms, updated_at, cwd, model, project_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'qa-model', 'qa-project-active')
  `);
  db.exec("BEGIN");
  for (const row of rows) {
    insert.run(row.id, row.title, row.rollout, row.archived, row.atMs - 60_000, row.atMs, Math.floor(row.atMs / 1000), row.cwd);
  }
  db.exec("COMMIT");
  db.close();
  return { total: rows.length, rows };
}

/** 结束 run-page2 的 turn：用于 ETag/缓存一致性判据（改完数字必须跟着变）。 */
export function closeTurnWithoutApproval(home, threadId, { atMs = Date.now() } = {}) {
  const dir = path.join(home, "sessions", "2026", "11", "21");
  const name = fs.readdirSync(dir).find((entry) => entry.includes(threadId));
  if (!name) throw new Error(`rollout for ${threadId} not found`);
  const file = path.join(dir, name);
  fs.appendFileSync(file, `${JSON.stringify({
    timestamp: new Date(atMs).toISOString(),
    type: "event_msg",
    payload: { type: "task_complete", turn_id: `${threadId}-live`, completed_at: Math.floor(atMs / 1000) }
  })}\n`, "utf8");
  return file;
}
