"use strict";

/**
 * `/api/threads` 的 preview（2.2.4，task:59b0e07c）。
 *
 * 真机问题：列表第二行显示 UUID —— 因为 `threads.preview` 一直是空的，前端
 * `preview || cwd || id` 掉到了 id。契约：preview 必须是"最后一句可读文本"，
 * 取不到就是空串；服务端永不返回 id/path 当 preview。
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");

const ROOT = path.join(__dirname, "..");
const TOKEN = "threads-preview-probe";
const THREAD_WITH_HISTORY = "preview-thread-history";
const THREAD_WITHOUT_HISTORY = "preview-thread-empty";
const THREAD_WITH_STORED_PREVIEW = "preview-thread-stored";

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

async function seedHome(home) {
  const { DatabaseSync } = await import("node:sqlite");
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
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE thread_spawn_edges (parent_thread_id TEXT, child_thread_id TEXT);
  `);
  const rolloutDir = path.join(home, "sessions", "2026", "11", "19");
  fs.mkdirSync(rolloutDir, { recursive: true });
  const rollout = path.join(rolloutDir, `rollout-2026-11-19T05-00-00-${THREAD_WITH_HISTORY}.jsonl`);
  const lines = [
    { timestamp: "2026-11-19T05:00:00.000Z", type: "session_meta", payload: { id: THREAD_WITH_HISTORY, cwd: home } },
    { timestamp: "2026-11-19T05:00:01.000Z", type: "event_msg", payload: { type: "user_message", message: "你好，帮我看一下这个" } },
    { timestamp: "2026-11-19T05:00:02.000Z", type: "event_msg", payload: { type: "agent_message", message: "收到，我先看看代码。\n第二行不该进预览。" } },
  ];
  fs.writeFileSync(rollout, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  const now = Date.now();
  const insert = db.prepare("INSERT INTO threads (id, title, rollout_path, created_at_ms, updated_at_ms, archived, preview, cwd) VALUES (?, ?, ?, ?, ?, 0, '', ?)");
  insert.run(THREAD_WITH_HISTORY, "有历史的会话", path.relative(home, rollout), now - 1000, now, home);
  insert.run(THREAD_WITHOUT_HISTORY, "没有历史的会话", "", now - 2000, now - 10, home);
  db.prepare("INSERT INTO threads (id, title, rollout_path, created_at_ms, updated_at_ms, archived, preview, cwd) VALUES (?, ?, ?, ?, ?, 0, ?, ?)").run(THREAD_WITH_STORED_PREVIEW, "已有预览的会话", "", now - 3000, now - 20, ["第一行", "第二行 " + "长".repeat(200)].join(String.fromCharCode(10)), home);
  db.close();
}

async function startServer() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-preview-"));
  await seedHome(home);
  const port = await freePort();
  const child = spawn(process.execPath, ["server.js", "--port", String(port), "--host", "127.0.0.1", "--token", TOKEN, "--codex-home", home], {
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let log = "";
  child.stdout.on("data", (chunk) => { log += chunk.toString(); });
  child.stderr.on("data", (chunk) => { log += chunk.toString(); });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/app/update-public`);
      if (response.status < 500) break;
    } catch { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return {
    home,
    baseUrl,
    log: () => log,
    stop: async () => {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5000);
        child.once("exit", () => { clearTimeout(timer); resolve(); });
      });
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

test("会话列表的 preview 是最后一句，不是 id；没有历史时为空白", async () => {
  const server = await startServer();
  try {
    const response = await fetch(`${server.baseUrl}/api/threads?limit=10`, { headers: { "x-access-token": TOKEN } });
    assert.equal(response.status, 200, `server log:\n${server.log()}`);
    const body = await response.json();
    const rows = new Map(body.threads.map((thread) => [thread.id, thread]));

    const withHistory = rows.get(THREAD_WITH_HISTORY);
    assert.ok(withHistory, "有历史的会话必须在列表里");
    assert.equal(withHistory.preview, "收到，我先看看代码。 第二行不该进预览。");

    const withoutHistory = rows.get(THREAD_WITHOUT_HISTORY);
    assert.ok(withoutHistory, "无历史的会话也要在列表里");
    assert.equal(withoutHistory.preview, "");
    // Codex 自己写进库的 preview 也要被归一：单行、120 字、不留换行。
    const stored = rows.get(THREAD_WITH_STORED_PREVIEW);
    assert.ok(stored, "已有预览的会话必须在列表里");
    assert.doesNotMatch(stored.preview, /\n/);
    assert.ok(stored.preview.startsWith("第一行 第二行 长"));
    assert.ok(stored.preview.length <= 121, `preview too long: ${stored.preview.length}`);
    // 硬规则：preview 里永远不许出现 id 或路径。
    for (const row of body.threads) {
      assert.notEqual(row.preview, row.id);
      assert.doesNotMatch(String(row.preview || ""), new RegExp(row.id, "i"));
      assert.doesNotMatch(String(row.preview || ""), /[A-Za-z]:\\|\/sessions\//);
    }
  } finally {
    await server.stop();
  }
});


