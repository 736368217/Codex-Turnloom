"use strict";

/**
 * QA defect D1（2026-11-18）：`--backend http` 部署下，手机永远配不上对。
 *
 * `handleHttpBackendApi()` 在 `GET /api/harnesses`（配对发现）之前接管请求，HTTP
 * 后端不认识这个路由，于是回 501；手机上只会看到「连不上这台机器」。发现路由必须
 * 由本地回答，其余 `/api/*` 仍然转发给远端后端。
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");

const ROOT = path.join(__dirname, "..");
const TOKEN = "http-backend-pairing-probe";
// 故意指向一个没人监听的端口：发现路由不该碰后端，代理路由则必须以 502 失败。
const DEAD_BACKEND = "http://127.0.0.1:1";

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
      // 未鉴权的静态入口：任何 <500 的响应都说明 HTTP 服务已经起来了。
      const response = await fetch(`${baseUrl}/`);
      if (response.status < 500) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("server did not become ready within 30s");
}

async function startHttpBackendServer() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-http-backend-"));
  const port = await freePort();
  const args = [
    "server.js", "--port", String(port), "--host", "127.0.0.1",
    "--password", TOKEN, "--codex-home", home,
    "--backend", "http", "--backend-url", DEAD_BACKEND
  ];
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

const getJson = (baseUrl, pathname) => fetch(`${baseUrl}${pathname}`, { headers: { "x-access-token": TOKEN } })
  .then(async (response) => ({ status: response.status, body: await response.json().catch(() => null) }));

test("GET /api/harnesses is answered locally in --backend http mode instead of 501", async (t) => {
  const server = await startHttpBackendServer();
  t.after(server.stop);

  const discovery = await getJson(server.baseUrl, "/api/harnesses");
  assert.equal(discovery.status, 200, `pairing discovery must not be proxied:\n${server.log()}`);
  assert.equal(discovery.body?.ok, true);
  assert.equal(discovery.body?.protocol, "codex-turnloom");
  assert.ok(discovery.body?.machineId, "discovery must carry a machine id");
  assert.ok(Array.isArray(discovery.body?.harnesses) && discovery.body.harnesses.length > 0);
  assert.equal(discovery.body.harnesses[0].kind, "http", "the harness must advertise the remote backend kind");

  // 其余接口仍然必须走远端后端：不可达时是 502，而不是本地吞掉。
  const proxied = await getJson(server.baseUrl, "/api/threads");
  assert.equal(proxied.status, 502, "content routes must still be proxied to the HTTP backend");
});
