"use strict";

/**
 * 配对发现 → 业务请求的令牌交接（真机 D1，2026-11-18）。
 *
 * `--token A --machine-token B` 时，手机用 B 调 `/api/harnesses`；发现响应必须把
 * **A**（`/api/*` 真正认的 harness 令牌）交回去。旧实现回落到 `requestedToken`，
 * 于是把机器码 B 当成 harness 令牌发回：发现 200，随后 `/api/health` 401，App 报
 * 「机器访问码不正确或已更换」，用户只能「忘记这台电脑」。
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");

const ROOT = path.join(__dirname, "..");
const ACCESS = "access-token-alpha";
const MACHINE = "machine-token-beta";

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

async function waitForReady(baseUrl) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.status < 500) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("server did not become ready within 30s");
}

async function startServer() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-pairing-token-"));
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(home, "state_5.sqlite"));
  db.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT, rollout_path TEXT, updated_at_ms INTEGER, cwd TEXT);");
  db.close();
  const port = await freePort();
  const child = spawn(process.execPath, [
    "server.js", "--port", String(port), "--host", "127.0.0.1",
    "--token", ACCESS, "--machine-token", MACHINE, "--codex-home", home
  ], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
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

const getJson = (baseUrl, pathname, token) => fetch(`${baseUrl}${pathname}`, { headers: { "x-access-token": token } })
  .then(async (response) => ({ status: response.status, body: await response.json().catch(() => null) }));

test("discovery returns the access token, never the machine token, when both differ", async (t) => {
  const server = await startServer();
  t.after(server.stop);

  const discovery = await getJson(server.baseUrl, "/api/harnesses", MACHINE);
  assert.equal(discovery.status, 200, `discovery with the machine token must succeed:\n${server.log()}`);
  const harnessToken = discovery.body?.harnesses?.[0]?.token;
  assert.equal(harnessToken, ACCESS, "the harness token must be the one /api/* accepts");
  assert.notEqual(harnessToken, MACHINE, "the machine token must never be handed back as a harness token");

  // 交接是否可用：用发现响应里的 token 打业务接口必须 200，用机器码必须 401。
  const health = await getJson(server.baseUrl, "/api/health", harnessToken);
  assert.equal(health.status, 200, `the returned harness token must work on /api/*:\n${server.log()}`);
  const healthWithMachine = await getJson(server.baseUrl, "/api/health", MACHINE);
  assert.equal(healthWithMachine.status, 401, "the machine token stays discovery-only");

  // 直接用访问码调发现也必须照常工作（手机端两条路径都存在）。
  const discoveryWithAccess = await getJson(server.baseUrl, "/api/harnesses", ACCESS);
  assert.equal(discoveryWithAccess.status, 200);
  assert.equal(discoveryWithAccess.body?.harnesses?.[0]?.token, ACCESS);
});
