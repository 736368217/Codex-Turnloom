"use strict";
/**
 * 共享 turn_queue 回归测试。
 *
 * 用户反馈：手机端排队消息在桌面端看不见，桌面端再排队时无法判断谁先谁后。
 * 本测试用临时 SQLite 数据库复刻 PI 的 turn_queue，加载桥源码时把 PI_DB
 * 重定向到它，绝不碰正在运行的 pi.sqlite。
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");

const SRC = path.join(__dirname, "plugin", "main.js");
const TMP_PIPE = `\\\\.\\pipe\\turnloom-queue-test-${Date.now()}`;
const outDir = path.join(os.tmpdir(), `turnloom-queue-test-${Date.now()}`);
const dbPath = path.join(outDir, "pi.sqlite");
fs.mkdirSync(outDir, { recursive: true });

let source = fs.readFileSync(SRC, "utf8");
const before = source;
source = source.replace(
  'const PIPE_PATH = "\\\\\\\\.\\\\pipe\\\\pidesktop-codex-ipc";',
  `const PIPE_PATH = ${JSON.stringify(TMP_PIPE)};`,
);
if (source === before) throw new Error("could not redirect PIPE_PATH — refusing to run against the live pipe");
source = source.replace(
  'const PI_DB = resolvePiDb();',
  `const PI_DB = ${JSON.stringify(dbPath)};`,
);
source += "\nmodule.exports = { nativeQueuePush, nativeQueueList, nativeQueueRemove, nativeQueueSteer, nativeQueueRows, handleAction };\n";
for (const name of ["codex-side.cjs", "manifest.json"]) {
  fs.copyFileSync(path.join(path.dirname(SRC), name), path.join(outDir, name));
}
const testFile = path.join(outDir, "main.js");
fs.writeFileSync(testFile, source, "utf8");

const db = new DatabaseSync(dbPath);
db.exec(`
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    deleted_at INTEGER
  );
  CREATE TABLE turn_queue (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    principal TEXT NOT NULL,
    idempotency_key TEXT,
    input_hash TEXT NOT NULL,
    content TEXT NOT NULL,
    attachments_json TEXT,
    session_message_id TEXT,
    user_message_id TEXT,
    permission_mode TEXT NOT NULL,
    position INTEGER NOT NULL,
    priority INTEGER,
    created_at INTEGER NOT NULL,
    voice_origin_json TEXT
  );
  CREATE UNIQUE INDEX idx_turn_queue_idempotency
    ON turn_queue(session_id, principal, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
`);
db.prepare("INSERT INTO sessions (id, title) VALUES (?, ?)").run("session-shared", "共享队列");
db.close();

global.pi = {
  desktop: {
    invoke: async () => ({ ok: true }),
  },
};
const plugin = require(testFile);
const threadId = "session-shared";

(async () => {
  // 模拟桌面端自己在权威表里先排一条。
  const seed = new DatabaseSync(dbPath);
  seed.prepare(`INSERT INTO turn_queue (
    id, session_id, principal, input_hash, content, permission_mode, position, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    "desktop-first", threadId, "desktop", "hash-desktop", "桌面先排", "inherit", 1, Date.now() - 1000
  );
  seed.close();

  const pushed = await plugin.nativeQueuePush({
    sessionId: threadId,
    threadId,
    content: "手机后排",
    clientRequestId: "phone-request-1",
  });
  assert.equal(pushed.duplicate, false, "手机端应写入新的队列项");
  assert.equal(pushed.sessionId, threadId);

  const duplicate = await plugin.nativeQueuePush({
    sessionId: threadId,
    threadId,
    content: "手机后排",
    clientRequestId: "phone-request-1",
  });
  assert.equal(duplicate.duplicate, true, "重复请求不能产生第二条消息");
  assert.equal(duplicate.id, pushed.id, "重复请求返回原队列项");

  let entries = plugin.nativeQueueList({ threadId }).entries;
  assert.deepEqual(entries.map((row) => row.content), ["桌面先排", "手机后排"], "普通排队按 position FIFO");

  await plugin.nativeQueueSteer({ threadId, itemId: pushed.id });
  entries = plugin.nativeQueueList({ threadId }).entries;
  assert.deepEqual(entries.map((row) => row.content), ["手机后排", "桌面先排"], "设为优先后按 PI priority 先发");
  const prioritized = entries.find((row) => row.id === pushed.id);
  assert.equal(prioritized.priority, 1, "设为优先的项带 priority，PI 执行时会先取它");

  const removed = await plugin.nativeQueueRemove({ threadId, itemId: "desktop-first" });
  assert.equal(removed.cancelled, 1);
  assert.deepEqual(removed.entries.map((row) => row.content), ["手机后排"]);

  await plugin.nativeQueueRemove({ threadId });
  assert.equal(plugin.nativeQueueList({ threadId }).entries.length, 0, "清空后两端都不应再看到队列");

  // 通过 IPC 门面方法调用，确认 Turnloom 与桥使用同一套协议。
  const ipcPush = await plugin.handleAction("turnloom/queue/push", {
    threadId,
    content: "经 IPC 排队",
    clientRequestId: "phone-request-2",
  }, 0);
  assert.equal(ipcPush.source, "pi-native");
  const ipcList = await plugin.handleAction("turnloom/queue/list", { threadId }, 0);
  assert.equal(ipcList.entries.length, 1);
  assert.equal(ipcList.entries[0].content, "经 IPC 排队");

  fs.rmSync(outDir, { recursive: true, force: true });
  console.log("PASS shared PI turn_queue: desktop-first FIFO, phone append, dedupe, priority, remove, IPC bridge");
})().catch((error) => {
  console.error("FAIL", error);
  process.exitCode = 1;
});
