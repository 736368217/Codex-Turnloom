"use strict";

/**
 * `/api/search`（2.4.0）：标题 / 项目 / 正文三路命中，真 server.js × 合成 Codex home。
 *
 * 黑盒契约的完整版在 `tools/qa/check-search-api.mjs`（2000 会话 + 耗时 + 注入）。
 * 这里留一条**可进 `npm test` 的小样本**，钉住四个用户能感知的语义：
 *   1. 中文子串能命中正文，不只标题；
 *   2. 项目名能命中（标题和正文都不含关键词）；
 *   3. ASCII 大小写不敏感；
 *   4. `%`、`_`、引号是字面量，不是通配符；排序是标题/项目优先、正文其次。
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");

const ROOT = path.join(__dirname, "..");
const TOKEN = "search-api-probe";
const TITLE_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const CONTENT_ID = "33333333-3333-4333-8333-333333333333";
const ASCII_ID = "44444444-4444-4444-8444-444444444444";

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

function rolloutLines(id, cwd, messages) {
  const at = (offset) => new Date(Date.UTC(2026, 10, 21, 0, 0, offset)).toISOString();
  const lines = [
    { timestamp: at(0), type: "session_meta", payload: { id, cwd } },
    {
      timestamp: at(1),
      type: "event_msg",
      payload: { type: "task_started", turn_id: `${id}-t1`, started_at: Date.UTC(2026, 10, 21, 0, 0, 1) / 1000 }
    }
  ];
  messages.forEach(([role, text], index) => {
    lines.push({
      timestamp: at(2 + index),
      type: "event_msg",
      payload: { type: role === "user" ? "user_message" : "agent_message", message: text }
    });
  });
  lines.push({
    timestamp: at(60),
    type: "event_msg",
    payload: { type: "task_complete", turn_id: `${id}-t1`, completed_at: Date.UTC(2026, 10, 21, 0, 1, 0) / 1000 }
  });
  return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
}

async function seedHome(home) {
  const { DatabaseSync } = require("node:sqlite");
  const sessions = path.join(home, "sessions", "2026", "11", "21");
  fs.mkdirSync(sessions, { recursive: true });
  const write = (id, lines) => {
    const file = path.join(sessions, `rollout-2026-11-21T00-00-00-${id}.jsonl`);
    fs.writeFileSync(file, lines, "utf8");
    return path.relative(home, file);
  };
  const fixtures = [
    {
      id: TITLE_ID,
      title: "深空调试记录",
      projectId: "p-deep",
      projectName: "深空计划",
      cwd: "C:\\qa\\projects\\deepspace\\title",
      messages: [
        ["user", "帮我把这轮的记录整理一下。"],
        ["assistant", "已经整理成三条。"]
      ]
    },
    {
      id: PROJECT_ID,
      title: "周报模板",
      projectId: "p-jupiter",
      projectName: "木星计划",
      cwd: "C:\\qa\\projects\\jupiter\\weekly",
      messages: [
        ["user", "周报模板改一下。"],
        ["assistant", "模板已按上周结构更新。"]
      ]
    },
    {
      id: CONTENT_ID,
      title: "无关标题",
      projectId: "p-base",
      projectName: "基线项目",
      cwd: "C:\\qa\\projects\\base\\content",
      messages: [
        ["user", "看一下这段记录。"],
        ["assistant", "记录里写着：深空站在凌晨部署了新的中继，延迟降了一半。"]
      ]
    },
    {
      id: ASCII_ID,
      title: "覆盖率与命名",
      projectId: "p-base",
      projectName: "基线项目",
      cwd: "C:\\qa\\projects\\base\\ascii",
      messages: [
        ["user", "覆盖率多少？"],
        ["assistant", "def build is green；覆盖率 100% 通过；命名 a_b 已统一；it's fine。"]
      ]
    }
  ];

  const db = new DatabaseSync(path.join(home, "state_5.sqlite"));
  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY, title TEXT, rollout_path TEXT,
      created_at_ms INTEGER, updated_at_ms INTEGER, updated_at TEXT, archived INTEGER,
      preview TEXT, cwd TEXT, model TEXT, source TEXT, thread_source TEXT,
      agent_path TEXT, is_pinned INTEGER, thread_section_id TEXT,
      section_position INTEGER, project_id TEXT
    );
    CREATE TABLE thread_sections (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, position INTEGER);
    CREATE TABLE project_roots (project_id TEXT, path TEXT, position INTEGER);
    CREATE TABLE thread_spawn_edges (parent_thread_id TEXT, child_thread_id TEXT);
  `);
  const insertProject = db.prepare("INSERT OR IGNORE INTO projects (id, name) VALUES (?, ?)");
  const insertThread = db.prepare(
    "INSERT INTO threads (id, title, rollout_path, created_at_ms, updated_at_ms, archived, cwd, project_id) VALUES (?, ?, ?, ?, ?, 0, ?, ?)"
  );
  const now = Date.now();
  fixtures.forEach((fixture, index) => {
    insertProject.run(fixture.projectId, fixture.projectName);
    insertThread.run(
      fixture.id,
      fixture.title,
      write(fixture.id, rolloutLines(fixture.id, fixture.cwd, fixture.messages)),
      now - (index + 1) * 60_000,
      now - (index + 1) * 1000,
      fixture.cwd,
      fixture.projectId
    );
  });
  db.close();
}

async function startServer() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-search-api-"));
  const logDir = path.join(home, "logs");
  fs.mkdirSync(logDir, { recursive: true });
  await seedHome(home);
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
      const response = await fetch(`${baseUrl}${pathname}`, { headers: { "x-access-token": TOKEN } });
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

test("/api/search 命中标题、项目名与正文，%/_ 当字面量", async () => {
  const server = await startServer();
  try {
    const zh = await server.get(`/api/search?q=${encodeURIComponent("深空")}`);
    assert.equal(zh.status, 200, `server log:\n${server.log()}`);
    assert.equal(zh.body.ok, true);
    assert.equal(typeof zh.body.took, "number");
    assert.ok(Array.isArray(zh.body.results));
    const zhThreads = zh.body.results.map((row) => row.threadId);
    assert.ok(zhThreads.includes(TITLE_ID), "标题含「深空」的会话必须命中");
    assert.ok(zhThreads.includes(CONTENT_ID), "正文含「深空站」的会话必须命中");
    assert.equal(zhThreads[0], TITLE_ID, "标题命中排在正文命中之前");
    const titleHit = zh.body.results.find((row) => row.threadId === TITLE_ID);
    assert.equal(titleHit.field, "title");
    const contentHit = zh.body.results.find((row) => row.threadId === CONTENT_ID);
    assert.equal(contentHit.field, "content");
    assert.equal(contentHit.kind, "message");
    assert.match(contentHit.snippet, /深空站/);

    // 项目名命中：标题和正文都不含「木星」。
    const project = await server.get(`/api/search?q=${encodeURIComponent("木星")}`);
    assert.equal(project.status, 200);
    assert.deepEqual(project.body.results.map((row) => [row.threadId, row.field]), [[PROJECT_ID, "project"]]);

    // ASCII 大小写不敏感（服务端按 SQLite LIKE 的语义折叠 A-Z）。
    const upper = await server.get("/api/search?q=DEF");
    const lower = await server.get("/api/search?q=def");
    assert.deepEqual(upper.body.results.map((row) => row.threadId), [ASCII_ID]);
    assert.deepEqual(lower.body.results.map((row) => row.threadId), [ASCII_ID]);

    // `%` 与 `_` 是字面量：查 "100%" 只命中写着 100% 的那条；"%" 单独不能当通配。
    const percent = await server.get(`/api/search?q=${encodeURIComponent("100%")}`);
    assert.deepEqual(percent.body.results.map((row) => row.threadId), [ASCII_ID]);
    const wildcard = await server.get(`/api/search?q=${encodeURIComponent("%")}`);
    assert.deepEqual(wildcard.body.results.map((row) => row.threadId), [ASCII_ID]);
    const underscore = await server.get("/api/search?q=a_b");
    assert.deepEqual(underscore.body.results.map((row) => row.threadId), [ASCII_ID]);

    // 空查询必须 400，不是把所有会话倒出来。
    const empty = await server.get("/api/search?q=");
    assert.equal(empty.status, 400);
    assert.equal(empty.body.ok, false);

    // 列表契约不被搜索改动：status/state 仍在每行上。
    const list = await server.get("/api/threads?limit=10");
    assert.equal(list.status, 200);
    assert.equal(list.body.threads.length, 4);
    for (const row of list.body.threads) {
      assert.ok(row.status && typeof row.status.thinking === "boolean");
      assert.ok(["running", "waiting", "ended"].includes(row.status.state));
      assert.ok(list.body.active && Array.isArray(list.body.active.running) && Array.isArray(list.body.active.waiting));
    }
  } finally {
    await server.stop();
  }
});
