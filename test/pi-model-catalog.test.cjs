"use strict";

/**
 * 模型面板与 PI 对齐（2.2.4，task:59b0e07c）。
 *
 * PI 接管时 `/api/health.models` 必须只含 PI 的供应商与候选，且顺序就是 PI 的：
 * 供应商按启用供应商的创建顺序，模型按 `provider.config_json.models` 的顺序。
 * 真机上"多出来的模型 / 乱的供应商顺序"来自这里读了 Codex 的 model-catalogs。
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");

const ROOT = path.join(__dirname, "..");
const TOKEN = "pi-models-probe";

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

async function seedPi(piData) {
  const { DatabaseSync } = await import("node:sqlite");
  fs.mkdirSync(piData, { recursive: true });
  const db = new DatabaseSync(path.join(piData, "pi.sqlite"));
  db.exec(`
    CREATE TABLE providers (id TEXT PRIMARY KEY, name TEXT, default_model_id TEXT,
      enabled INTEGER, config_json TEXT, created_at INTEGER);
  `);
  db.prepare("INSERT INTO providers VALUES (?, ?, ?, 1, ?, ?)").run(
    "p0", "alpha", "alpha-one",
    JSON.stringify({ models: [
      { id: "alpha-one", thinkingLevels: ["low", "high"], defaultThinkingLevel: "low", supportsImages: false },
    ] }),
    500,
  );
  db.prepare("INSERT INTO providers VALUES (?, ?, ?, 1, ?, ?)").run(
    "p1", "wbfd", "hy4flash-free",
    JSON.stringify({ models: [
      { id: "hy4flash-free", thinkingLevels: ["high"], defaultThinkingLevel: "high", supportsImages: true },
      { id: "deepseek-v4.1-flash", thinkingLevels: ["max"], defaultThinkingLevel: "max", supportsImages: true },
    ] }),
    1000,
  );
  db.prepare("INSERT INTO providers VALUES (?, ?, ?, 0, ?, ?)").run("p2", "retired", "", "{}", 2000);
  db.close();
}

async function seedCodexThreads(home) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(home, "state_5.sqlite"));
  db.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, model TEXT, updated_at_ms INTEGER);");
  db.prepare("INSERT INTO threads VALUES (?, ?, ?)").run("t1", "gpt-6-astra", Date.now());
  db.close();
}

async function startServer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-pi-models-"));
  const appData = path.join(root, "appdata");
  const piData = path.join(root, "pi-data");
  const home = path.join(root, "codex-home");
  fs.mkdirSync(path.join(appData, "PI-Desktop"), { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(appData, "PI-Desktop", "storage-location.json"), JSON.stringify({ roots: { data: piData } }));
  await seedPi(piData);
  await seedCodexThreads(home);
  const port = await freePort();
  const child = spawn(process.execPath, ["server.js", "--port", String(port), "--host", "127.0.0.1", "--token", TOKEN, "--codex-home", home], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, APPDATA: appData, CODEX_LAN_PI_NATIVE_QUEUE: "1" },
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
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { headers: { "x-access-token": TOKEN } });
      if (response.status === 200) return await response.json();
    } catch { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("health did not answer within 30s");
}

test("PI 接管时模型只来自 PI，顺序与候选都照 PI", async () => {
  const server = await startServer();
  try {
    const health = await waitForHealth(server.baseUrl);
    const models = health.models || [];
    // 两个**启用**供应商（alpha created_at 更早）时，顺序必须是 alpha 全部 → wbfd 全部，
    // 不能被模型名/字典序交错重排（Vera 指出真实库只有一个供应商，这条用 fixture 补上）。
    assert.deepEqual(models.map((model) => model.id), [
      "alpha/alpha-one",
      "wbfd/hy4flash-free",
      "wbfd/deepseek-v4.1-flash",
    ]);
    assert.deepEqual([...new Set(models.map((model) => model.provider))], ["alpha", "wbfd"]);
    assert.deepEqual(models[0].efforts, ["low", "high"]);
    assert.deepEqual(models[1].efforts, ["high"]);
    assert.deepEqual(models[2].efforts, ["max"]);
    // 默认模型取「第一个启用供应商的默认模型」（alpha 更早）；单供应商时即 PI 自己那条。
    assert.equal(health.defaultModel, "alpha/alpha-one");
    assert.equal(health.defaultEffort, "low");
    // 停用的供应商（retired）一个模型都不该出现。
    // Codex 侧历史里的模型不在 PI 集合内，不能当 lastUsedModel（否则新会话默认值是脏的）。
    assert.equal(health.lastUsedModel, "");
    assert.ok(!health.models.some((model) => model.id === "gpt-6-astra"));
    assert.ok(!models.some((model) => model.id.startsWith("retired/")));
  } finally {
    await server.stop();
  }
});

