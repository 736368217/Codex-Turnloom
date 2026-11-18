"use strict";

/**
 * HTTP 层证据：审批决定的失败语义必须真的从 `POST /api/approval` 透传到状态码，
 * 而不是只在 `respondToApproval()` 的函数级测试里成立。
 * 起真实进程（临时 CODEX_HOME + 端口），任何 IPC 都不应该被触达。
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");

const ROOT = path.join(__dirname, "..");
const TOKEN = "http-approval-probe";
const THREAD_ID = "http-approval-thread";

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
  db.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT, rollout_path TEXT, updated_at_ms INTEGER, cwd TEXT);");
  db.prepare("INSERT INTO threads VALUES (?, ?, ?, ?, ?)").run(THREAD_ID, "Approval probe", "", Date.now(), home);
  db.close();
}

async function waitForReady(baseUrl) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/app/update-public`);
      if (response.status === 200) return;
    } catch {
      // server not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("server did not become ready within 30s");
}

async function startServer({ readonly = false } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-http-approval-"));
  await seedHome(home);
  const port = await freePort();
  const args = ["server.js", "--port", String(port), "--host", "127.0.0.1", "--token", TOKEN, "--codex-home", home];
  if (readonly) args.push("--readonly");
  const child = spawn(process.execPath, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
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

function post(baseUrl, body, { token = TOKEN } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers["x-access-token"] = token;
  return fetch(`${baseUrl}/api/approval`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body)
  }).then(async (response) => ({ status: response.status, body: await response.json().catch(() => null) }));
}

const HASH = "a".repeat(64);
const identity = (extra = {}) => ({ threadId: THREAD_ID, requestId: "probe-request", approvalKind: "command", detailsHash: HASH, decision: "approve", ...extra });

test("POST /api/approval fails closed over HTTP with a distinguishable code for every reason", async (t) => {
  const server = await startServer();
  t.after(server.stop);

  // 没有访问码就是 401，不能落到业务错误。
  const unauthorized = await post(server.baseUrl, identity(), { token: "" });
  assert.equal(unauthorized.status, 401);

  const cases = [
    [{}, 400, "approval_thread_required"],
    [{ threadId: "does-not-exist" }, 404, "approval_thread_not_found"],
    [{ threadId: THREAD_ID, decision: "approve" }, 400, "approval_identity_required"],
    [{ threadId: THREAD_ID, requestId: "probe-request", approvalKind: "command", detailsHash: "not-a-hash" }, 400, "approval_identity_required"],
    [{ threadId: THREAD_ID, requestId: "probe-request", approvalKind: "shell", detailsHash: HASH }, 400, "approval_identity_required"],
    // 会话存在、字段齐全，但没有任何真实待审批请求 → 409，绝不退回“最近一个待处理”。
    [identity(), 409, "approval_request_unavailable"],
    [identity({ detailsHash: "b".repeat(64) }), 409, "approval_request_unavailable"]
  ];
  for (const [body, status, code] of cases) {
    const response = await post(server.baseUrl, body);
    assert.equal(response.status, status, `unexpected status for ${JSON.stringify(body)}: ${JSON.stringify(response.body)}`);
    assert.equal(response.body?.code, code, `unexpected code for ${JSON.stringify(body)}`);
    assert.equal(typeof response.body?.error, "string");
    assert.ok(response.body.error.length > 0);
  }

  // 与客户端契约一致：4xx 绝不能被解释成“离线”，错误体必须是 {error, code}。
  const errors = server.log().split("\n").filter((line) => line.includes("/api/approval"));
  assert.ok(errors.some((line) => line.includes("409")), `expected a 409 in the server log:\n${server.log()}`);
});

test("read-only mode refuses approvals with a write-disabled code instead of a generic failure", async (t) => {
  const server = await startServer({ readonly: true });
  t.after(server.stop);
  const response = await post(server.baseUrl, identity());
  assert.equal(response.status, 403);
  assert.equal(response.body?.code, "write_disabled");
});

test("httpErrorCode keeps status authoritative and never emits an unsafe token", async () => {
  const { httpErrorCode } = await import("../server.js");
  const plain = (status) => httpErrorCode(status, new Error("boom"));
  assert.equal(plain(400), "bad_request");
  assert.equal(plain(401), "unauthorized");
  assert.equal(plain(403), "forbidden");
  assert.equal(plain(404), "not_found");
  assert.equal(plain(409), "conflict");
  assert.equal(plain(429), "rate_limited");
  assert.equal(plain(500), "server_error");
  assert.equal(plain(503), "server_error");
  // 显式 code 优先；但含空格/中文/过长的一律退回状态码映射，避免把任意文本当机器码。
  assert.equal(httpErrorCode(409, { status: 409, code: "approval_request_unavailable" }), "approval_request_unavailable");
  assert.equal(httpErrorCode(409, { status: 409, code: "not a code" }), "conflict");
  assert.equal(httpErrorCode(409, { status: 409, code: "审批失败" }), "conflict");
  assert.equal(httpErrorCode(500, { status: 500, code: "x".repeat(64) }), "server_error");
  assert.equal(httpErrorCode(418, { status: 418 }), "request_failed");
});
