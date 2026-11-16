"use strict";

/**
 * 配对主路径的凭据规则（2026-11-16 实测回归）。
 *
 * 背景：手机扫码报「多服务模式下机器访问码不能同时作为服务访问码」后完全无法连接。
 * 真实原因是 machine.json 的 legacyMachineTokens 里残留了旧机器码，而它正好等于
 * codex 服务的访问码——即「机器码 == 某个服务码」。桌面端当时只校验 machineToken，
 * 没校验 legacyMachineTokens，于是这份配置一路放到手机上才被客户端拦下。
 *
 * 这里钉死三条不变量：
 *   1. 单服务模式下机器码 == 服务码是兼容部署，必须放行（网关文档明确允许）；
 *   2. 多服务模式下机器码 == 任一服务码必须拒绝，且错误要能指导用户；
 *   3. 桌面端保存配置时，legacyMachineTokens 也不能等于任何服务码。
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const shared = require(path.join(__dirname, "..", "shared", "machine-pairing.cjs"));
const desktopGateway = require(path.join(__dirname, "..", "desktop", "service", "machine-gateway.cjs"));

const MACHINE_TOKEN = "machine-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CODEX_TOKEN = "684271";
const PIDESK_TOKEN = "pidesk-2026";

function pairing(machineToken = MACHINE_TOKEN) {
  return {
    protocol: "codex-turnloom",
    version: 2,
    source: "manual",
    machineId: "de",
    machineName: "de",
    serverUrl: "https://relay.example.com",
    machineToken,
    discoverPath: "/api/harnesses",
  };
}

function discovery(harnesses) {
  return {
    ok: true,
    protocol: "codex-turnloom",
    version: 2,
    machineId: "de",
    machineName: "de",
    defaultHarnessId: harnesses[0].id,
    harnesses,
  };
}

test("单服务模式：机器码与服务码相同必须放行（兼容部署）", () => {
  const body = discovery([{ id: "codex", name: "Codex", token: MACHINE_TOKEN, kind: "codex" }]);
  const result = shared.normalizeDiscovery(body, pairing());
  assert.equal(result.ok, true, result.ok ? "" : `被错误拒绝：${result.code} ${result.error}`);
  assert.equal(result.machine.harnesses.length, 1);
  assert.equal(result.machine.harnesses[0].token, MACHINE_TOKEN);
});

test("多服务模式：机器码等于某个服务码必须拒绝，并指出是哪个服务", () => {
  const body = discovery([
    { id: "codex", name: "Codex", token: CODEX_TOKEN, kind: "codex" },
    { id: "pidesk", name: "PI-Desktop", token: PIDESK_TOKEN, kind: "pi" },
  ]);
  const result = shared.normalizeDiscovery(body, pairing(CODEX_TOKEN));
  assert.equal(result.ok, false);
  assert.equal(result.code, "machine-token-reuse");
  assert.match(result.error, /Codex/);
});

test("多服务模式：三个凭据互不相同则正常通过", () => {
  const body = discovery([
    { id: "codex", name: "Codex", token: CODEX_TOKEN, kind: "codex" },
    { id: "pidesk", name: "PI-Desktop", token: PIDESK_TOKEN, kind: "pi" },
  ]);
  const result = shared.normalizeDiscovery(body, pairing());
  assert.equal(result.ok, true, result.ok ? "" : `${result.code} ${result.error}`);
  assert.equal(result.machine.harnesses.length, 2);
});

test("桌面端剔除与 harness 冲突的 legacyMachineTokens（不阻断启动）", () => {
  // 直接报错会让「手机还存着旧机器码」的用户在启动/保存时被硬拦，且无法自愈。
  // 正解是静默剔除冲突项并记诊断，让服务继续可用。
  const config = desktopGateway.normalizeMachineConfig({
    machineId: "de",
    machineName: "de",
    machineToken: MACHINE_TOKEN,
    defaultHarness: "codex",
    legacyMachineTokens: [CODEX_TOKEN, "old-but-safe-token"],
    harnesses: [
      { id: "codex", name: "Codex", token: CODEX_TOKEN, kind: "codex", port: 18788, spawn: false },
      { id: "pidesk", name: "PI-Desktop", token: PIDESK_TOKEN, kind: "pi", port: 8799, spawn: false },
    ],
  });
  assert.deepEqual(config.legacyMachineTokens, ["old-but-safe-token"]);
  assert.deepEqual(config.conflictingLegacyMachineTokens, [CODEX_TOKEN]);
  assert.equal(config.harnesses.length, 2);
});

test("桌面端允许只含合法历史机器码的多服务配置", () => {
  const config = desktopGateway.normalizeMachineConfig({
    machineId: "de",
    machineName: "de",
    machineToken: MACHINE_TOKEN,
    defaultHarness: "codex",
    legacyMachineTokens: ["old-machine-token-not-a-harness"],
    harnesses: [
      { id: "codex", name: "Codex", token: CODEX_TOKEN, kind: "codex", port: 18788, spawn: false },
      { id: "pidesk", name: "PI-Desktop", token: PIDESK_TOKEN, kind: "pi", port: 8799, spawn: false },
    ],
  });
  assert.deepEqual(config.legacyMachineTokens, ["old-machine-token-not-a-harness"]);
  assert.equal(config.harnesses.length, 2);
});
