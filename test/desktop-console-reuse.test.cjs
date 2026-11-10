"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ServiceController } = require(path.join(__dirname, "..", "desktop", "service", "controller.cjs"));
const { RuntimeManager } = require(path.join(__dirname, "..", "desktop", "service", "runtime.cjs"));
const { TunnelController, forwardMarker } = require(path.join(__dirname, "..", "desktop", "service", "tunnel.cjs"));

function makeConfig(home, port = 8787) {
  fs.writeFileSync(path.join(home, "server.js"), "module.exports = {};", "utf8");
  return {
    repoRoot: home,
    nodePath: process.execPath,
    codexHome: home,
    host: "0.0.0.0",
    port,
    accessCode: "test-code",
    publicUrl: "https://example.test",
    console: { autoStart: true },
    tunnel: {
      enabled: true,
      host: "example.test",
      user: "tunnel",
      remotePort: 18786,
      keyPath: path.join(home, "key"),
      knownHostsPath: path.join(home, "known_hosts")
    }
  };
}

function makeLogger() {
  return {
    lines: [],
    info(...args) { this.lines.push(["info", ...args]); },
    warn(...args) { this.lines.push(["warn", ...args]); },
    error(...args) { this.lines.push(["error", ...args]); }
  };
}

function makeController({ healthy, portAvailable = true, owner = { pid: 18008, name: "node.exe" } } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-console-reuse-"));
  const config = makeConfig(home);
  const calls = [];
  const logger = makeLogger();
  const controller = new ServiceController({
    config,
    logger,
    health: {
      check: async () => {
        calls.push("health");
        return healthy
          ? { ok: true, status: 200, latencyMs: 12, data: { ok: true, codexHome: home, authRequired: true, allowWrite: true } }
          : { ok: false, status: 503, error: "HTTP 503" };
      },
      checkPortAvailable: async () => {
        calls.push("port");
        return { available: portAvailable };
      },
      findPortOwner: async () => {
        calls.push("owner");
        return owner;
      }
    },
    processControl: {
      getProcessStart: async () => Date.parse("2026-11-06T02:00:49Z"),
      getProcessMetrics: async () => ({ memoryBytes: 123456 })
    }
  });
  controller.spawnChild = () => { calls.push("spawn"); throw new Error("spawn must not happen"); };
  return { controller, logger, calls, home, cleanup: () => fs.rmSync(home, { recursive: true, force: true }) };
}

test("healthy watchdog service is adopted before port validation and never spawned", async () => {
  const fixture = makeController({ healthy: true, portAvailable: false });
  try {
    const result = await fixture.controller.start();
    assert.equal(result.ok, true);
    assert.equal(result.adopted, true);
    assert.equal(result.external, true);
    assert.equal(fixture.controller.pid, 18008);
    assert.equal(fixture.controller.state, "running");
    assert.equal(fixture.controller.snapshot().service.external, true);
    assert.deepEqual(fixture.calls, ["health", "owner"]);
    assert.match(fixture.logger.lines.map((line) => line.join(" ")).join("\n"), /复用已运行的健康服务/);
    assert.equal(fixture.controller.lastError, null);
  } finally {
    await fixture.controller.dispose();
    fixture.cleanup();
  }
});

test("unhealthy occupied port keeps the explicit port-owner error", async () => {
  const fixture = makeController({ healthy: false, portAvailable: false });
  try {
    const result = await fixture.controller.start();
    assert.equal(result.ok, false);
    assert.match(result.error, /端口 8787 已被 node\.exe（PID 18008）占用/);
    assert.equal(fixture.controller.state, "error");
    assert.equal(fixture.calls[0], "health");
    assert.equal(fixture.calls[1], "port");
    assert.equal(fixture.calls[2], "owner");
    assert.equal(fixture.calls.at(-1), "health");
    assert.ok(fixture.calls.length >= 4);
  } finally {
    await fixture.controller.dispose();
    fixture.cleanup();
  }
});

test("adopting a healthy service does not require a valid local source path", async () => {
  const fixture = makeController({ healthy: true, portAvailable: false });
  try {
    fs.rmSync(path.join(fixture.home, "server.js"));
    const result = await fixture.controller.start();
    assert.equal(result.ok, true);
    assert.equal(result.adopted, true);
    assert.deepEqual(fixture.calls, ["health", "owner"]);
  } finally {
    await fixture.controller.dispose();
    fixture.cleanup();
  }
});

test("stop on an adopted service detaches without killing the watchdog process", async () => {
  const fixture = makeController({ healthy: true, portAvailable: false });
  try {
    await fixture.controller.start();
    let killCalls = 0;
    fixture.controller.killChild = async () => { killCalls += 1; };
    await fixture.controller.stop();
    assert.equal(killCalls, 0);
    assert.equal(fixture.controller.pid, 0);
    assert.equal(fixture.controller.state, "stopped");
    assert.equal(fixture.controller.snapshot().service.external, false);
    assert.match(fixture.logger.lines.map((line) => line.join(" ")).join("\n"), /控制台已断开服务显示/);
  } finally {
    await fixture.controller.dispose();
    fixture.cleanup();
  }
});

test("restart on an adopted healthy service refreshes state without stopping it", async () => {
  const fixture = makeController({ healthy: true, portAvailable: false });
  try {
    await fixture.controller.start();
    const result = await fixture.controller.restart();
    assert.equal(result.ok, true);
    assert.equal(result.refreshed, true);
    assert.equal(result.external, true);
    assert.equal(fixture.controller.pid, 18008);
    assert.equal(fixture.controller.state, "running");
    assert.ok(!fixture.calls.includes("spawn"));
  } finally {
    await fixture.controller.dispose();
    fixture.cleanup();
  }
});

test("tunnel adoption reuses the matching watchdog ssh process", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-tunnel-reuse-"));
  try {
    const config = makeConfig(home);
    const logger = makeLogger();
    const tunnel = new TunnelController({ config, logger, findExternal: async () => 18304 });
    const result = await tunnel.start();
    assert.equal(result.ok, true);
    assert.equal(result.adopted, true);
    assert.equal(result.external, true);
    assert.equal(tunnel.pid, 18304);
    assert.equal(tunnel.state, "connected");
    assert.equal(tunnel.snapshot().external, true);
    assert.equal(forwardMarker(config), "127.0.0.1:18786:127.0.0.1:8787");
    await tunnel.dispose();
    assert.equal(tunnel.pid, 0);
    assert.equal(tunnel.external, false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("runtime manager reports a watchdog-owned tunnel as healthy", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-runtime-reuse-"));
  try {
    const config = makeConfig(home);
    const logger = makeLogger();
    const runtime = new RuntimeManager({ config, logger });
    runtime.service = {
      snapshot: () => ({
        state: "running",
        detail: "服务已由守护运行，手机端可以访问",
        service: { pid: 18008, external: true },
        health: { ok: true },
        lastError: null
      }),
      on() {},
      setIpcStatus() {},
      setConfig() {},
      start: async () => ({ ok: true, adopted: true }),
      stop: async () => {},
      restart: async () => ({ ok: true }),
      dispose: async () => {}
    };
    runtime.tunnel = {
      snapshot: () => ({ enabled: true, state: "connected", pid: 18304, external: true, error: null }),
      on() {},
      setConfig() {},
      start: async () => ({ ok: true, adopted: true }),
      stop: async () => {},
      restart: async () => ({ ok: true }),
      dispose: async () => {}
    };
    runtime.emit = () => true;
    const snapshot = runtime.snapshot();
    assert.equal(snapshot.state, "running");
    assert.match(snapshot.detail, /守护运行/);
    assert.equal(snapshot.service.external, true);
    assert.equal(snapshot.tunnel.external, true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("desktop copy reuses healthy services and protects watchdog-owned processes", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "desktop", "service", "controller.cjs"), "utf8");
  assert.match(source, /const existing = await this\.healthApi\.check/);
  assert.match(source, /if \(existing\.ok\) return await this\.adoptExternal/);
  assert.match(source, /const port = await this\.healthApi\.checkPortAvailable/);
  assert.match(source, /if \(this\.managed\) await this\.killChild\(\)/);
  const main = fs.readFileSync(path.join(__dirname, "..", "desktop", "main.cjs"), "utf8");
  assert.match(main, /服务由后台守护运行/);
  assert.match(main, /退出控制台不会停止后台守护的服务与 SSH 隧道/);
  const renderer = fs.readFileSync(path.join(__dirname, "..", "desktop", "renderer", "app.js"), "utf8");
  assert.match(renderer, /snap\?\.service\?\.external/);
  assert.match(renderer, /重新检查服务/);
});

test("error state automatically re-adopts a watchdog service after it recovers", async () => {
  let healthy = false;
  const fixture = makeController({ healthy: false, portAvailable: false, owner: { pid: 16484, name: "node.exe" } });
  try {
    const failed = await fixture.controller.start();
    assert.equal(failed.ok, false);
    assert.equal(fixture.controller.state, "error");
    assert.match(fixture.controller.lastError, /PID 16484/);

    healthy = true;
    fixture.controller.healthApi.check = async () => ({
      ok: true,
      status: 200,
      latencyMs: 8,
      data: { ok: true, codexHome: fixture.home, allowWrite: true }
    });
    fixture.controller.healthApi.findPortOwner = async () => ({ pid: 3136, name: "node.exe" });
    await fixture.controller.probeRecovery();
    assert.equal(fixture.controller.state, "running");
    assert.equal(fixture.controller.pid, 3136);
    assert.equal(fixture.controller.lastError, null);
    assert.equal(fixture.controller.recoveryTimer, null);
  } finally {
    await fixture.controller.dispose();
    fixture.cleanup();
  }
});

test("a healthy service wins a transient occupied-port race during start", async () => {
  let checks = 0;
  const fixture = makeController({ healthy: false, portAvailable: false, owner: { pid: 16484, name: "node.exe" } });
  try {
    fixture.controller.healthApi.check = async () => {
      checks += 1;
      return checks >= 2
        ? { ok: true, status: 200, latencyMs: 9, data: { ok: true, codexHome: fixture.home, allowWrite: true } }
        : { ok: false, status: 503, error: "HTTP 503" };
    };
    const result = await fixture.controller.start();
    assert.equal(result.ok, true);
    assert.equal(result.adopted, true);
    assert.equal(fixture.controller.state, "running");
    assert.equal(fixture.controller.lastError, null);
  } finally {
    await fixture.controller.dispose();
    fixture.cleanup();
  }
});
