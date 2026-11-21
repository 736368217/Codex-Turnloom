"use strict";

/**
 * 运行中状态的两条「人真正在等」的缺陷（2.4.0，Task #19）：
 *
 *   L1 长回合：turn 的开始事件被后续输出挤出 512 KiB 尾部窗口。
 *      真相 = running；旧实现只解析尾部窗口 → ended。
 *   L2 静默等授权：open turn 里有人工审批，文件已经 15 分钟没写。
 *      真相 = waiting（thinking 仍为真）；旧实现 stale 把两者一起抹掉 → ended。
 *
 * 还有一条与分页有关的契约：`/api/threads.active` 必须与当前页无关 ——
 * 运行中的会话落在第 2 页时，第 1 页的响应里也要数到它。
 *
 * 全部用合成 home + 真 server.js，跑的是和用户同一条代码路径。
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");

const ROOT = path.join(__dirname, "..");
const TOKEN = "thread-status-probe";
const LONG_RUN = "aaaaaaaa-1111-4111-8111-111111111111";
const LONG_ENDED = "aaaaaaaa-2222-4222-8222-222222222222";
const STALE_WAIT = "bbbbbbbb-1111-4111-8111-111111111111";
const PAGE2_RUN = "cccccccc-1111-4111-8111-111111111111";
const WIDE_RUN = "eeeeeeee-1111-4111-8111-111111111111";
const IDLE = [
  "dddddddd-1111-4111-8111-111111111111",
  "dddddddd-2222-4222-8222-222222222222",
  "dddddddd-3333-4333-8333-333333333333"
];

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const at = (ms) => new Date(ms).toISOString();

function eventLine(ms, payload) {
  return JSON.stringify({ timestamp: at(ms), type: "event_msg", payload });
}

function metaLine(ms, id, cwd) {
  return JSON.stringify({ timestamp: at(ms), type: "session_meta", payload: { id, cwd } });
}

/** 一条 > 4 MiB 的 rollout：开始事件在文件头，后面全是输出（把开始事件挤出尾部窗口）。 */
function longRollout(id, cwd, { ended = false, nowMs = Date.now(), bytes = 5 * 1024 * 1024 } = {}) {
  const lines = [
    metaLine(nowMs - 600_000, id, cwd),
    eventLine(nowMs - 599_000, { type: "task_started", turn_id: `${id}-live`, started_at: Math.floor((nowMs - 599_000) / 1000) }),
    eventLine(nowMs - 598_000, { type: "user_message", message: "跑一个很长的任务，边跑边输出" })
  ];
  const chunk = "正在整理章节内容，补充数据与结论。".repeat(40);
  let written = lines.reduce((sum, line) => sum + Buffer.byteLength(line) + 1, 0);
  let index = 0;
  while (written < bytes - 64 * 1024) {
    const line = eventLine(nowMs - 590_000 + index * 1000, { type: "agent_message", message: `${index} ${chunk}` });
    lines.push(line);
    written += Buffer.byteLength(line) + 1;
    index += 1;
  }
  if (ended) {
    lines.push(eventLine(nowMs - 1_000, { type: "task_complete", turn_id: `${id}-live`, completed_at: Math.floor((nowMs - 1_000) / 1000) }));
  }
  return `${lines.join("\n")}\n`;
}

function staleApprovalRollout(id, cwd, nowMs) {
  const lines = [
    metaLine(nowMs - 900_000, id, cwd),
    eventLine(nowMs - 899_000, { type: "task_started", turn_id: `${id}-live`, started_at: Math.floor((nowMs - 899_000) / 1000) }),
    eventLine(nowMs - 898_000, { type: "user_message", message: "删掉旧的构建目录" }),
    eventLine(nowMs - 880_000, { type: "approval_request", request_id: `${id}-approval`, command: "rm -rf build", workdir: cwd })
  ];
  return `${lines.join("\n")}\n`;
}

function openTurnRollout(id, cwd, nowMs) {
  const lines = [
    metaLine(nowMs - 120_000, id, cwd),
    eventLine(nowMs - 119_000, { type: "task_started", turn_id: `${id}-live`, started_at: Math.floor((nowMs - 119_000) / 1000) }),
    eventLine(nowMs - 118_000, { type: "user_message", message: "这个任务排在候选窗口之外" })
  ];
  return `${lines.join("\n")}\n`;
}

async function seedHome(home) {
  const { DatabaseSync } = require("node:sqlite");
  const sessions = path.join(home, "sessions", "2026", "11", "21");
  fs.mkdirSync(sessions, { recursive: true });
  const nowMs = Date.now();
  const rows = [];
  const write = (id, title, text, updatedAtMs) => {
    const file = path.join(sessions, `rollout-2026-11-21T00-00-00-${id}.jsonl`);
    fs.writeFileSync(file, text, "utf8");
    rows.push({ id, title, rollout: path.relative(home, file), updatedAtMs, file });
  };

  write(LONG_RUN, "长回合-未结束", longRollout(LONG_RUN, "C:\\qa\\projects\\long\\run", { nowMs }), nowMs - 1_000);
  write(LONG_ENDED, "长回合-已结束", longRollout(LONG_ENDED, "C:\\qa\\projects\\long\\ended", { ended: true, nowMs }), nowMs - 2_000);
  write(STALE_WAIT, "静默等授权", staleApprovalRollout(STALE_WAIT, "C:\\qa\\projects\\stale", nowMs), nowMs - 880_000);
  // 真实世界里「静默 15 分钟」的文件 mtime 也是 15 分钟前；刚写出来的文件 mtime=now
  // 会让 stale 判定永远不触发，等于没测到。
  const staleAt = (nowMs - 880_000) / 1000;
  fs.utimesSync(rows.find((row) => row.id === STALE_WAIT).file, staleAt, staleAt);
  write(PAGE2_RUN, "第 2 页的运行中", longRollout(PAGE2_RUN, "C:\\qa\\projects\\page2", { nowMs }), nowMs - 3_600_000);
  IDLE.forEach((id, index) => {
    const lines = [
      metaLine(nowMs - 700_000, id, `C:\\qa\\projects\\idle\\${index}`),
      eventLine(nowMs - 699_000, { type: "task_started", turn_id: `${id}-t1`, started_at: Math.floor((nowMs - 699_000) / 1000) }),
      eventLine(nowMs - 698_000, { type: "agent_message", message: "已经做完了。" }),
      eventLine(nowMs - 697_000, { type: "task_complete", turn_id: `${id}-t1`, completed_at: Math.floor((nowMs - 697_000) / 1000) })
    ];
    write(id, `已结束-${index + 1}`, `${lines.join("\n")}\n`, nowMs - 5_000 - index * 1_000);
  });

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
  const insert = db.prepare(`
    INSERT INTO threads (id, title, rollout_path, archived, created_at_ms, updated_at_ms, updated_at, cwd, model)
    VALUES (?, ?, ?, 0, ?, ?, ?, ?, 'qa-model')
  `);
  for (const row of rows) {
    insert.run(row.id, row.title, row.rollout, row.updatedAtMs - 60_000, row.updatedAtMs, Math.floor(row.updatedAtMs / 1000), "C:\\qa\\projects");
  }
  db.close();
}

async function seedWideHome(home) {
  const { DatabaseSync } = require("node:sqlite");
  const sessions = path.join(home, "sessions", "2026", "11", "21");
  fs.mkdirSync(sessions, { recursive: true });
  const nowMs = Date.now();
  const rows = [];
  const write = (id, title, text, updatedAtMs) => {
    const file = path.join(sessions, `rollout-2026-11-21T00-00-00-${id}.jsonl`);
    fs.writeFileSync(file, text, "utf8");
    rows.push({ id, title, rollout: path.relative(home, file), updatedAtMs });
  };
  // 130 条已结束会话占满候选窗口（120 行），一条运行中排在第 131 位。
  for (let index = 0; index < 130; index += 1) {
    const id = `ffffffff-0000-4000-8000-${String(index).padStart(12, "0")}`;
    const lines = [
      metaLine(nowMs - 700_000, id, `C:\\qa\\projects\\wide\\${index}`),
      eventLine(nowMs - 699_000, { type: "task_started", turn_id: `${id}-t1`, started_at: Math.floor((nowMs - 699_000) / 1000) }),
      eventLine(nowMs - 698_000, { type: "agent_message", message: "已经做完了。" }),
      eventLine(nowMs - 697_000, { type: "task_complete", turn_id: `${id}-t1`, completed_at: Math.floor((nowMs - 697_000) / 1000) })
    ];
    write(id, `窗口内已结束-${index}`, `${lines.join("\n")}\n`, nowMs - 1_000 - index * 1_000);
  }
  write(WIDE_RUN, "窗口外运行中", openTurnRollout(WIDE_RUN, "C:\\qa\\projects\\wide\\beyond", nowMs), nowMs - 10_000_000);

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
  const insert = db.prepare(`
    INSERT INTO threads (id, title, rollout_path, archived, created_at_ms, updated_at_ms, updated_at, cwd, model)
    VALUES (?, ?, ?, 0, ?, ?, ?, ?, 'qa-model')
  `);
  for (const row of rows) {
    insert.run(row.id, row.title, row.rollout, row.updatedAtMs - 60_000, row.updatedAtMs, Math.floor(row.updatedAtMs / 1000), "C:\\qa\\projects");
  }
  db.close();
}

async function startServer(seed = seedHome) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-status-window-"));
  const logDir = path.join(home, "logs");
  fs.mkdirSync(logDir, { recursive: true });
  await seed(home);
  const port = await freePort();
  const child = spawn(
    process.execPath,
    ["server.js", "--port", String(port), "--host", "127.0.0.1", "--token", TOKEN, "--codex-home", home],
    {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, LOCALAPPDATA: path.join(logDir, "localappdata"), TURNLOOM_LOG_DIR: logDir }
    }
  );
  let log = "";
  child.stdout.on("data", (chunk) => { log += chunk.toString(); });
  child.stderr.on("data", (chunk) => { log += chunk.toString(); });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { headers: { "x-access-token": TOKEN } });
      if (response.status === 200) break;
    } catch { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return {
    baseUrl,
    log: () => log,
    get: async (pathname) => {
      const response = await fetch(`${baseUrl}${pathname}`, {
        headers: { "x-access-token": TOKEN },
        signal: AbortSignal.timeout(60_000)
      });
      return { status: response.status, body: await response.json().catch(() => ({})) };
    },
    stop: async () => {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5000);
        child.once("exit", () => { clearTimeout(timer); resolve(); });
      });
      fs.rmSync(home, { recursive: true, force: true });
    }
  };
}

test("长会话的 running 与静默 waiting 都不再被尾部窗口/10 分钟 stale 抹掉", async () => {
  const server = await startServer();
  try {
    const list = await server.get("/api/threads?limit=60");
    assert.equal(list.status, 200, `server log:\n${server.log()}`);
    const rows = new Map(list.body.threads.map((row) => [row.id, row]));
    const statusOf = (id) => rows.get(id)?.status || {};

    // L1：开始事件在 5 MB 外，旧实现这里必是 ended。
    assert.equal(statusOf(LONG_RUN).state, "running");
    assert.equal(statusOf(LONG_RUN).thinking, true);
    const longDetail = await server.get(`/api/threads/${LONG_RUN}/messages?limit=5`);
    assert.equal(longDetail.body.status.state, "running");
    assert.equal(longDetail.body.status.thinking, true);

    // 同一份大文件、末尾补一条 task_complete：必须真的变成 ended，不能见 start 就永远 running。
    assert.equal(statusOf(LONG_ENDED).state, "ended");
    assert.equal(statusOf(LONG_ENDED).thinking, false);

    // L2：mtime 15 分钟前 + 未处理的 approval_request。
    assert.equal(statusOf(STALE_WAIT).state, "waiting");
    assert.equal(statusOf(STALE_WAIT).thinking, true);
    assert.equal(statusOf(STALE_WAIT).interactionRequired, true);
    assert.ok(!statusOf(STALE_WAIT).staleTurn, "等授权不是「卡死的回合」，不该打 stale 标");
    const staleDetail = await server.get(`/api/threads/${STALE_WAIT}/messages?limit=5`);
    assert.equal(staleDetail.body.status.state, "waiting");
    assert.equal(staleDetail.body.status.thinking, true);
    assert.equal(staleDetail.body.status.interactionRequired, true);

    // active 与分页无关：第 2 页的运行中必须在第 1 页的响应里被数到。
    const firstTwo = await server.get("/api/threads?limit=2");
    const pageIds = firstTwo.body.threads.map((row) => row.id);
    assert.equal(pageIds.length, 2);
    assert.ok(!pageIds.includes(PAGE2_RUN), "第 2 页那条不能出现在第 1 页");
    const active = firstTwo.body.active || {};
    const runningIds = (active.running || []).map((row) => row.id);
    const waitingIds = (active.waiting || []).map((row) => row.id);
    assert.ok(runningIds.includes(LONG_RUN));
    assert.ok(runningIds.includes(PAGE2_RUN), "active.running 必须包含第 2 页的运行中");
    assert.ok(waitingIds.includes(STALE_WAIT));
    assert.equal(active.truncated, false);
    // A 口径：两组不相交，相加 = 活会话数（这里是 2 运行 + 1 等待）。
    assert.equal(runningIds.filter((id) => waitingIds.includes(id)).length, 0);
    assert.equal(runningIds.length, 2);
    assert.equal(waitingIds.length, 1);
    for (const row of active.running) {
      assert.ok(Number(row.startedAtMs) > 0, `running.startedAtMs 必须是真实时间：${JSON.stringify(row)}`);
      assert.equal(typeof row.title, "string");
      assert.equal(typeof row.project, "string");
    }
    for (const row of active.waiting) {
      assert.equal(row.reason, "interaction");
    }

    // 本页行与 active 同源：同一行的状态不能在两个地方打架。
    for (const row of firstTwo.body.threads) {
      assert.equal(row.status.state, statusOf(row.id).state);
    }
  } finally {
    await server.stop();
  }
});

test("候选窗口被截断时 active.truncated 为 true，不把下界当完整", async () => {
  const server = await startServer(seedWideHome);
  try {
    const list = await server.get("/api/threads?limit=2");
    assert.equal(list.status, 200, `server log:\n${server.log()}`);
    const active = list.body.active || {};
    const runningIds = (active.running || []).map((row) => row.id);
    assert.equal(typeof active.truncated, "boolean");
    // 130 条已结束 + 1 条运行中，候选窗口只有 120 行：窗口外的行没有解析状态。
    // 要么把它数进来，要么明说数字是下界；两样都没有就是假装完整。
    assert.ok(
      active.truncated === true || runningIds.includes(WIDE_RUN),
      `truncated=${active.truncated} running=${runningIds.length}`
    );
    assert.equal(active.truncated, true);
    assert.equal(runningIds.includes(WIDE_RUN), false, "窗口外那条没有解析状态，不能被当成已知");
  } finally {
    await server.stop();
  }
});
