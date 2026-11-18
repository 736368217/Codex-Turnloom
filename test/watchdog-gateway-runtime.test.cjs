"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadMachineConfig, createGateway, redactTokens } = require("../server/machine-gateway.cjs");
const { loadWatchdogConfig, dispatcherPlan } = require("../scripts/watchdog-runtime.cjs");

test("explicit old machine code discovers both harnesses, other harness code cannot", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-gateway-"));
  const file = path.join(dir, "machine.json");
  const raw = { machineId: "qa-machine", machineToken: "machine-secret", legacyMachineTokens: ["old-code"], harnesses: [
    { id: "codex", token: "old-code", port: 1, spawn: false },
    { id: "pi", token: "pi-secret", port: 2, spawn: false },
  ] };
  fs.writeFileSync(file, JSON.stringify(raw));
  const config = loadMachineConfig(file);
  const gateway = createGateway(config);
  try {
    await gateway.listen("127.0.0.1", 0);
    const base = `http://127.0.0.1:${gateway.server.address().port}`;
    for (const token of ["machine-secret", "old-code"]) {
      const response = await fetch(base + "/api/harnesses", { headers: { "x-access-token": token } });
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).harnesses.map((h) => h.id), ["codex", "pi"]);
    }
    const denied = await fetch(base + "/api/harnesses", { headers: { "x-access-token": "pi-secret" } });
    assert.equal(denied.status, 401);
    const machineApi = await fetch(base + "/api/health", { headers: { "x-access-token": "machine-secret" } });
    assert.equal(machineApi.status, 401);
    assert.equal(redactTokens("machine-secret old-code pi-secret", config), "*** *** ***");
    delete raw.legacyMachineTokens;
    fs.writeFileSync(file, JSON.stringify(raw));
    assert.deepEqual(loadMachineConfig(file).legacyMachineTokens, []);
  } finally {
    await gateway.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("watchdog gateway mode reads authoritative machine table without sibling config", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-watchdog-"));
  try {
    const machinePath = path.join(dir, "machine.json");
    const mainPath = path.join(dir, "config.json");
    fs.writeFileSync(machinePath, JSON.stringify({ machineId: "qa", machineToken: "machine", harnesses: [
      { id: "codex", token: "codex", port: 18788, spawn: false },
      { id: "pi", token: "pi", port: 8799, spawn: false },
    ] }));
    fs.writeFileSync(mainPath, JSON.stringify({ port: 8787, machineGateway: { enabled: true, machineConfigPath: machinePath } }));
    const state = loadWatchdogConfig(mainPath, path.join(dir, "missing-legacy.json"));
    assert.deepEqual(state.devices.map((d) => [d.key, d.port]), [["codex", 18788], ["pi", 8799]]);
    const plan = dispatcherPlan(state.main, "legacy-dir");
    assert.equal(path.basename(plan.args[0]), "machine-gateway.cjs");
    assert.ok(plan.args.includes(machinePath));
    assert.ok(plan.args.includes("--no-spawn"));
    assert.ok(!plan.args.includes("--password"));
    const legacy = dispatcherPlan({ port: 8787, accessCode: "legacy" }, "legacy-dir");
    assert.equal(legacy.cwd, "legacy-dir");
    assert.equal(legacy.args[0], "server.js");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
