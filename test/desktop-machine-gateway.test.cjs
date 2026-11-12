"use strict";

/**
 * Bounded one-machine / many-harness desktop integration tests.
 *
 * These tests never touch the live %LOCALAPPDATA% config, scheduled tasks,
 * sibling repositories, or running processes: every fixture lives in a temp
 * directory and every HTTP probe is served by a local stub or injected fetch.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const ROOT = path.join(__dirname, "..");
const shared = require(path.join(ROOT, "shared", "machine-pairing.cjs"));
const serverGateway = require(path.join(ROOT, "server", "machine-gateway.cjs"));
const desktopGateway = require(path.join(ROOT, "desktop", "service", "machine-gateway.cjs"));
const configModule = require(path.join(ROOT, "desktop", "service", "config.cjs"));
const { generatePairing, listPairingTargets } = require(path.join(ROOT, "desktop", "service", "pairing.cjs"));
const { ServiceController } = require(path.join(ROOT, "desktop", "service", "controller.cjs"));
const { checkHealth, checkMachineGateway } = require(path.join(ROOT, "desktop", "service", "health.cjs"));
const cli = require(path.join(ROOT, "scripts", "configure-machine-gateway.cjs"));

const MACHINE_TOKEN = "MACHINE-SECRET-32-CHARS-MINIMUM-0001";
const CODEX_TOKEN = "CODEX-REAL-UPSTREAM-SECRET-0001";
const PIDESK_TOKEN = "PIDESK-REAL-UPSTREAM-SECRET-0001";

function tmpDir(prefix = "turnloom-desktop-gateway-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function legacyDualConfig(dir) {
  const entry = path.join(dir, "server.js");
  fs.writeFileSync(entry, "module.exports = {};\n", "utf8");
  return {
    _comment: "legacy dual dispatcher",
    defaultDevice: "codex",
    devices: [
      {
        key: "codex",
        label: "Codex",
        port: 18788,
        entry,
        codexHome: path.join(dir, "codex-home"),
        token: CODEX_TOKEN,
        spawn: true,
        extraArgs: [],
      },
      {
        key: "pidesk",
        label: "PI-Desktop",
        port: 8799,
        entry,
        codexHome: path.join(dir, "pidesk-home"),
        token: PIDESK_TOKEN,
        spawn: true,
        extraArgs: ["--ipc-socket", "\\\\.\\pipe\\pidesktop-codex-ipc"],
      },
    ],
  };
}

function consoleConfig(dir, machinePath, extra = {}) {
  const serverEntry = path.join(dir, "server.js");
  fs.writeFileSync(serverEntry, "module.exports = {};\n", "utf8");
  return {
    schemaVersion: 1,
    machineName: "Office PC",
    repoRoot: dir,
    nodePath: process.execPath,
    codexHome: dir,
    host: "0.0.0.0",
    port: 18787,
    accessCode: "OLD-LEGACY-SINGLE-HARNESS-ACCESS-CODE",
    publicUrl: "https://turnloom.example.test",
    readonly: false,
    tunnel: { enabled: false },
    console: { autoStart: true },
    extraDevices: [],
    machineGateway: {
      enabled: true,
      machineConfigPath: machinePath,
      origin: "https://turnloom.example.test",
      spawnBackends: false,
    },
    ...extra,
  };
}

function writeMachine(dir, rows = null, extra = {}) {
  const file = path.join(dir, "machine.json");
  const body = {
    machineId: "office-01",
    machineName: "Office PC",
    machineToken: MACHINE_TOKEN,
    defaultHarness: "codex",
    harnesses: rows || [
      { id: "codex", name: "Codex", token: CODEX_TOKEN, kind: "codex", port: 18788, spawn: false },
      { id: "pidesk", name: "PI-Desktop", token: PIDESK_TOKEN, kind: "codex", port: 8799, spawn: false },
    ],
    ...extra,
  };
  fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  return { file, body };
}

function configWithMachine(dir, overrides = {}) {
  const machine = writeMachine(dir);
  return {
    ...consoleConfig(dir, machine.file),
    ...overrides,
    machineGateway: {
      ...consoleConfig(dir, machine.file).machineGateway,
      ...(overrides.machineGateway || {}),
    },
    machinePath: machine.file,
  };
}

function singleHarnessMachine(dir) {
  return writeMachine(dir, [
    { id: "codex", name: "Codex", token: CODEX_TOKEN, kind: "codex", port: 18788, spawn: false },
  ], { defaultHarness: "codex" });
}

test("legacy dual config imports REAL ports/entry/homes/tokens and a distinct stable machine token", () => {
  const dir = tmpDir();
  try {
    const legacy = legacyDualConfig(dir);
    const existingMachine = { machineId: "office-01", machineName: "Office PC", machineToken: MACHINE_TOKEN };
    const derived = desktopGateway.deriveMachineConfig({
      legacy,
      consoleConfig: { machineName: "Office PC", machineId: "" },
      existingMachine,
      origin: "https://turnloom.example.test",
      spawnBackends: false,
      random: () => `GENERATED-${Math.random().toString(36).slice(2)}`,
    });
    assert.equal(derived.machineId, "office-01");
    assert.equal(derived.machineName, "Office PC");
    assert.equal(derived.defaultHarness, "codex");
    assert.equal(derived.machineToken, MACHINE_TOKEN);
    assert.notEqual(derived.machineToken, CODEX_TOKEN);
    assert.notEqual(derived.machineToken, PIDESK_TOKEN);
    assert.deepEqual(derived.harnesses.map((item) => item.port), [18788, 8799]);
    assert.deepEqual(derived.harnesses.map((item) => item.token), [CODEX_TOKEN, PIDESK_TOKEN]);
    assert.equal(derived.harnesses[0].entry, legacy.devices[0].entry);
    assert.equal(derived.harnesses[1].codexHome, legacy.devices[1].codexHome);
    assert.equal(derived.harnesses[1].extraArgs[0], "--ipc-socket");
    // External owners are never replaced: spawn is false by default.
    assert.deepEqual(derived.harnesses.map((item) => item.spawn), [false, false]);
    assert.equal(derived.publicUrl, "https://turnloom.example.test");
    assert.equal(JSON.stringify(derived).includes("REPLACE_WITH_"), false);

    // Re-import preserves the machine identity and token (stable QR).
    const again = desktopGateway.deriveMachineConfig({
      legacy,
      existingMachine: desktopGateway.normalizeMachineConfig(derived),
      consoleConfig: { machineName: "Office PC" },
      spawnBackends: false,
    });
    assert.equal(again.machineId, derived.machineId);
    assert.equal(again.machineToken, derived.machineToken);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("machine token collision with a harness token is rotated, never reused", () => {
  const dir = tmpDir();
  try {
    const legacy = legacyDualConfig(dir);
    const derived = desktopGateway.deriveMachineConfig({
      legacy,
      existingMachine: { machineId: "office-01", machineName: "Office PC", machineToken: CODEX_TOKEN },
      random: () => "FRESH-DISTINCT-MACHINE-TOKEN",
    });
    assert.equal(derived.machineToken, "FRESH-DISTINCT-MACHINE-TOKEN");
    assert.ok(derived.harnesses.every((item) => item.token !== derived.machineToken));
    const rotated = desktopGateway.deriveMachineConfig({
      legacy,
      existingMachine: { machineId: "office-01", machineName: "Office PC", machineToken: MACHINE_TOKEN },
      rotateMachineToken: true,
      random: () => "ROTATED-MACHINE-TOKEN",
    });
    assert.equal(rotated.machineToken, "ROTATED-MACHINE-TOKEN");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("desktop machine.json shape is loadable by the real server gateway", () => {
  const dir = tmpDir();
  try {
    const machine = writeMachine(dir);
    const desktop = desktopGateway.loadMachineConfig({ machineGateway: { machineConfigPath: machine.file } });
    const server = serverGateway.loadMachineConfig(machine.file);
    assert.equal(server.machineId, desktop.machineId);
    assert.equal(server.machineToken, desktop.machineToken);
    assert.equal(server.defaultHarnessId, "codex");
    assert.deepEqual(
      server.harnesses.map((item) => `${item.id}:${item.token}:${item.port}`),
      ["codex:" + CODEX_TOKEN + ":18788", "pidesk:" + PIDESK_TOKEN + ":8799"],
    );
    const discovery = serverGateway.publicDiscovery(server);
    assert.equal(discovery.machineId, desktop.machineId);
    assert.equal(discovery.harnesses.length, 2);
    assert.equal(JSON.stringify(discovery).includes("18788"), false);
    assert.equal(JSON.stringify(discovery).includes("codexHome"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("QR -> discovery consistency: one QR identity, both distinct harness tokens, one default", async () => {
  const dir = tmpDir();
  try {
    const config = configWithMachine(dir);
    const qr = await generatePairing(config);
    const parsed = shared.parseMachinePairingPayload(qr.payload);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.pairing.machineId, "office-01");
    assert.equal(parsed.pairing.machineName, "Office PC");
    assert.equal(parsed.pairing.machineToken, MACHINE_TOKEN);
    assert.equal(parsed.pairing.serverUrl, "https://turnloom.example.test");
    assert.equal(qr.accessCode, MACHINE_TOKEN);
    assert.equal(qr.url, "https://turnloom.example.test");
    assert.equal(qr.harnessCount, 2);
    assert.equal(qr.devices.length, 1);
    assert.equal(qr.machineGateway.harnessCount, 2);
    assert.equal(JSON.stringify(shared.redactPairing(qr)).includes(MACHINE_TOKEN), false);
    assert.equal(qr.payload.includes("OLD-LEGACY-SINGLE-HARNESS-ACCESS-CODE"), false);

    // The exact body the real gateway emits must pass the phone-side validator.
    const server = serverGateway.loadMachineConfig(config.machinePath);
    const discoveryBody = serverGateway.publicDiscovery(server);
    const checked = shared.normalizeDiscovery(discoveryBody, parsed.pairing);
    assert.equal(checked.ok, true);
    assert.equal(checked.machine.machineId, "office-01");
    assert.equal(checked.machine.defaultHarnessId, "codex");
    assert.deepEqual(checked.machine.harnesses.map((item) => item.id), ["codex", "pidesk"]);
    assert.deepEqual(checked.machine.harnesses.map((item) => item.token), [CODEX_TOKEN, PIDESK_TOKEN]);
    assert.deepEqual(checked.machine.harnesses.map((item) => item.defaultHarness), [true, false]);
    assert.equal(new Set([MACHINE_TOKEN, CODEX_TOKEN, PIDESK_TOKEN]).size, 3);

    // Offline helper used by the migration CLI reaches the same conclusion.
    const desktop = desktopGateway.loadMachineConfig(config);
    const consistency = desktopGateway.validatePairingConsistency(desktop, qr.url);
    assert.equal(consistency.ok, true);
    assert.equal(consistency.machine.defaultHarnessId, "codex");
    assert.equal(consistency.machine.harnesses.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("QR and discovery reject a wrong machine identity or machine-token reuse", () => {
  const dir = tmpDir();
  try {
    const machine = writeMachine(dir);
    const desktop = desktopGateway.loadMachineConfig({ machineGateway: { machineConfigPath: machine.file } });
    const parsed = shared.parseMachinePairingPayload(shared.machinePairingPayload({
      machineId: desktop.machineId,
      machineName: desktop.machineName,
      machineToken: desktop.machineToken,
      url: "https://turnloom.example.test",
    }));
    assert.equal(parsed.ok, true);
    const mismatched = desktopGateway.discoveryFor({ ...desktop, machineId: "another-machine" });
    assert.equal(shared.normalizeDiscovery(mismatched, parsed.pairing).code, "machine-mismatch");
    const reused = desktopGateway.discoveryFor({
      ...desktop,
      harnesses: [{ ...desktop.harnesses[0], token: MACHINE_TOKEN }, desktop.harnesses[1]],
    });
    assert.equal(shared.normalizeDiscovery(reused, parsed.pairing).code, "machine-token-reuse");
    assert.throws(() => desktopGateway.normalizeMachineConfig({
      ...machine.body,
      machineToken: CODEX_TOKEN,
    }), /machineToken 不得等于/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("backward compatible single-harness setup still produces one valid v2 QR", async () => {
  const dir = tmpDir();
  try {
    // Legacy (non-gateway) console config: QR uses the console accessCode.
    const legacy = consoleConfig(dir, path.join(dir, "missing-machine.json"));
    delete legacy.machineGateway;
    const legacyQr = await generatePairing(legacy);
    const parsedLegacy = shared.parseMachinePairingPayload(legacyQr.payload);
    assert.equal(parsedLegacy.ok, true);
    assert.equal(parsedLegacy.pairing.machineToken, legacy.accessCode);
    assert.equal(legacyQr.machineGateway.enabled, false);
    assert.equal(legacyQr.harnessCount, 0);

    // Single-harness gateway config: machineToken may equal the only harness
    // token; the server loader explicitly permits that compatibility case.
    const single = singleHarnessMachine(dir);
    const singleConfig = consoleConfig(dir, single.file);
    const singleServer = serverGateway.loadMachineConfig(single.file);
    assert.equal(singleServer.harnesses.length, 1);
    assert.equal(singleServer.defaultHarnessId, "codex");
    const singleQr = await generatePairing(singleConfig);
    const parsedSingle = shared.parseMachinePairingPayload(singleQr.payload);
    assert.equal(parsedSingle.ok, true);
    assert.equal(singleQr.harnessCount, 1);
    const checked = shared.normalizeDiscovery(serverGateway.publicDiscovery(singleServer), parsedSingle.pairing);
    assert.equal(checked.ok, true);
    assert.equal(checked.machine.harnesses.length, 1);
    assert.equal(checked.machine.harnesses[0].defaultHarness, true);
    assert.equal(desktopGateway.gatewaySpawn(singleConfig).args.includes("--no-spawn"), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("gateway spawn uses --config/--no-spawn and never places tokens on the command line", () => {
  const dir = tmpDir();
  try {
    const config = configWithMachine(dir);
    const spawn = desktopGateway.gatewaySpawn(config);
    assert.equal(spawn.args[0].endsWith("machine-gateway.cjs"), true);
    assert.equal(spawn.args.includes("--config"), true);
    assert.equal(spawn.args.includes(config.machinePath), true);
    assert.equal(spawn.args.includes("--no-spawn"), true);
    assert.equal(spawn.args.includes("--host"), true);
    assert.equal(spawn.args.includes(String(config.port)), true);
    assert.equal(spawn.args.includes("--public-url"), true);
    assert.equal(spawn.args.includes(config.publicUrl), true);
    for (const secret of [MACHINE_TOKEN, CODEX_TOKEN, PIDESK_TOKEN, config.accessCode]) {
      assert.equal(spawn.args.includes(secret), false);
    }
    const urls = configModule.urlsFor(config);
    assert.equal(urls.publicUrl, "https://turnloom.example.test");
    assert.equal(desktopGateway.effectiveAccessToken(config), CODEX_TOKEN);
    assert.equal(desktopGateway.gatewaySummary(config).harnessCount, 2);
    assert.equal(desktopGateway.gatewaySummary(config).machineTokenMasked.includes(MACHINE_TOKEN), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("health probes use the default harness token, and verify discovery before adoption", async () => {
  const dir = tmpDir();
  try {
    const config = configWithMachine(dir);
    const seen = [];
    const fetchImpl = async (url, options = {}) => {
      seen.push({ url, token: options.headers?.["x-access-token"] || "" });
      if (url.endsWith("/api/health")) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, appVersionName: "test" }) };
      }
      if (url.endsWith(desktopGateway.HEALTH_MARKER_PATH)) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            ok: true, protocol: shared.PROTOCOL, version: shared.VERSION,
            machineId: "office-01", harnessCount: 2,
          }),
        };
      }
      if (url.endsWith(shared.HARNESS_PATH)) {
        const server = serverGateway.loadMachineConfig(config.machinePath);
        return { ok: true, status: 200, text: async () => JSON.stringify(serverGateway.publicDiscovery(server)) };
      }
      return { ok: false, status: 404, text: async () => "{}" };
    };
    // checkHealth is the console's default harness probe.
    globalThis.__testFetch = fetchImpl;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      const health = await checkHealth(config, { timeoutMs: 500 });
      assert.equal(health.ok, true);
      assert.equal(seen[0].token, CODEX_TOKEN);
      assert.equal(seen[0].url.includes("token="), false);
      const discovery = await checkMachineGateway(config, { fetchImpl, timeoutMs: 500 });
      assert.equal(discovery.ok, true);
      assert.equal(discovery.harnessCount, 2);
      assert.equal(discovery.defaultHarnessId, "codex");
      assert.equal(discovery.harnesses.length, 2);
      assert.equal(discovery.harnesses.some((item) => item.token), false);
      assert.equal(seen.some((item) => item.url.includes("token=")), false);
    } finally {
      globalThis.fetch = originalFetch;
      delete globalThis.__testFetch;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an unrelated healthy old dispatcher is NOT adopted as a machine gateway", async () => {
  const dir = tmpDir();
  try {
    const config = configWithMachine(dir);
    const logger = { lines: [], info(...a) { this.lines.push(a); }, warn(...a) { this.lines.push(a); }, error(...a) { this.lines.push(a); } };
    const owner = { pid: 4242, name: "node.exe" };
    const controller = new ServiceController({
      config,
      logger,
      health: {
        // Old dual dispatcher: /api/health succeeds but /__turnloom/health is 404.
        check: async () => ({ ok: true, status: 200, latencyMs: 4, data: { ok: true } }),
        checkMachineGateway: async () => ({ ok: false, code: "not-machine-gateway", error: "端口上的服务不是这台电脑的一机一码网关" }),
        checkPortAvailable: async () => ({ available: false }),
        findPortOwner: async () => owner,
      },
      processControl: { getProcessStart: async () => Date.now(), getProcessMetrics: async () => null },
    });
    controller.spawnChild = () => { throw new Error("must not spawn over an external listener"); };
    const result = await controller.start();
    assert.equal(result.ok, false);
    assert.equal(result.code, "not-machine-gateway");
    assert.equal(controller.state, "error");
    assert.equal(controller.managed, false);
    await controller.dispose();

    // Same healthy /api/health, but a verified gateway discovery -> adopt.
    const healthyGateway = new ServiceController({
      config,
      logger,
      health: {
        check: async () => ({ ok: true, status: 200, latencyMs: 4, data: { ok: true } }),
        checkMachineGateway: async () => ({ ok: true, harnessCount: 2, defaultHarnessId: "codex" }),
        checkPortAvailable: async () => ({ available: false }),
        findPortOwner: async () => owner,
      },
      processControl: { getProcessStart: async () => Date.now(), getProcessMetrics: async () => null },
    });
    healthyGateway.spawnChild = () => { throw new Error("must not spawn over an adopted gateway"); };
    const adopted = await healthyGateway.start();
    assert.equal(adopted.ok, true);
    assert.equal(adopted.adopted, true);
    assert.equal(adopted.external, true);
    assert.equal(healthyGateway.pid, owner.pid);
    assert.equal(healthyGateway.managed, false);
    await healthyGateway.dispose();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("watchdog ownership rule preserved: adopted external service is never killed", async () => {
  const dir = tmpDir();
  try {
    const config = configWithMachine(dir);
    const logger = { lines: [], info(...a) { this.lines.push(a); }, warn(...a) { this.lines.push(a); }, error(...a) { this.lines.push(a); } };
    const controller = new ServiceController({
      config,
      logger,
      health: {
        check: async () => ({ ok: true, status: 200, latencyMs: 3, data: { ok: true } }),
        checkMachineGateway: async () => ({ ok: true, harnessCount: 2, defaultHarnessId: "codex" }),
        checkPortAvailable: async () => ({ available: false }),
        findPortOwner: async () => ({ pid: 5555, name: "node.exe" }),
      },
      processControl: { getProcessStart: async () => Date.now(), getProcessMetrics: async () => null },
    });
    controller.spawnChild = () => { throw new Error("must not spawn"); };
    await controller.start();
    assert.equal(controller.snapshot().service.external, true);
    let kills = 0;
    let taskkills = 0;
    controller.killChild = async () => { kills += 1; };
    controller.execFileAsync = async (file) => { if (file === "taskkill.exe") taskkills += 1; return { ok: true }; };
    await controller.stop();
    assert.equal(kills, 0);
    assert.equal(taskkills, 0);
    assert.equal(controller.pid, 0);
    assert.equal(controller.state, "stopped");
    assert.match(logger.lines.map((line) => line.join(" ")).join("\n"), /控制台已断开服务显示/);
    await controller.dispose();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("migration helper is dry-run by default, reversible, and never prints secrets", () => {
  const dir = tmpDir();
  try {
    const legacy = legacyDualConfig(dir);
    const legacyFile = path.join(dir, "legacy-config.json");
    const configFile = path.join(dir, "config.json");
    const machineFile = path.join(dir, "machine.json");
    fs.writeFileSync(legacyFile, `${JSON.stringify(legacy, null, 2)}\n`, "utf8");
    const baseConfig = consoleConfig(dir, machineFile);
    fs.writeFileSync(configFile, `${JSON.stringify(baseConfig, null, 2)}\n`, "utf8");
    const args = ["--config", configFile, "--machine-config", machineFile, "--import-config", legacyFile,
      "--origin", "https://turnloom.example.test"];
    const plan = cli.buildPlan(cli.parseArgs(["--dry-run", ...args]));
    assert.equal(plan.mode, "dry-run");
    assert.equal(plan.errors.length, 0, plan.errors.join("; "));
    assert.equal(plan.consistency.ok, true);
    assert.equal(plan.distinct, true);
    assert.equal(plan.machine.harnesses.length, 2);
    assert.equal(plan.importSource, legacyFile);
    assert.equal(fs.existsSync(machineFile), false, "dry-run must not write machine.json");
    assert.equal(fs.readFileSync(configFile, "utf8"), `${JSON.stringify(baseConfig, null, 2)}\n`);
    assert.equal(fs.readFileSync(legacyFile, "utf8"), `${JSON.stringify(legacy, null, 2)}\n`);
    for (const secret of [MACHINE_TOKEN, CODEX_TOKEN, PIDESK_TOKEN]) {
      assert.equal(JSON.stringify(plan.redacted).includes(secret), false, "redacted plan leaked a token");
      assert.equal(cli.report(plan).includes(secret), false, "report leaked a token");
    }
    assert.match(cli.report(plan), /service control: none/);
    assert.match(cli.report(plan), /NEXT \(operator\)/);

    // Explicit --apply writes only per-user files, with backups. A fresh
    // machine token is generated once because machine.json did not exist.
    const applied = cli.applyPlan(cli.buildPlan(cli.parseArgs(["--apply", ...args])));
    assert.equal(applied.ok, true);
    assert.equal(applied.restarted, false);
    assert.ok(applied.backups.length >= 1);
    assert.equal(fs.readFileSync(legacyFile, "utf8"), `${JSON.stringify(legacy, null, 2)}\n`, "sibling config must remain read-only");
    const savedMachine = desktopGateway.readJson(machineFile);
    assert.deepEqual(savedMachine.harnesses.map((item) => item.token), [CODEX_TOKEN, PIDESK_TOKEN]);
    assert.notEqual(savedMachine.machineToken, CODEX_TOKEN);
    assert.notEqual(savedMachine.machineToken, PIDESK_TOKEN);
    assert.equal(savedMachine.machineId, plan.machine.machineId);
    const savedConsole = desktopGateway.readJson(configFile);
    assert.equal(savedConsole.machineGateway.enabled, true);
    assert.equal(savedConsole.machineGateway.origin, "https://turnloom.example.test");
    assert.equal(savedConsole.machineGateway.machineConfigPath, machineFile);

    // Re-running the SAME import preserves the already-generated machine
    // token: the QR stays stable and phones do not need to re-scan.
    const reapplied = cli.applyPlan(cli.buildPlan(cli.parseArgs(["--apply", ...args])));
    assert.equal(reapplied.ok, true);
    assert.equal(desktopGateway.readJson(machineFile).machineToken, savedMachine.machineToken);

    // Disable is the reversible runtime switch; machine.json is kept.
    const disabled = cli.applyPlan(cli.buildPlan(cli.parseArgs(["--apply", "--disable",
      "--config", configFile, "--machine-config", machineFile])));
    assert.equal(disabled.action, "disable");
    assert.equal(desktopGateway.readJson(configFile).machineGateway.enabled, false);
    assert.equal(fs.existsSync(machineFile), true);
    assert.equal(desktopGateway.readJson(machineFile).machineToken, savedMachine.machineToken);

    // Full rollback from a backup restores the exact original console config.
    const backup = applied.backups.find((file) => file.includes("config.json")) || applied.backups[0];
    const restored = cli.applyPlan(cli.buildPlan(cli.parseArgs(["--apply", "--restore", backup,
      "--config", configFile, "--machine-config", machineFile])));
    assert.equal(restored.action, "restore");
    assert.equal(desktopGateway.readJson(configFile).machineGateway.enabled, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("migration refuses unsafe writes and inconsistent machine configurations", () => {
  const dir = tmpDir();
  try {
    const repoConfig = path.join(ROOT, "deploy", "machine.example.json");
    const legacyFile = path.join(dir, "legacy.json");
    const machineFile = path.join(dir, "machine.json");
    fs.writeFileSync(legacyFile, JSON.stringify(legacyDualConfig(dir)), "utf8");
    const unsafe = cli.buildPlan(cli.parseArgs(["--apply", "--config", repoConfig,
      "--machine-config", machineFile, "--import-config", legacyFile]));
    assert.ok(unsafe.errors.some((error) => error.includes("源码仓库")));
    assert.throws(() => cli.applyPlan(unsafe), /源码仓库/);

    const badMachine = writeMachine(dir, [
      { id: "a", name: "A", token: MACHINE_TOKEN, port: 18788, spawn: false },
      { id: "b", name: "B", token: PIDESK_TOKEN, port: 8799, spawn: false },
    ]);
    const badPlan = cli.buildPlan(cli.parseArgs(["--dry-run", "--config", path.join(dir, "config.json"),
      "--machine-config", badMachine.file]));
    assert.ok(badPlan.errors.some((error) => error.includes("machineToken 与 harness token")));
    assert.equal(badPlan.consistency.ok, false);
    assert.equal(fs.existsSync(path.join(dir, "config.json")), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("migration helper rejects unsafe origins and can roll back with a broken machine.json", () => {
  const dir = tmpDir();
  try {
    const machine = writeMachine(dir);
    const configFile = path.join(dir, "config.json");
    const base = consoleConfig(dir, machine.file);
    fs.writeFileSync(configFile, JSON.stringify(base), "utf8");
    assert.throws(() => cli.buildPlan(cli.parseArgs(["--dry-run", "--config", configFile,
      "--machine-config", machine.file, "--origin", "https://host/login?token=SECRET"])), /--origin/);
    assert.throws(() => cli.buildPlan(cli.parseArgs(["--dry-run", "--config", configFile,
      "--machine-config", machine.file, "--origin", "ftp://host"])), /--origin/);

    // A corrupt machine.json must not prevent --disable / --restore.
    fs.writeFileSync(machine.file, "{ not json", "utf8");
    const disabled = cli.buildPlan(cli.parseArgs(["--apply", "--disable", "--config", configFile,
      "--machine-config", machine.file]));
    assert.equal(disabled.errors.length, 0, disabled.errors.join("; "));
    assert.equal(disabled.machine, null);
    assert.match(cli.report(disabled), /not required for rollback/);
    const applied = cli.applyPlan(disabled);
    assert.equal(applied.action, "disable");
    assert.equal(desktopGateway.readJson(configFile).machineGateway.enabled, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("live discovery verification requires both the gateway marker and a matching discovery", async () => {
  const dir = tmpDir();
  try {
    const config = configWithMachine(dir);
    const machine = desktopGateway.loadMachineConfig(config);
    const server = serverGateway.loadMachineConfig(config.machinePath);
    const discoveryBody = serverGateway.publicDiscovery(server);

    const mockFetch = (mode) => async (url) => {
      const respond = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
      if (url.endsWith(desktopGateway.HEALTH_MARKER_PATH)) {
        if (mode === "old-dispatcher") return respond(404, { error: "not found" });
        if (mode === "wrong-machine") {
          return respond(200, { ok: true, protocol: shared.PROTOCOL, version: shared.VERSION, machineId: "another-machine", harnessCount: 2 });
        }
        return respond(200, { ok: true, protocol: shared.PROTOCOL, version: shared.VERSION, machineId: "office-01", harnessCount: 2 });
      }
      if (url.endsWith(shared.HARNESS_PATH)) {
        if (mode === "one-harness") {
          return respond(200, { ...discoveryBody, harnesses: [discoveryBody.harnesses[0]], defaultHarnessId: "codex" });
        }
        if (mode === "wrong-token") return respond(401, { error: "invalid-machine-token" });
        return respond(200, discoveryBody);
      }
      return respond(404, {});
    };

    assert.equal((await desktopGateway.checkGatewayDiscovery({
      origin: "https://turnloom.example.test", machine, fetchImpl: mockFetch("good"),
    })).ok, true);
    assert.equal((await desktopGateway.checkGatewayDiscovery({
      origin: "https://turnloom.example.test", machine, fetchImpl: mockFetch("old-dispatcher"),
    })).code, "not-machine-gateway");
    assert.equal((await desktopGateway.checkGatewayDiscovery({
      origin: "https://turnloom.example.test", machine, fetchImpl: mockFetch("wrong-machine"),
    })).code, "not-machine-gateway");
    assert.equal((await desktopGateway.checkGatewayDiscovery({
      origin: "https://turnloom.example.test", machine, fetchImpl: mockFetch("wrong-token"),
    })).code, "discovery-unavailable");
    assert.equal((await desktopGateway.checkGatewayDiscovery({
      origin: "https://turnloom.example.test", machine, fetchImpl: mockFetch("one-harness"),
    })).code, "discovery-mismatch");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("end-to-end: real server gateway + desktop QR + phone-side discovery normalization", async () => {
  const dir = tmpDir();
  try {
    const config = configWithMachine(dir, { port: 0 });
    // Two stub backends on ephemeral ports so the real gateway can proxy.
    const backends = [];
    for (const name of ["codex", "pidesk"]) {
      const server = http.createServer((req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, harness: name, token: req.headers["x-access-token"] || "", path: req.url }));
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      backends.push({ name, server, port: server.address().port });
    }
    // Point machine.json at the stub ports for the live gateway fixture.
    const liveMachine = writeMachine(dir, [
      { id: "codex", name: "Codex", token: CODEX_TOKEN, port: backends[0].port, spawn: false },
      { id: "pidesk", name: "PI-Desktop", token: PIDESK_TOKEN, port: backends[1].port, spawn: false },
    ]);
    const liveConfig = consoleConfig(dir, liveMachine.file);
    const gatewayConfig = serverGateway.loadMachineConfig(liveMachine.file);
    const instance = serverGateway.createGateway(gatewayConfig, { logDir: path.join(dir, "logs"), log: () => {} });
    await instance.listen("127.0.0.1", 0);
    const port = instance.server.address().port;
    const origin = `http://127.0.0.1:${port}`;
    try {
      liveConfig.machineGateway.origin = origin;
      liveConfig.publicUrl = origin;
      const qr = await generatePairing(liveConfig);
      const parsed = shared.parseMachinePairingPayload(qr.payload);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.pairing.serverUrl, origin);
      assert.equal(qr.url, origin);
      assert.equal(listPairingTargets(liveConfig)[0].url, origin);
      assert.equal(listPairingTargets(liveConfig)[0].harnessCount, 2);

      const httpGet = (pathname, token) => new Promise((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, path: pathname,
          headers: token ? { "x-access-token": token } : {} }, (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => { body += chunk; });
          res.on("end", () => resolve({ status: res.statusCode, body }));
        });
        req.on("error", reject);
        req.end();
      });

      // The CLI's read-only live probe validates the SAME endpoints the phone uses.
      const probe = await cli.probe(cli.buildPlan(cli.parseArgs(["--dry-run",
        "--config", path.join(dir, "unused-config.json"),
        "--machine-config", liveMachine.file,
        "--origin", origin])), { "probe-url": origin });
      assert.equal(probe.ok, true, probe.error);
      assert.equal(probe.harnessCount, 2);
      assert.equal(probe.defaultHarnessId, "codex");
      assert.equal(probe.harnesses.length, 2);
      assert.equal(JSON.stringify(probe).includes(MACHINE_TOKEN), false);

      const discovery = await httpGet(shared.HARNESS_PATH, MACHINE_TOKEN);
      assert.equal(discovery.status, 200);
      const checked = shared.normalizeDiscovery(JSON.parse(discovery.body), parsed.pairing);
      assert.equal(checked.ok, true);
      assert.deepEqual(checked.machine.harnesses.map((item) => item.id), ["codex", "pidesk"]);
      assert.deepEqual(checked.machine.harnesses.map((item) => item.token), [CODEX_TOKEN, PIDESK_TOKEN]);

      // Machine token cannot be used for business APIs; each harness token
      // routes to its real upstream (and returns that upstream's own data).
      const machineOnApi = await httpGet("/api/health", MACHINE_TOKEN);
      assert.equal(machineOnApi.status, 401);
      for (const [index, backend] of backends.entries()) {
        const token = [CODEX_TOKEN, PIDESK_TOKEN][index];
        const routed = await httpGet("/api/health", token);
        assert.equal(routed.status, 200);
        const body = JSON.parse(routed.body);
        assert.equal(body.harness, backend.name);
        assert.equal(body.token, token);
      }
    } finally {
      await instance.close();
      await Promise.all(backends.map(({ server }) => new Promise((resolve) => server.close(resolve))));
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
