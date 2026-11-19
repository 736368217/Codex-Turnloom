"use strict";

/**
 * `--backend http`（de/中继形态）下，技能与插件目录必须代理到宿主。
 *
 * 之前 server.js 在 http-backend 分支直接返回 `{ plugins: [], skills: [] }`，
 * 手机上的「引用」菜单永远显示"没有可引用的技能/插件"——本机 24 个插件、
 * 157 个技能在远程部署里等于不存在。这里用一个假的宿主证明四件事：
 * 路径转发、token 转发、compact=1 透传、上游不可达时给出 unavailable 而不是假装空。
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");

const ROOT = path.join(__dirname, "..");
const BRIDGE_TOKEN = "bridge-catalog-probe";
const UPSTREAM_TOKEN = "upstream-token-probe";

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

async function startUpstream() {
  const seen = [];
  const plugins = [
    { name: "alpha", displayName: "Alpha", description: "first", marketplace: "m", uri: "plugin://alpha@m", iconDataUrl: "data:image/png;base64,AAAA" },
    { name: "beta", displayName: "Beta", description: "second", marketplace: "m", uri: "plugin://beta@m", iconDataUrl: "data:image/png;base64,BBBB" },
  ];
  const skills = [
    { name: "gamma", displayName: "Gamma", description: "skill", source: "local", priority: 100, uri: "skill://gamma@local" },
  ];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    seen.push({ path: url.pathname, query: url.search, token: String(req.headers["x-access-token"] || "") });
    const send = (body) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (url.pathname === "/api/plugins") {
      const compact = url.searchParams.get("compact") === "1";
      return send({ plugins: compact ? plugins.map(({ iconDataUrl, ...rest }) => rest) : plugins, codexHome: "C:\\pi-home", codexHomeVersion: "v1" });
    }
    if (url.pathname === "/api/skills") return send({ skills, codexHome: "C:\\pi-home", codexHomeVersion: "v1" });
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
  const port = await freePort();
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${port}/api`,
    seen,
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function startBridge(backendUrl) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-bridge-catalog-"));
  const port = await freePort();
  const child = spawn(process.execPath, [
    "server.js", "--port", String(port), "--host", "127.0.0.1",
    "--password", BRIDGE_TOKEN, "--codex-home", home,
    "--backend", "http", "--backend-url", backendUrl, "--backend-token", UPSTREAM_TOKEN,
  ], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let log = "";
  child.stdout.on("data", (chunk) => { log += chunk.toString(); });
  child.stderr.on("data", (chunk) => { log += chunk.toString(); });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.status < 500) break;
    } catch { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
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
    },
  };
}

const getJson = (baseUrl, pathname) => fetch(`${baseUrl}${pathname}`, { headers: { "x-access-token": BRIDGE_TOKEN } })
  .then(async (response) => ({ status: response.status, body: await response.json().catch(() => null) }));

test("http-backend 透明转发 /api/skills 与 /api/plugins（含 compact 与 token）", async (t) => {
  const upstream = await startUpstream();
  t.after(upstream.stop);
  const bridge = await startBridge(upstream.baseUrl);
  t.after(bridge.stop);

  const plugins = await getJson(bridge.baseUrl, "/api/plugins?compact=1");
  assert.equal(plugins.status, 200, bridge.log());
  assert.equal(plugins.body.plugins.length, 2);
  assert.equal(plugins.body.plugins[0].iconDataUrl, undefined, "compact=1 must be forwarded upstream");
  assert.equal(plugins.body.plugins[0].uri, "plugin://alpha@m");
  assert.equal(plugins.body.codexHome, "C:\\pi-home", "the host's codexHome must survive the proxy");

  const skills = await getJson(bridge.baseUrl, "/api/skills");
  assert.equal(skills.status, 200, bridge.log());
  assert.equal(skills.body.skills.length, 1);
  assert.equal(skills.body.skills[0].uri, "skill://gamma@local");

  const pluginCall = upstream.seen.find((row) => row.path === "/api/plugins");
  assert.ok(pluginCall, `upstream never saw /api/plugins: ${JSON.stringify(upstream.seen)}`);
  assert.match(pluginCall.query, /compact=1/);
  assert.equal(pluginCall.token, UPSTREAM_TOKEN, "the bridge token must reach the upstream");
});

test("上游不可达时返回 unavailable，而不是假装“没有技能”", async (t) => {
  const dead = await freePort();
  const bridge = await startBridge(`http://127.0.0.1:${dead}/api`);
  t.after(bridge.stop);

  for (const pathname of ["/api/plugins", "/api/skills"]) {
    const result = await getJson(bridge.baseUrl, pathname);
    assert.equal(result.status, 200, `${pathname} must stay a 200 so the menu renders:\n${bridge.log()}`);
    assert.equal(result.body.unavailable, true, `${pathname} must mark the catalogue unavailable`);
    assert.ok(result.body.plugins || result.body.skills, `${pathname} must still carry an empty array`);
  }
});
