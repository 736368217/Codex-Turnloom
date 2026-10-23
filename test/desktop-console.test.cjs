"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { overallState, stateLabel } = require(path.join(__dirname, "..", "desktop", "service", "runtime.cjs"));
const { backoffDelay } = require(path.join(__dirname, "..", "desktop", "service", "controller.cjs"));
const { tunnelBackoff } = require(path.join(__dirname, "..", "desktop", "service", "tunnel.cjs"));
const { mergeConfig, normalizeConfig, publicConfig, defaultConfig } = require(path.join(__dirname, "..", "desktop", "service", "config.cjs"));

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
  assert.equal(tunnelBackoff(1), 2);
  assert.equal(tunnelBackoff(2), 4);
  assert.equal(tunnelBackoff(8), 128);
  assert.equal(tunnelBackoff(20), 128);
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
