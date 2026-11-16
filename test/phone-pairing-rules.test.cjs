"use strict";

/**
 * 手机端解析器（TypeScript 真源）的配对凭据门禁。
 *
 * test/pairing-credential-rules.test.cjs 覆盖的是 shared/*.cjs；手机实际跑的是
 * app/src/lib/machinePairing.ts。两者规则必须一致，所以这里直接跑 TS 真源，
 * 防止「CJS 放行、手机仍拦」这种只在真机上才暴露的漂移。
 *
 * 用 Node 自带的类型剥离（--experimental-strip-types）加载，不依赖 app 的 node_modules。
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "app", "src", "lib", "machinePairing.ts");

const MACHINE_TOKEN = "machine-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CODEX_TOKEN = "684271";
const PIDESK_TOKEN = "pidesk-2026";

const pairing = (machineToken = MACHINE_TOKEN) => ({
  protocol: "codex-turnloom",
  version: 2,
  source: "manual",
  machineId: "de",
  machineName: "de",
  serverUrl: "https://relay.example.com",
  machineToken,
  discoverPath: "/api/harnesses",
});

const discovery = (harnesses) => ({
  ok: true,
  protocol: "codex-turnloom",
  version: 2,
  machineId: "de",
  machineName: "de",
  defaultHarnessId: harnesses[0].id,
  harnesses,
});

// machinePairing.ts 只用 ES module 语法、无运行时依赖，可以直接 import 真源。
const loadPhone = () => import(`file:///${SRC.replace(/\\/g, "/")}`);

test("手机端：单服务模式下机器码 == 服务码必须放行", async () => {
  const phone = await loadPhone();
  const body = discovery([{ id: "codex", name: "Codex", token: MACHINE_TOKEN, kind: "codex" }]);
  const result = phone.normalizeDiscovery(body, pairing());
  assert.equal(result.ok, true, result.ok ? "" : `被错误拒绝：${result.code} ${result.error}`);
});

test("手机端：多服务模式下机器码 == 某个服务码必须拒绝，并点名该服务", async () => {
  const phone = await loadPhone();
  const body = discovery([
    { id: "codex", name: "Codex", token: CODEX_TOKEN, kind: "codex" },
    { id: "pidesk", name: "PI-Desktop", token: PIDESK_TOKEN, kind: "pi" },
  ]);
  const result = phone.normalizeDiscovery(body, pairing(CODEX_TOKEN));
  assert.equal(result.ok, false);
  assert.equal(result.code, "machine-token-reuse");
  assert.match(result.error, /Codex/);
});

test("手机端：凭据互不相同即通过（真实线上形状）", async () => {
  const phone = await loadPhone();
  const body = discovery([
    { id: "codex", name: "Codex", token: CODEX_TOKEN, kind: "codex", defaultHarness: true, online: true },
    { id: "pidesk", name: "PI-Desktop", token: PIDESK_TOKEN, kind: "pi", defaultHarness: false, online: true },
  ]);
  const result = phone.normalizeDiscovery(body, pairing());
  assert.equal(result.ok, true, result.ok ? "" : `${result.code} ${result.error}`);
  assert.equal(result.machine.defaultHarnessId, "codex");
});

test("手机端：重复的服务访问码仍被拒绝", async () => {
  const phone = await loadPhone();
  const body = discovery([
    { id: "a", name: "A", token: "SAME", kind: "codex" },
    { id: "b", name: "B", token: "SAME", kind: "pi" },
  ]);
  const result = phone.normalizeDiscovery(body, pairing());
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid-harnesses");
});

test("手机端：machine-token-reuse 的提示是可操作的中文文案", async () => {
  const phone = await loadPhone();
  const copy = phone.connectionErrorMessage(0, "machine-token-reuse");
  assert.match(copy, /机器访问码/);
  assert.match(copy, /重新扫码|不同的值/);
});

test("手机端真源存在且未被同名 CJS 副本替代", () => {
  assert.ok(fs.existsSync(SRC), "缺少 app/src/lib/machinePairing.ts");
  const text = fs.readFileSync(SRC, "utf8");
  assert.ok(text.includes("harnesses.length > 1"), "多服务判定条件缺失");
});
