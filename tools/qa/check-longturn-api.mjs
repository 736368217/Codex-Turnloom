#!/usr/bin/env node
/**
 * 2.4.0 状态修复的"长会话 + 静默等授权"对照——真 server.js × 真 10 MB rollout。
 *
 * 两条缺陷都只在"人真正在等"的会话上出现，短的测试会话永远看起来是对的：
 *   L1 长回合：turn 的开始事件落在文件尾部窗口（512 KiB）之外。一个跑了很久、
 *      输出很多的 turn 就会这样。真相 = running；尾部解析 = ended。
 *   L2 静默等授权：open turn 里有人工审批，已经静默超过 10 分钟。真相 = waiting；
 *      stale 判定把 visibleActiveTurn 置空后，interactionRequired 一起变假。
 *
 * 文件是真实 transcript（本机 ~/.codex 里 10.6 MB 那条），只在末尾追加
 * "turn 继续产出"的 700 KiB —— 我们无法让一条历史会话重新跑起来，但可以复现
 * "开始事件在 512 KiB 之外"这个唯一相关的条件，而且这是真实文件、真实体积。
 *
 *   node tools/qa/check-longturn-api.mjs [--json tmp/longturn.json] [--keep]
 *
 * 退出码 1 = 有判据失败；修复前跑一次就是"改前"的证据（state=ended）。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const argOf = (name, fallback = "") => {
  const key = `--${name}`;
  const index = argv.indexOf(key);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : fallback;
};
const JSON_OUT = argOf("json", "");
const KEEP = argv.includes("--keep");
const TOKEN = "qa-longturn-api-token";
const LONG_ID = "f0000000-0000-4000-8000-000000000001";
const STALE_ID = "f0000000-0000-4000-8000-000000000002";
const TAIL_WINDOW = 512 * 1024;
const REAL_ROLLOUT = path.join(os.homedir(), ".codex", "sessions", "2026", "08", "21", "rollout-2026-08-21T12-53-51-01a022ab-0f6c-7e02-a0d6-14c86159b95c.jsonl");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
function check(id, pass, detail = "") {
  results.push({ id, pass: Boolean(pass), detail });
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${id}${detail ? ` — ${detail}` : ""}`);
}
function note(text) {
  console.log(`  [INFO] ${text}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

let baseUrl = "";
let server = null;

async function startServer(home, logDir) {
  const port = await freePort();
  const child = spawn(process.execPath, [
    "server.js", "--host", "127.0.0.1", "--port", String(port), "--token", TOKEN,
    "--codex-home", home
  ], {
    cwd: REPO, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    env: { ...process.env, LOCALAPPDATA: path.join(logDir, "localappdata"), TURNLOOM_LOG_DIR: logDir }
  });
  let log = "";
  child.stdout.on("data", (chunk) => { log += chunk.toString(); });
  child.stderr.on("data", (chunk) => { log += chunk.toString(); });
  baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { headers: { "x-access-token": TOKEN } });
      if (response.status === 200) { server = { child, log: () => log }; return; }
    } catch { /* not listening */ }
    await sleep(150);
  }
  child.kill();
  throw new Error(`server did not become ready\n${log}`);
}

async function stopServer() {
  if (!server) return;
  const { child } = server;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
  server = null;
}

async function get(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: { "x-access-token": TOKEN }, signal: AbortSignal.timeout(120_000)
  });
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text || "{}"); } catch { data = { raw: text.slice(0, 300) }; }
  return { status: response.status, data };
}

async function seed(home) {
  const day = path.join(home, "sessions", "2026", "11", "21");
  fs.mkdirSync(day, { recursive: true });
  const now = Date.now();
  const at = (offset) => new Date(now + offset).toISOString();

  // L1：真实 10.6 MB transcript + 末尾 700 KiB 续写，task_started 落在尾部窗口外
  const longFile = path.join(day, `rollout-2026-11-21T00-00-00-${LONG_ID}.jsonl`);
  const real = fs.readFileSync(REAL_ROLLOUT);
  fs.writeFileSync(longFile, real);
  const head = [
    { timestamp: at(-300_000), type: "event_msg", payload: { type: "task_started", turn_id: "long-live", started_at: Math.floor((now - 300_000) / 1000) } },
    { timestamp: at(-299_000), type: "event_msg", payload: { type: "user_message", message: "继续把这份报告补完，边跑边输出" } }
  ];
  fs.appendFileSync(longFile, `${head.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
  const chunk = [];
  for (let index = 0; index < 700; index += 1) {
    chunk.push(JSON.stringify({
      timestamp: at(-290_000 + index * 1000),
      type: "event_msg",
      payload: { type: "agent_message", message: `第 ${index} 段输出：${"正在整理章节内容，补充数据与结论。".repeat(20)}` }
    }));
  }
  fs.appendFileSync(longFile, `${chunk.join("\n")}\n`, "utf8");
  const afterStart = fs.statSync(longFile).size - (real.length + head.reduce((sum, line) => sum + Buffer.byteLength(JSON.stringify(line)) + 1, 0));
  const distanceFromEnd = fs.statSync(longFile).size - (real.length + Buffer.byteLength(JSON.stringify(head[0])) + 1);

  // L2：open turn + 审批，静默 15 分钟（默认 stale 窗口 10 分钟）
  const staleFile = path.join(day, `rollout-2026-11-21T00-00-00-${STALE_ID}.jsonl`);
  const staleLines = [
    { timestamp: at(-900_000), type: "session_meta", payload: { id: STALE_ID, cwd: "C:\\qa\\projects\\stale" } },
    { timestamp: at(-899_000), type: "event_msg", payload: { type: "task_started", turn_id: "stale-live", started_at: Math.floor((now - 899_000) / 1000) } },
    { timestamp: at(-898_000), type: "event_msg", payload: { type: "user_message", message: "删掉旧的构建目录" } },
    { timestamp: at(-880_000), type: "event_msg", payload: { type: "approval_request", request_id: "req-stale", command: "rm -rf build", workdir: "C:\\qa\\projects\\stale" } }
  ];
  fs.writeFileSync(staleFile, `${staleLines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
  // 真实世界里"静默 15 分钟"的文件 mtime 也是 15 分钟前；刚写出来的文件
  // mtime=now 会让 stale 判定永远不触发，等于没测到。
  const staleAt = (now - 880_000) / 1000;
  fs.utimesSync(staleFile, staleAt, staleAt);

  const { DatabaseSync } = (await import("node:sqlite"));
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
  insert.run(LONG_ID, "长会话-真实 10MB", path.relative(home, longFile), now - 300_000, now - 1000, Math.floor((now - 1000) / 1000), "C:\\qa\\projects\\long");
  insert.run(STALE_ID, "等授权-静默 15 分钟", path.relative(home, staleFile), now - 900_000, now - 880_000, Math.floor((now - 880_000) / 1000), "C:\\qa\\projects\\stale");
  db.close();
  return { longFile, afterStart, distanceFromEnd };
}

async function main() {
  if (!fs.existsSync(REAL_ROLLOUT)) {
    console.log(`  [SKIP] real rollout not present: ${REAL_ROLLOUT}`);
    process.exit(0);
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-longturn-api-"));
  const home = path.join(root, "home");
  const logDir = path.join(root, "logs");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  const seeded = await seed(home);
  note(`home: ${home} · long rollout ${(fs.statSync(seeded.longFile).size / 1024 / 1024).toFixed(1)} MiB · task_started 距文件尾 ${(Math.floor(seeded.distanceFromEnd / 1024))} KiB（尾部窗口 ${TAIL_WINDOW / 1024} KiB）`);

  try {
    await startServer(home, logDir);
    const list = await get("/api/threads?limit=10");
    const rows = list.data?.threads || [];
    const longRow = rows.find((row) => row.id === LONG_ID) || {};
    const staleRow = rows.find((row) => row.id === STALE_ID) || {};
    const listStatus = (id) => rows.find((row) => row.id === id)?.status || {};
    const longDetail = await get(`/api/threads/${LONG_ID}/messages?limit=5`);
    const staleDetail = await get(`/api/threads/${STALE_ID}/messages?limit=5`);

    // L1：列表与详情必须说同一句话；真相是 running
    const longListStatus = listStatus(LONG_ID);
    const longDetailStatus = longDetail.data?.status || {};
    check("long.list.running", longListStatus.state === "running" && longListStatus.thinking === true,
      `state=${longListStatus.state} thinking=${longListStatus.thinking}`);
    check("long.detail.running", longDetailStatus.thinking === true, `thinking=${longDetailStatus.thinking}`);
    check("long.list.detail.agree", longListStatus.thinking === longDetailStatus.thinking,
      `list=${longListStatus.thinking} detail=${longDetailStatus.thinking}`);

    // L2：静默审批仍是 waiting，且 thinking 仍为真（活回合没结束）
    const staleListStatus = listStatus(STALE_ID);
    const staleDetailStatus = staleDetail.data?.status || {};
    check("stale.list.waiting", staleListStatus.state === "waiting" && staleListStatus.interactionRequired === true,
      `state=${staleListStatus.state} interaction=${staleListStatus.interactionRequired} staleTurn=${staleListStatus.staleTurn}`);
    check("stale.list.thinking", staleListStatus.thinking === true, `thinking=${staleListStatus.thinking}`);
    check("stale.list.detail.agree", staleListStatus.interactionRequired === staleDetailStatus.interactionRequired,
      `list=${staleListStatus.interactionRequired} detail=${staleDetailStatus.interactionRequired}`);

    // active 契约（若已落地）：两条都必须能进对应的组
    const active = list.data?.active;
    if (active) {
      const runningIds = (active.running || []).map((row) => row.id);
      const waitingIds = (active.waiting || []).map((row) => row.id);
      check("long.active.running", runningIds.includes(LONG_ID), `running=${runningIds.length}`);
      check("stale.active.waiting", waitingIds.includes(STALE_ID), `waiting=${waitingIds.length}`);
    } else {
      note("`active` 未落地，跳过两条 active 判据（不算失败）。");
    }

    note(`long row title=${JSON.stringify(longRow.title)} stale row title=${JSON.stringify(staleRow.title)}`);
  } finally {
    await stopServer();
    if (KEEP) note(`kept: ${root}`);
    else fs.rmSync(root, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    const failed = results.filter((row) => !row.pass);
    console.log(`\n${results.length - failed.length} PASS / ${failed.length} FAIL`);
    if (JSON_OUT) {
      fs.mkdirSync(path.dirname(path.resolve(REPO, JSON_OUT)), { recursive: true });
      fs.writeFileSync(path.resolve(REPO, JSON_OUT), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
      console.log(`report: ${JSON_OUT}`);
    }
    process.exit(failed.length ? 1 : 0);
  })
  .catch((error) => {
    console.error(error?.stack || error);
    process.exit(1);
  });
