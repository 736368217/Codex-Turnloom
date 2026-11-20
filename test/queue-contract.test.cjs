"use strict";

/**
 * 2.3.0 queue contract (§3 QUEUE_SPEC).
 *
 * The phone previously had no queue entry point, but the server-side queue is
 * the part that must stay honest: ordering, pause/resume, draft round-trip,
 * ordinary files persisted with the item, and a restart that does not send a
 * paused queue behind the user's back.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { createHash } = require("node:crypto");

const ROOT = path.join(__dirname, "..");
const TOKEN = "queue-contract-probe";
const THREAD_A = "queue-contract-thread-a";
const THREAD_B = "queue-contract-thread-b";

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

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function queueItem(id, text, { files = [], images = [], deliveryState = "queued" } = {}) {
  return {
    id,
    text,
    images,
    files,
    turnSettings: { model: "", effort: "" },
    enqueuedAt: "2026-11-20T12:00:00.000Z",
    lastError: null,
    nextAttemptAtMs: 0,
    deliveryState,
    deliveryBaseline: 0,
    deliveryTurnId: null,
    deliveryAttemptedAtMs: 0
  };
}

async function seedHome(home) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(home, "state_5.sqlite"));
  db.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT, rollout_path TEXT, updated_at_ms INTEGER, cwd TEXT);");
  const insert = db.prepare("INSERT INTO threads VALUES (?, ?, ?, ?, ?)");
  insert.run(THREAD_A, "Queue A", "", Date.now(), home);
  insert.run(THREAD_B, "Queue B", "", Date.now(), home);
  db.close();
}

async function waitForReady(baseUrl) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/app/update-public`);
      if (response.status === 200) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("server did not become ready within 30s");
}

async function startServer({ home, queueFile }) {
  const port = await freePort();
  const child = spawn(process.execPath, [
    "server.js", "--port", String(port), "--host", "127.0.0.1",
    "--token", TOKEN, "--codex-home", home
  ], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, CODEX_LAN_PENDING_QUEUE_FILE: queueFile }
  });
  let log = "";
  child.stdout.on("data", (chunk) => { log += chunk.toString(); });
  child.stderr.on("data", (chunk) => { log += chunk.toString(); });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForReady(baseUrl);
  } catch (error) {
    child.kill("SIGTERM");
    throw new Error(`${error.message}\n--- server log ---\n${log}`);
  }
  return {
    baseUrl,
    log: () => log,
    async stop() {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5000);
        child.once("exit", () => { clearTimeout(timer); resolve(); });
      });
    }
  };
}

async function api(baseUrl, route, { method = "GET", body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (auth) headers["x-access-token"] = TOKEN;
  const response = await fetch(baseUrl + route, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = await response.json();
  return { status: response.status, json };
}

test("queue reorder is one step or to the head and never displaces a sending item", async () => {
  const { reorderedQueuedSendItems } = await import("../server.js");
  const queue = [
    queueItem("a", "A"),
    queueItem("b", "B"),
    queueItem("c", "C", { deliveryState: "failed" })
  ];

  assert.deepEqual(
    reorderedQueuedSendItems(queue, "b", "up").queue.map((item) => item.id),
    ["b", "a", "c"]
  );
  assert.deepEqual(
    reorderedQueuedSendItems(queue, "b", "down").queue.map((item) => item.id),
    ["a", "c", "b"]
  );
  assert.deepEqual(
    reorderedQueuedSendItems(queue, "b", "top").queue.map((item) => item.id),
    ["b", "a", "c"]
  );
  assert.equal(reorderedQueuedSendItems(queue, "a", "up").changed, false);

  // A failed item must be resolved, not bypassed by reordering it or by
  // letting the next message jump over it.
  assert.throws(() => reorderedQueuedSendItems(queue, "c", "top"), /先重试、编辑或删除这条消息/);
  assert.throws(() => reorderedQueuedSendItems(queue, "c", "up"), /先重试、编辑或删除这条消息/);
  const failedHead = [queueItem("bad", "BAD", { deliveryState: "failed" }), queueItem("next", "NEXT")];
  assert.throws(() => reorderedQueuedSendItems(failedHead, "next", "up"), /先重试、编辑或删除这条消息/);
  assert.throws(() => reorderedQueuedSendItems(failedHead, "next", "top"), /先重试、编辑或删除这条消息/);

  const busy = [queueItem("a", "A", { deliveryState: "sending" }), queueItem("b", "B")];
  assert.throws(() => reorderedQueuedSendItems(busy, "a", "down"), /正在发送，暂时不能修改/);
  assert.throws(() => reorderedQueuedSendItems(busy, "b", "top"), /正在发送，暂时不能修改/);
  assert.throws(() => reorderedQueuedSendItems(queue, "missing", "up"), /已发送或已移除/);
  assert.throws(() => reorderedQueuedSendItems(queue, "a", "sideways"), /调整方向无效/);
});

test("a sending or awaiting item cannot be cancelled or edited (same 409 copy as the UI)", async () => {
  const { setPendingSendQueue, cancelQueuedSend } = await import("../server.js");
  const key = "queue-contract-unit-busy";
  const busy = (state) => queueItem("busy", "busy", { deliveryState: state });
  for (const state of ["sending", "awaitingConfirmation"]) {
    setPendingSendQueue(key, [busy(state)]);
    await assert.rejects(
      cancelQueuedSend(key, "busy"),
      (error) => error.status === 409 && error.message === "正在发送，暂时不能修改。"
    );
    await assert.rejects(
      cancelQueuedSend(key, "busy", { edit: true }),
      (error) => error.status === 409 && error.message === "正在发送，暂时不能修改。"
    );
  }
  setPendingSendQueue(key, []);
});

test("persisted queue schema keeps ordinary files, pause state, and reads v1 documents", async () => {
  const {
    normalizePersistedQueuedSendItem,
    pendingSendQueueDocument
  } = await import("../server.js");
  const data = Buffer.from("hello queue").toString("base64");
  const restored = normalizePersistedQueuedSendItem({
    id: "with-file",
    text: "带文件的排队",
    images: [],
    files: [{ name: "log.txt", mimeType: "text/plain", data }],
    deliveryState: "sending"
  });
  assert.equal(restored.files.length, 1);
  assert.equal(restored.files[0].name, "log.txt");
  assert.equal(restored.files[0].data, data);
  assert.equal(restored.files[0].size, 11);
  assert.equal(restored.files[0].sha256, sha256("hello queue"));
  // A crash mid-send must re-check confirmation, never blindly resend.
  assert.equal(restored.deliveryState, "awaitingConfirmation");

  const legacy = normalizePersistedQueuedSendItem({ id: "old", text: "v1 item", images: [] });
  assert.ok(legacy);
  assert.deepEqual(legacy.files, []);

  const document = pendingSendQueueDocument(
    new Map([["thread-a", [normalizePersistedQueuedSendItem({ id: "x", text: "x", images: [] })]]]),
    new Set(["thread-a"])
  );
  assert.equal(document.version, 2);
  assert.deepEqual(document.paused, ["thread-a"]);
  assert.equal(document.queues["thread-a"][0].id, "x");
  assert.deepEqual(document.queues["thread-a"][0].files, []);
});

test("queue HTTP contract: status, files, reorder, draft, cap, pause across restart", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-queue-contract-"));
  const home = path.join(root, "home");
  const queueFile = path.join(root, "pending-queues.json");
  fs.mkdirSync(home, { recursive: true });
  await seedHome(home);

  const fileData = Buffer.from("hello queue").toString("base64");
  const fileItem = queueItem("a3", "带文件的排队", {
    files: [{ name: "log.txt", mimeType: "text/plain", data: fileData, size: 11, sha256: sha256("hello queue") }]
  });
  const twenty = Array.from({ length: 20 }, (_, index) => queueItem(`b${index + 1}`, `B${index + 1}`));
  fs.writeFileSync(queueFile, JSON.stringify({
    version: 2,
    paused: [THREAD_A, THREAD_B],
    queues: {
      [THREAD_A]: [queueItem("a1", "第一条"), queueItem("a2", "第二条"), fileItem],
      [THREAD_B]: twenty
    }
  }), "utf8");

  let server = await startServer({ home, queueFile });
  let stopped = false;
  try {
    await t.test("status exposes order, file metadata, and pause without leaking bytes", async () => {
      const { status, json } = await api(server.baseUrl, `/api/queue/status?threadId=${THREAD_A}`);
      assert.equal(status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.queueLength, 3);
      assert.equal(json.queuePaused, true);
      assert.equal(json.queueSource, "local");
      assert.deepEqual(json.queueCapabilities, { turnSteer: true, queueFiles: true });
      assert.deepEqual(json.queuedMessages.map((item) => item.position), [1, 2, 3]);
      assert.deepEqual(json.queuedMessages.map((item) => item.text), ["第一条", "第二条", "带文件的排队"]);
      assert.equal(json.queuedMessages[2].fileCount, 1);
      assert.equal(json.queuedMessages[2].files[0].name, "log.txt");
      assert.equal(json.queuedMessages[2].files[0].size, 11);
      assert.equal(json.queuedMessages[2].files[0].data, undefined);
    });

    await t.test("reorder moves by one and to the head, persists, and keeps positions contiguous", async () => {
      let result = await api(server.baseUrl, "/api/queue/reorder", {
        method: "POST", body: { threadId: THREAD_A, itemId: "a3", direction: "top" }
      });
      assert.equal(result.status, 200);
      assert.deepEqual(result.json.queuedMessages.map((item) => item.id), ["a3", "a1", "a2"]);
      assert.deepEqual(result.json.queuedMessages.map((item) => item.position), [1, 2, 3]);

      result = await api(server.baseUrl, "/api/queue/reorder", {
        method: "POST", body: { threadId: THREAD_A, itemId: "a3", direction: "down" }
      });
      assert.deepEqual(result.json.queuedMessages.map((item) => item.id), ["a1", "a3", "a2"]);

      result = await api(server.baseUrl, "/api/queue/reorder", {
        method: "POST", body: { threadId: THREAD_A, itemId: "a2", direction: "up" }
      });
      assert.deepEqual(result.json.queuedMessages.map((item) => item.id), ["a1", "a2", "a3"]);

      const persisted = JSON.parse(fs.readFileSync(queueFile, "utf8"));
      assert.deepEqual(persisted.queues[THREAD_A].map((item) => item.id), ["a1", "a2", "a3"]);
      assert.ok(persisted.paused.includes(THREAD_A));
      assert.equal(persisted.queues[THREAD_A][2].files[0].data, fileData);
    });

    await t.test("a queued send keeps the original text and stores the file with the item", async () => {
      const result = await api(server.baseUrl, "/api/send", {
        method: "POST",
        body: {
          threadId: THREAD_A,
          mode: "queue",
          message: "新排队的文件消息",
          files: [{ name: "note.txt", mimeType: "text/plain", data: fileData }]
        }
      });
      assert.equal(result.status, 200);
      assert.equal(result.json.queued, true);
      assert.equal(result.json.queueLength, 4);
      assert.equal(result.json.queuePaused, true);
      assert.equal(result.json.queueItem.text, "新排队的文件消息");
      assert.equal(result.json.queueItem.fileCount, 1);
      assert.equal(result.json.queueItem.files[0].name, "note.txt");
      // The text must not contain a staged host path; staging happens at send.
      assert.equal(/@?["]?[A-Za-z]:\\/.test(result.json.queueItem.text), false);
    });

    await t.test("cancel(edit) returns text, images and file bytes for the composer", async () => {
      const result = await api(server.baseUrl, "/api/queue/cancel", {
        method: "POST", body: { threadId: THREAD_A, itemId: "a3", edit: true }
      });
      assert.equal(result.status, 200);
      assert.equal(result.json.cancelled, 1);
      assert.equal(result.json.draft.text, "带文件的排队");
      assert.deepEqual(result.json.draft.images, []);
      assert.equal(result.json.draft.files.length, 1);
      assert.equal(result.json.draft.files[0].name, "log.txt");
      assert.equal(result.json.draft.files[0].data, fileData);
      assert.equal(result.json.queueLength, 3);
    });

    await t.test("the 21st item is refused with a readable cap error and nothing is added", async () => {
      const full = await api(server.baseUrl, `/api/queue/status?threadId=${THREAD_B}`);
      assert.equal(full.json.queueLength, 20);
      const result = await api(server.baseUrl, "/api/send", {
        method: "POST", body: { threadId: THREAD_B, mode: "queue", message: "第二十一条" }
      });
      assert.equal(result.status, 409);
      assert.equal(result.json.code, "queue_full");
      assert.match(result.json.error, /队列已满（20 条）/);
      const after = await api(server.baseUrl, `/api/queue/status?threadId=${THREAD_B}`);
      assert.equal(after.json.queueLength, 20);
    });

    await t.test("resume clears the pause flag and keeps the order", async () => {
      const result = await api(server.baseUrl, "/api/queue/resume", {
        method: "POST", body: { threadId: THREAD_A }
      });
      assert.equal(result.status, 200);
      assert.equal(result.json.queuePaused, false);
      assert.deepEqual(result.json.queuedMessages.map((item) => item.text), ["第一条", "第二条", "新排队的文件消息"]);
    });

    await t.test("a paused queue survives a restart and does not send by itself", async () => {
      // Pause B again (A was resumed); B was never resumed.
      const before = JSON.parse(fs.readFileSync(queueFile, "utf8"));
      assert.ok(before.paused.includes(THREAD_B));

      await server.stop();
      stopped = true;
      server = await startServer({ home, queueFile });
      stopped = false;

      const beforeWait = await api(server.baseUrl, `/api/queue/status?threadId=${THREAD_B}`);
      assert.equal(beforeWait.json.queuePaused, true);
      assert.equal(beforeWait.json.queueLength, 20);

      // Longer than the 3.5s idle settle: a paused queue must not drain.
      await new Promise((resolve) => setTimeout(resolve, 4200));
      const afterWait = await api(server.baseUrl, `/api/queue/status?threadId=${THREAD_B}`);
      assert.equal(afterWait.json.queueLength, 20);
      assert.equal(afterWait.json.queuePaused, true);
      assert.ok(afterWait.json.queuedMessages.every((item) => item.deliveryState === "queued"));

      const resumed = await api(server.baseUrl, "/api/queue/resume", {
        method: "POST", body: { threadId: THREAD_B }
      });
      assert.equal(resumed.json.queuePaused, false);
      assert.equal(resumed.json.queueLength, 20);
    });

    const persisted = JSON.parse(fs.readFileSync(queueFile, "utf8"));
    assert.equal(persisted.version, 2);
    assert.ok(Array.isArray(persisted.paused));
    assert.equal(persisted.paused.includes(THREAD_A), false);
    assert.equal(persisted.paused.includes(THREAD_B), false);
    assert.equal(persisted.queues[THREAD_B].length, 20);
  } finally {
    if (!stopped) await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
