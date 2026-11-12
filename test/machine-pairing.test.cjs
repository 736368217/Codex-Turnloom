"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");

const pairing = require(path.join(__dirname, "..", "shared", "machine-pairing.cjs"));
const gateway = require(path.join(__dirname, "..", "server", "machine-gateway.cjs"));
const { generatePairing } = require(path.join(__dirname, "..", "desktop", "service", "pairing.cjs"));
const { defaultConfig } = require(path.join(__dirname, "..", "desktop", "service", "config.cjs"));

const MACHINE = {
  machineId: "office-01",
  machineName: "Office PC",
  url: "https://turnloom.example.com",
  machineToken: "MACHINE-TOKEN-PLACEHOLDER",
};

function discovery(harnesses = undefined) {
  return {
    ok: true,
    protocol: pairing.PROTOCOL,
    version: pairing.VERSION,
    machineId: MACHINE.machineId,
    machineName: MACHINE.machineName,
    defaultHarnessId: "pidesk",
    harnesses: harnesses || [
      { id: "codex", name: "Codex", token: "CODEX-TOKEN", kind: "codex", defaultHarness: true, online: true },
      { id: "pidesk", name: "PI-Desktop", token: "PIDESK-TOKEN", kind: "codex", defaultHarness: false, online: true },
    ],
  };
}

test("one machine QR contains a distinct stable id and display name", () => {
  const payload = pairing.machinePairingPayload(MACHINE);
  const url = new URL(payload);
  assert.equal(url.protocol, "codex-turnloom:");
  assert.equal(url.host, "pair");
  assert.equal(url.pathname, "/add");
  assert.equal(url.searchParams.get("machine"), "Office PC");
  assert.equal(url.searchParams.get("mid"), "office-01");
  assert.equal(url.searchParams.get("url"), MACHINE.url);
  assert.equal(url.searchParams.get("discover"), pairing.HARNESS_PATH);
  const parsed = pairing.parseMachinePairingPayload(payload);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.pairing.machineId, "office-01");
  assert.equal(parsed.pairing.machineName, "Office PC");
  assert.equal(parsed.pairing.serverUrl, MACHINE.url);
});

test("QR parser rejects unsafe URLs, duplicate parameters and legacy codes", () => {
  const good = pairing.machinePairingPayload(MACHINE);
  assert.equal(pairing.normalizeBaseUrl("https://host/login?token=SECRET"), "");
  assert.equal(pairing.normalizeBaseUrl("https://host/#login=SECRET"), "");
  assert.equal(pairing.normalizeBaseUrl("https://host/app/"), "");
  assert.equal(pairing.normalizeBaseUrl("ftp://host"), "");
  assert.equal(pairing.normalizeBaseUrl("http://user:pass@host"), "");
  assert.equal(pairing.parseMachinePairingPayload(`${good}&url=https://evil.example`).code, "duplicate-parameter");
  assert.equal(pairing.parseMachinePairingPayload(`${good}&extra=1`).code, "unknown-parameter");
  assert.equal(pairing.parseMachinePairingPayload("codex-turnloom://evil@pair/add?v=2").code, "invalid-qr");
  assert.equal(pairing.parseMachinePairingPayload(good.replace("v=2", "v=3")).code, "unsupported-version");
  assert.equal(pairing.parseMachinePairingPayload(good.replace("discover=%2Fapi%2Fharnesses", "discover=%2Fevil")).code, "invalid-discover");
  assert.equal(pairing.parseMachinePairingPayload("codexpocket://add?name=x&url=https://host&token=t").code, "legacy-qr");
  assert.equal(pairing.isLegacyPayload("https://host/login?token=t"), true);
  assert.equal(pairing.isLegacyPayload(good), false);
});

test("discovery normalizes all harnesses and honors defaultHarnessId", () => {
  const parsed = pairing.parseMachinePairingPayload(pairing.machinePairingPayload(MACHINE));
  const normalized = pairing.normalizeDiscovery(discovery(), parsed.pairing);
  assert.equal(normalized.ok, true);
  assert.equal(normalized.machine.harnesses.length, 2);
  assert.equal(normalized.machine.defaultHarnessId, "pidesk");
  assert.deepEqual(normalized.machine.harnesses.map((item) => item.defaultHarness), [false, true]);
  assert.equal(JSON.stringify(normalized).includes("port"), false);
  assert.equal(JSON.stringify(normalized).includes("codexHome"), false);
});

test("discovery rejects identity mismatch, duplicate tokens and machine-token reuse", () => {
  const parsed = pairing.parseMachinePairingPayload(pairing.machinePairingPayload(MACHINE));
  const mismatch = discovery();
  mismatch.machineId = "another-machine";
  assert.equal(pairing.normalizeDiscovery(mismatch, parsed.pairing).code, "machine-mismatch");

  const duplicate = discovery([
    { id: "a", name: "A", token: "SAME" },
    { id: "b", name: "B", token: "SAME" },
  ]);
  duplicate.defaultHarnessId = "a";
  assert.equal(pairing.normalizeDiscovery(duplicate, parsed.pairing).code, "invalid-harnesses");

  const reused = discovery([
    { id: "a", name: "A", token: MACHINE.machineToken },
    { id: "b", name: "B", token: "OTHER" },
  ]);
  reused.defaultHarnessId = "b";
  assert.equal(pairing.normalizeDiscovery(reused, parsed.pairing).code, "machine-token-reuse");

  const missing = discovery();
  delete missing.machineId;
  assert.equal(pairing.normalizeDiscovery(missing, parsed.pairing).code, "invalid-machine");
  assert.equal(pairing.normalizeDiscovery(discovery(), null).code, "missing-pairing");
});

test("desktop generates exactly one v2 machine QR", async () => {
  const config = defaultConfig({
    machineId: "office-01",
    machineName: "Office PC",
    machineToken: "MACHINE-TOKEN-PLACEHOLDER",
    accessCode: "OLD-SINGLE-HARNESS-CODE",
    publicUrl: "https://turnloom.example.com",
  });
  const result = await generatePairing(config);
  assert.equal(result.protocol, pairing.PROTOCOL);
  assert.equal(result.version, pairing.VERSION);
  assert.equal(result.discoverPath, pairing.HARNESS_PATH);
  assert.equal(result.devices.length, 1);
  const parsed = pairing.parseMachinePairingPayload(result.payload);
  assert.equal(parsed.pairing.machineId, "office-01");
  assert.equal(parsed.pairing.machineToken, "MACHINE-TOKEN-PLACEHOLDER");
  assert.equal(result.payload.includes("OLD-SINGLE-HARNESS-CODE"), false);
  const redacted = pairing.redactPairing(result);
  assert.equal(redacted.accessCode, "***");
  assert.equal(redacted.payload, "***");
});

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function request(port, pathname, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: pathname, headers: token ? { "x-access-token": token } : {} }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("gateway discovers two harnesses and routes by harness token", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-gateway-"));
  const configPath = path.join(dir, "machine.json");
  // Two stub backends on ephemeral ports prove the gateway routes by token.
  const backends = [];
  for (const name of ["codex", "pidesk"]) {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, harness: name, token: req.headers["x-access-token"] || "", path: req.url }));
    });
    await listen(server);
    backends.push({ name, server, port: server.address().port });
  }
  const fixture = {
    machineId: "office-01",
    machineName: "Office PC",
    machineToken: "MACHINE-TOKEN-PLACEHOLDER",
    defaultHarness: "pidesk",
    harnesses: [
      { id: "codex", name: "Codex", token: "CODEX-TOKEN", port: backends[0].port, spawn: false },
      { id: "pidesk", name: "PI-Desktop", token: "PIDESK-TOKEN", port: backends[1].port, spawn: false },
    ],
  };
  fs.writeFileSync(configPath, JSON.stringify(fixture), "utf8");
  const config = gateway.loadMachineConfig(configPath);
  const body = gateway.publicDiscovery(config);
  assert.equal(body.harnesses.length, 2);
  assert.equal(body.defaultHarnessId, "pidesk");
  assert.deepEqual(body.harnesses.map((item) => item.defaultHarness), [false, true]);
  assert.equal(JSON.stringify(body).includes(String(backends[0].port)), false);

  const instance = gateway.createGateway(config, { logDir: path.join(dir, "logs"), log: () => {} });
  await instance.listen("127.0.0.1", 0);
  const port = instance.server.address().port;
  try {
    const noToken = await request(port, pairing.HARNESS_PATH, "");
    assert.equal(noToken.status, 401);
    const badToken = await request(port, pairing.HARNESS_PATH, "wrong");
    assert.equal(badToken.status, 401);
    const good = await request(port, pairing.HARNESS_PATH, "MACHINE-TOKEN-PLACEHOLDER");
    assert.equal(good.status, 200);
    const parsed = JSON.parse(good.body);
    const parsedPairing = pairing.parseMachinePairingPayload(pairing.machinePairingPayload({
      ...MACHINE,
      url: `http://127.0.0.1:${port}`,
    }));
    const checked = pairing.normalizeDiscovery(parsed, parsedPairing.pairing);
    assert.equal(checked.ok, true);
    assert.equal(checked.machine.harnesses.length, 2);
    assert.equal(checked.machine.defaultHarnessId, "pidesk");
    const machineTokenOnApi = await request(port, "/api/health", "MACHINE-TOKEN-PLACEHOLDER");
    assert.equal(machineTokenOnApi.status, 401);
    assert.equal(JSON.parse(machineTokenOnApi.body).error, "machine-token-requires-discovery");
    for (const [index, backend] of backends.entries()) {
      const token = fixture.harnesses[index].token;
      const routed = await request(port, "/api/health", token);
      assert.equal(routed.status, 200);
      const routedBody = JSON.parse(routed.body);
      assert.equal(routedBody.harness, backend.name);
      assert.equal(routedBody.token, token);
    }
  } finally {
    await instance.close();
    await Promise.all(backends.map(({ server }) => new Promise((resolve) => server.close(resolve))));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("gateway config rejects duplicate tokens and machine-token reuse", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-gateway-bad-"));
  const file = path.join(dir, "machine.json");
  const base = {
    machineId: "m",
    machineName: "M",
    machineToken: "MACHINE",
    harnesses: [
      { id: "a", token: "SAME", port: 18001, spawn: false },
      { id: "b", token: "SAME", port: 18002, spawn: false },
    ],
  };
  fs.writeFileSync(file, JSON.stringify(base), "utf8");
  assert.throws(() => gateway.loadMachineConfig(file), /token 与其他 harness 重复/);
  base.harnesses[1].token = "MACHINE";
  fs.writeFileSync(file, JSON.stringify(base), "utf8");
  assert.throws(() => gateway.loadMachineConfig(file), /machineToken 不得等于/);
  fs.rmSync(dir, { recursive: true, force: true });
});
