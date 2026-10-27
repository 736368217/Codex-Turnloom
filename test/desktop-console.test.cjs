"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const { overallState, stateLabel } = require(path.join(__dirname, "..", "desktop", "service", "runtime.cjs"));
const { backoffDelay } = require(path.join(__dirname, "..", "desktop", "service", "controller.cjs"));
const { tunnelBackoff } = require(path.join(__dirname, "..", "desktop", "service", "tunnel.cjs"));
const { mergeConfig, normalizeConfig, publicConfig, defaultConfig, normalizeExtraDevices, pairingPayload, validateConfig } = require(path.join(__dirname, "..", "desktop", "service", "config.cjs"));

test("runtime state combines service and tunnel", () => {
  assert.equal(overallState({ state: "stopped" }, { enabled: false, state: "disabled" }), "stopped");
  assert.equal(overallState({ state: "running" }, { enabled: false, state: "disabled" }), "running");
  assert.equal(overallState({ state: "running" }, { enabled: true, state: "connected" }), "running");
  assert.equal(overallState({ state: "running" }, { enabled: true, state: "retrying" }), "degraded");
  assert.equal(overallState({ state: "error" }, { enabled: true, state: "connected" }), "error");
  assert.equal(stateLabel("degraded"), "部分可用");
});

test("service backoff follows the documented sequence", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(backoffDelay), [1000, 2000, 4000, 8000, 16000, 30000]);
});

test("tunnel backoff starts at 2s and caps at 300s", () => {
  assert.equal(tunnelBackoff(1), 2000);
  assert.equal(tunnelBackoff(2), 4000);
  assert.equal(tunnelBackoff(8), 128000);
  assert.equal(tunnelBackoff(20), 128000);
  assert.equal(tunnelBackoff(0), 2000);
});

test("config merge preserves unknown fields and console defaults", () => {
  const base = defaultConfig({ accessCode: "123456", codexHome: "D:\\codex\\.codex" });
  base.unknownField = { keep: true };
  const merged = mergeConfig(base, { port: 9000, console: { autoStart: false } });
  assert.equal(merged.port, 9000);
  assert.equal(merged.console.autoStart, false);
  assert.equal(merged.console.closeBehavior, "tray");
  assert.deepEqual(merged.unknownField, { keep: true });
  const normalized = normalizeConfig(merged);
  assert.equal(normalized.port, 9000);
});

test("public config never exposes the access code", () => {
  const config = defaultConfig({ accessCode: "654321", codexHome: "D:\\codex\\.codex" });
  const safe = publicConfig(config);
  assert.equal(safe.hasAccessCode, true);
  assert.equal(safe.accessCode, undefined);
  assert.match(safe.accessCodeMasked, /^•+$/);
});

test("extra devices are normalized, deduped and never expose their access codes", () => {
  const devices = normalizeExtraDevices([
    { id: "PI Desktop", name: "PI-Desktop", url: "http://127.0.0.1:8799/", accessCode: "111111" },
    { id: "PI Desktop", name: "PI-Desktop 2", url: "http://127.0.0.1:8799", accessCode: "222222" },
    { name: "", url: "http://x", accessCode: "333333" },
    { name: "Broken", url: "", accessCode: "444444" }
  ]);
  assert.equal(devices.length, 2);
  assert.equal(devices[0].id, "pi-desktop");
  assert.equal(devices[0].url, "http://127.0.0.1:8799");
  assert.notEqual(devices[0].id, devices[1].id);

  const config = defaultConfig({ accessCode: "654321", codexHome: "D:\\codex\\.codex", extraDevices: devices });
  const safe = publicConfig(config);
  assert.equal(safe.extraDeviceCount, 2);
  assert.equal(safe.extraDevices[0].accessCode, undefined);
  assert.equal(safe.extraDevices[0].hasAccessCode, true);
  assert.match(safe.extraDevices[0].accessCodeMasked, /^•+$/);
});

test("pairing payload targets the selected extra device", () => {
  const config = defaultConfig({
    accessCode: "654321",
    codexHome: "D:\\codex\\.codex",
    extraDevices: [{ id: "pidesk", name: "PI-Desktop", url: "http://192.168.1.10:8799", accessCode: "pidesk-code" }]
  });
  const payload = new URL(pairingPayload(config, config.extraDevices[0]));
  assert.equal(payload.protocol, "codexpocket:");
  assert.equal(payload.searchParams.get("name"), "PI-Desktop");
  assert.equal(payload.searchParams.get("url"), "http://192.168.1.10:8799");
  assert.equal(payload.searchParams.get("token"), "pidesk-code");
});

test("validateConfig rejects malformed ipc sockets and device addresses", () => {
  // validateConfig requires an existing codexHome with state_5.sqlite, so build a
  // throwaway one: D:\codex\.codex does not exist on the CI runner.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-home-"));
  fs.writeFileSync(path.join(home, "state_5.sqlite"), "");
  try {
    const base = defaultConfig({ accessCode: "654321", codexHome: home });
    assert.deepEqual(validateConfig(base), []);
    const badSocket = validateConfig({ ...base, ipcSocket: "codex-ipc" });
    assert.ok(badSocket.some((error) => error.field === "ipcSocket"));
    const badDevice = validateConfig({
      ...base,
      extraDevices: [{ id: "x", name: "X", url: "ftp://nope", accessCode: "1" }]
    });
    assert.ok(badDevice.some((error) => error.field === "extraDevices.x"));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
