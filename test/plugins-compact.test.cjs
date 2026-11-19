"use strict";

/**
 * `/api/plugins?compact=1`（2.2.4，task:59b0e07c）。
 *
 * 真机上 `/api/plugins` 是 362 KB —— 24 个插件的图标全是内联 data URL。引用菜单
 * 只要名字，不该为一屏列表搬 362 KB；compact 模式去掉 `iconDataUrl` 后实测 4.7 KB。
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");

const ROOT = path.join(__dirname, "..");
const TOKEN = "plugins-compact-probe";

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
  const pluginDir = path.join(home, "plugins", "cache", "test-market", "alpha");
  fs.mkdirSync(path.join(pluginDir, ".codex-plugin"), { recursive: true });
  fs.writeFileSync(path.join(pluginDir, ".codex-plugin", "plugin.json"), JSON.stringify({
    name: "alpha",
    displayName: "Alpha",
    description: "A test plugin for the compact listing",
    interface: { icon: "icon.png" },
  }));
  fs.writeFileSync(path.join(pluginDir, "icon.png"), Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000100" +
    "05fe02fea7d4b1a80000000049454e44ae426082", "hex"));
}

async function startServer() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-plugins-"));
  await seedHome(home);
  const port = await freePort();
  const child = spawn(process.execPath, ["server.js", "--port", String(port), "--host", "127.0.0.1", "--token", TOKEN, "--codex-home", home], {
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let log = "";
  child.stdout.on("data", (chunk) => { log += chunk.toString(); });
  child.stderr.on("data", (chunk) => { log += chunk.toString(); });
  const baseUrl = `http://127.0.0.1:${port}`;
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

async function getJson(baseUrl, pathname) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}${pathname}`, { headers: { "x-access-token": TOKEN } });
      if (response.status === 200) return { text: await response.text() };
    } catch { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`${pathname} did not answer within 30s`);
}

test("plugins: compact=1 去掉内联图标，但保留名字/描述/uri", async () => {
  const server = await startServer();
  try {
    const full = await getJson(server.baseUrl, "/api/plugins");
    const compact = await getJson(server.baseUrl, "/api/plugins?compact=1");
    const fullPlugins = JSON.parse(full.text).plugins;
    const compactPlugins = JSON.parse(compact.text).plugins;
    assert.equal(fullPlugins.length, 1);
    assert.ok(fullPlugins[0].iconDataUrl.startsWith("data:"), `fixture icon missing:\n${server.log()}`);
    assert.equal(compactPlugins[0].iconDataUrl, undefined);
    assert.equal(compactPlugins[0].name, "alpha");
    assert.equal(compactPlugins[0].displayName, "Alpha");
    assert.ok(compactPlugins[0].uri.startsWith("plugin://alpha@"));
    assert.ok(Buffer.byteLength(compact.text) < Buffer.byteLength(full.text));
  } finally {
    await server.stop();
  }
});
