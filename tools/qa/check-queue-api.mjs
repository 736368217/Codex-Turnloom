#!/usr/bin/env node
/**
 * 2.3.0 queue server contract check — REAL server.js, synthetic Codex home.
 *
 * Why this exists next to check-queue.mjs: the UI suite drives a contract
 * fixture; this suite drives the shipped `server.js` queue implementation with
 * a temporary `--codex-home`, a real rollout, the real queue JSON file and the
 * real HTTP routes. No Codex Desktop is touched and no private data is read.
 *
 *   node tools/qa/check-queue-api.mjs
 *   node tools/qa/check-queue-api.mjs --json tmp/queue-api.json
 *
 * Exit code 1 when any criterion fails.
 */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const argOf = (name, fallback = "") => {
  const key = String(name).startsWith("--") ? String(name) : `--${name}`;
  const index = argv.indexOf(key);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const JSON_OUT = argOf("--json", "");
const TOKEN = "qa-queue-api-token";
const THREAD_ID = "qa-queue-api-thread";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
function check(id, pass, detail = "") {
  results.push({ id, pass: Boolean(pass), detail });
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${id}${detail ? ` — ${detail}` : ""}`);
}

const PNG = fs.readFileSync(path.join(REPO, "tools/qa/fixtures/queue-photo.png"));
const PNG_B64 = PNG.toString("base64");
const FILE_B64 = Buffer.from("hello from the queue fixture\n", "utf8").toString("base64");

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

async function waitForReady(baseUrl, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { headers: { "x-access-token": TOKEN } });
      if (response.status === 200) return;
    } catch { /* not listening yet */ }
    await sleep(150);
  }
  throw new Error("server did not become ready");
}

function seedHome(home) {
  fs.mkdirSync(path.join(home, "sessions"), { recursive: true });
  const nowMs = Date.now();
  const rollout = path.join(home, "sessions", "rollout-qa-queue.jsonl");
  const lines = [
    { timestamp: new Date(nowMs - 90_000).toISOString(), type: "session_meta", payload: { id: THREAD_ID, cwd: REPO } },
    { timestamp: new Date(nowMs - 90_000).toISOString(), type: "event_msg", payload: { type: "user_message", message: "继续跑队列验收" } },
    // An open turn keeps the queue from draining; this test owns the queue file,
    // so the queue must stay put while the contract is exercised.
    { timestamp: new Date(nowMs - 80_000).toISOString(), type: "event_msg", payload: { type: "task_started", turn_id: "turn-qa-1", started_at: Math.floor((nowMs - 80_000) / 1000) } },
  ];
  fs.writeFileSync(rollout, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
  return import("node:sqlite").then(({ DatabaseSync }) => {
    const db = new DatabaseSync(path.join(home, "state_5.sqlite"));
    db.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT, rollout_path TEXT, archived INTEGER DEFAULT 0, updated_at_ms INTEGER, cwd TEXT);");
    db.prepare("INSERT INTO threads (id, title, rollout_path, archived, updated_at_ms, cwd) VALUES (?, ?, ?, 0, ?, ?)").run(
      THREAD_ID, "队列接口验收", rollout, nowMs, REPO
    );
    db.close();
  });
}

let server = null;
let baseUrl = "";
let home = "";
let queueFile = "";
let logDir = "";

async function startServer() {
  const port = server?.port || await freePort();
  const child = spawn(process.execPath, [
    "server.js",
    "--host", "127.0.0.1",
    "--port", String(port),
    "--token", TOKEN,
    "--codex-home", home,
    "--active-turn-stale-minutes", "600",
  ], {
    cwd: REPO,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: {
      ...process.env,
      LOCALAPPDATA: path.join(logDir, "localappdata"),
      TURNLOOM_LOG_DIR: logDir,
      CODEX_LAN_PENDING_QUEUE_FILE: queueFile,
    },
  });
  let log = "";
  child.stdout.on("data", (chunk) => { log += chunk.toString(); });
  child.stderr.on("data", (chunk) => { log += chunk.toString(); });
  const started = { child, port, log: () => log };
  baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForReady(baseUrl);
  } catch (error) {
    child.kill();
    throw new Error(`${error.message}\n--- server log ---\n${log}`);
  }
  server = started;
  await sleep(300);
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
  await sleep(200);
}

async function api(pathname, { method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { "x-access-token": TOKEN, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text || "{}"); } catch { data = { raw: text }; }
  return { status: response.status, data };
}

function queueDocument() {
  return JSON.parse(fs.readFileSync(queueFile, "utf8"));
}
function writeQueueDocument(doc) {
  fs.writeFileSync(queueFile, JSON.stringify(doc, null, 2), "utf8");
}
function queueItems(doc) {
  return (doc.queues && doc.queues[THREAD_ID]) || [];
}
function item(text, extra = {}) {
  return {
    id: `qa-item-${Math.random().toString(36).slice(2, 8)}`,
    text,
    images: [],
    files: [],
    turnSettings: { model: "", effort: "" },
    enqueuedAt: new Date().toISOString(),
    lastError: null,
    nextAttemptAtMs: 0,
    deliveryState: "queued",
    deliveryBaseline: 0,
    deliveryTurnId: null,
    deliveryAttemptedAtMs: 0,
    ...extra,
  };
}
function writeQueue(items, paused = []) {
  writeQueueDocument({ version: 2, updatedAt: new Date().toISOString(), paused, queues: { [THREAD_ID]: items } });
}

async function status() {
  const response = await api(`/api/queue/status?threadId=${encodeURIComponent(THREAD_ID)}`);
  return response;
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-queue-api-"));
  home = path.join(root, "home");
  logDir = path.join(root, "logs");
  queueFile = path.join(root, "pending-queues.json");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  await seedHome(home);

  try {
    await startServer();

    // 1. Empty queue shape
    let response = await status();
    check("status.empty", response.status === 200 && response.data.queueLength === 0 && Array.isArray(response.data.queuedMessages) && response.data.queuePaused === false, JSON.stringify(response.data).slice(0, 180));
    check("status.threadId", response.data.threadId === THREAD_ID);
    check("status.capabilities.local", response.data.queueCapabilities?.turnSteer === true && response.data.queueCapabilities?.queueFiles === true, JSON.stringify(response.data.queueCapabilities));

    // 2. Enqueue text through the real POST /api/send
    response = await api("/api/send", { method: "POST", body: { threadId: THREAD_ID, message: "A 第一条排队", mode: "queue" } });
    check("enqueue.text.ok", response.status === 200 && response.data.queued === true && response.data.queueLength === 1, JSON.stringify(response.data).slice(0, 200));
    check("enqueue.text.item", response.data.queueItem?.text === "A 第一条排队" && response.data.queueItem?.position === 1, JSON.stringify(response.data.queueItem));

    // 3. Enqueue image + ordinary file
    response = await api("/api/send", {
      method: "POST",
      body: {
        threadId: THREAD_ID,
        message: "B 带图和文件",
        mode: "queue",
        images: [{ name: "photo.png", mimeType: "image/png", data: PNG_B64 }],
        files: [{ name: "log.txt", mimeType: "text/plain", data: FILE_B64 }],
      },
    });
    check("enqueue.attachments.ok", response.status === 200 && response.data.queueLength === 2, JSON.stringify(response.data).slice(0, 200));

    response = await status();
    const queued = response.data.queuedMessages || [];
    const b = queued.find((row) => row.text === "B 带图和文件");
    check("status.positions.continuous", JSON.stringify(queued.map((row) => row.position)) === "[1,2]", JSON.stringify(queued.map((row) => row.position)));
    check("status.text.is.user.original", b?.text === "B 带图和文件" && !/scratch|\.txt|photo\.png/.test(String(b?.text || "")) && !!b, JSON.stringify(b?.text));
    check("status.image.meta", b?.imageCount === 1 && b?.images?.[0]?.mimeType === "image/png" && /\/api\/queue\/image\?/.test(b?.images?.[0]?.url || ""), JSON.stringify(b?.images));
    check("status.file.meta", b?.fileCount === 1 && b?.files?.[0]?.name === "log.txt" && b?.files?.[0]?.size === Buffer.from(FILE_B64, "base64").length, JSON.stringify(b?.files));

    // 4. Reorder B up
    const bId = b?.id;
    response = await api("/api/queue/reorder", { method: "POST", body: { threadId: THREAD_ID, itemId: bId, direction: "up" } });
    check("reorder.up.ok", response.status === 200 && response.data.moved === true, JSON.stringify(response.data).slice(0, 160));
    response = await status();
    check("reorder.up.order", response.data.queuedMessages?.[0]?.text === "B 带图和文件" && response.data.queuedMessages?.[0]?.position === 1, JSON.stringify(response.data.queuedMessages?.map((row) => row.text)));
    response = await api("/api/queue/reorder", { method: "POST", body: { threadId: THREAD_ID, itemId: bId, direction: "sideways" } });
    check("reorder.invalid.direction", response.status === 400, JSON.stringify(response.data));

    // 5. Cancel edit returns text/images/files for the exact item
    response = await api("/api/queue/cancel", { method: "POST", body: { threadId: THREAD_ID, itemId: bId, edit: true } });
    check("cancel.edit.ok", response.status === 200 && response.data.draft?.text === "B 带图和文件", JSON.stringify(response.data).slice(0, 200));
    check("cancel.edit.images", response.data.draft?.images?.[0]?.data === PNG_B64 && response.data.draft?.images?.[0]?.mimeType === "image/png");
    check("cancel.edit.files", response.data.draft?.files?.[0]?.data === FILE_B64 && response.data.draft?.files?.[0]?.name === "log.txt");

    // 6. Persistence on disk (schema 2 + files + paused array)
    writeQueue([
      item("D 第一条"),
      item("E 第二条", { files: [{ name: "note.txt", mimeType: "text/plain", data: FILE_B64, size: 27, sha256: "" }] }),
    ]);
    await stopServer();
    const doc = queueDocument();
    check("persist.schema", doc.version === 2 && Array.isArray(doc.paused) && doc.paused.length === 0, JSON.stringify({ version: doc.version, paused: doc.paused }));
    check("persist.files", queueItems(doc)[1]?.files?.[0]?.data === FILE_B64, JSON.stringify(queueItems(doc)[1]?.files));
    await startServer();
    response = await status();
    check("restart.restores.order", JSON.stringify(response.data.queuedMessages?.map((row) => row.text)) === JSON.stringify(["D 第一条", "E 第二条"]));
    check("restart.positions", JSON.stringify(response.data.queuedMessages?.map((row) => row.position)) === "[1,2]");

    // 7. Paused flag survives a restart and resume clears it
    await stopServer();
    const pausedDoc = queueDocument();
    pausedDoc.paused = [THREAD_ID];
    writeQueueDocument(pausedDoc);
    await startServer();
    response = await status();
    check("restart.paused", response.data.queuePaused === true, JSON.stringify(response.data.queuePaused));
    response = await api("/api/queue/resume", { method: "POST", body: { threadId: THREAD_ID } });
    check("resume.ok", response.status === 200 && response.data.queuePaused === false, JSON.stringify(response.data).slice(0, 160));
    response = await status();
    check("resume.persisted", response.data.queuePaused === false && response.data.queueLength === 2);

    // 8. 20-item cap: the API rejects the 21st with a readable reason
    await stopServer();
    writeQueue(Array.from({ length: 20 }, (_, index) => item(`容量 ${index + 1}`)));
    await startServer();
    response = await api("/api/send", { method: "POST", body: { threadId: THREAD_ID, message: "第 21 条", mode: "queue" } });
    check("limit.21.rejected", response.status === 409 && /队列已满/.test(String(response.data.error || "")), JSON.stringify(response.data).slice(0, 200));
    check("limit.code", response.data.code === "queue_full", String(response.data.code));
    response = await status();
    check("limit.queue.unchanged", response.data.queueLength === 20);

    // 9. Busy / failed items refuse mutations with the same copy the UI uses
    await stopServer();
    writeQueue([
      item("队首发送中", { deliveryState: "sending" }),
      item("后面的排队项"),
    ]);
    await startServer();
    response = await api("/api/queue/reorder", { method: "POST", body: { threadId: THREAD_ID, itemId: queueItems(queueDocument())[1]?.id, direction: "up" } });
    check("busy.reorder.409", response.status === 409 && /正在发送/.test(String(response.data.error || "")), JSON.stringify(response.data).slice(0, 160));

    await stopServer();
    writeQueue([
      item("失败项", { deliveryState: "failed", lastError: "电脑端连接中断" }),
      item("失败项后面"),
    ]);
    const failedDoc = queueDocument();
    const failedId = queueItems(failedDoc)[0].id;
    const behindId = queueItems(failedDoc)[1].id;
    await startServer();
    response = await api("/api/queue/reorder", { method: "POST", body: { threadId: THREAD_ID, itemId: failedId, direction: "down" } });
    check("failed.reorder.rejected", response.status === 409 && /先重试、编辑或删除/.test(String(response.data.error || "")), JSON.stringify(response.data).slice(0, 200));
    response = await api("/api/queue/reorder", { method: "POST", body: { threadId: THREAD_ID, itemId: behindId, direction: "up" } });
    check("failed.cross-row.rejected", response.status === 409 && /先重试、编辑或删除/.test(String(response.data.error || "")), JSON.stringify(response.data).slice(0, 200));
    response = await api("/api/queue/cancel", { method: "POST", body: { threadId: THREAD_ID, itemId: behindId, edit: false } });
    check("failed.cancel.allowed", response.status === 200 && response.data.queueLength === 1, JSON.stringify(response.data).slice(0, 160));
  } finally {
    await stopServer();
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* windows lock */ }
  }

  const failed = results.filter((row) => !row.pass);
  let head = "";
  try { head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim(); } catch { /* not a git checkout */ }
  const serverBytes = fs.readFileSync(path.join(REPO, "server.js"));
  const report = {
    generatedAt: new Date().toISOString(),
    head,
    server: "server.js (synthetic --codex-home, active turn, temp queue file)",
    serverBytes: serverBytes.length,
    serverSha256: createHash("sha256").update(serverBytes).digest("hex"),
    pass: results.length - failed.length,
    fail: failed.length,
    results,
  };
  fs.mkdirSync(path.join(REPO, "docs/qa/queue-final"), { recursive: true });
  fs.writeFileSync(path.join(REPO, "docs/qa/queue-final/api-report.json"), JSON.stringify(report, null, 2), "utf8");
  if (JSON_OUT) fs.writeFileSync(path.resolve(REPO, JSON_OUT), JSON.stringify(report, null, 2), "utf8");
  console.log(`\n[queue-api] ${report.pass} PASS / ${report.fail} FAIL · report docs/qa/queue-final/api-report.json`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 2;
});
