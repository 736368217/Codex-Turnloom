"use strict";

/**
 * Isolated QA fixture for the Codex-Turnloom v2 machine-pairing protocol.
 * It serves /api/harnesses plus two independent /api/health backends so the
 * phone can prove "one QR -> all harnesses" without touching any real data.
 */
const http = require("node:http");
const path = require("node:path");
const gateway = require(path.join(__dirname, "..", "..", "server", "machine-gateway.cjs"));
const pairing = require(path.join(__dirname, "..", "..", "shared", "machine-pairing.cjs"));

const MACHINE_TOKEN = "QA_MACHINE_TOKEN";
const HARNESS = [
  { id: "codex", name: "Codex QA", token: "QA_CODEX_TOKEN" },
  { id: "pidesk", name: "PI-Desktop QA", token: "QA_PIDESK_TOKEN" },
];

function stub(label) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({
        ok: true,
        label,
        path: req.url,
        token: req.headers["x-access-token"] || "",
        threads: [],
        total: 0,
        models: [],
        usedModelIds: [],
        defaultModel: "qa-model",
        defaultEffort: "medium",
        allowWrite: true,
        authRequired: true,
      }));
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

async function main() {
  const backends = [];
  for (const harness of HARNESS) backends.push(await stub(harness.name));
  const config = {
    configPath: path.join(__dirname, "machine-qa-fixture.json"),
    machineId: "qa-machine",
    machineName: "QAHost",
    machineToken: MACHINE_TOKEN,
    defaultHarnessId: HARNESS[0].id,
    harnesses: HARNESS.map((item, index) => ({
      id: item.id,
      name: item.name,
      token: item.token,
      kind: "codex",
      port: backends[index].port,
      entry: path.join(__dirname, "..", "..", "server.js"),
      codexHome: "",
      spawn: false,
      extraArgs: [],
      defaultHarness: item.id === HARNESS[0].id,
    })),
    publicUrl: "",
  };
  config.byToken = new Map(config.harnesses.map((item) => [item.token, item]));
  const instance = gateway.createGateway(config, {
    logDir: path.join(__dirname, "logs"),
    log: () => {},
  });
  await instance.listen("127.0.0.1", Number(process.argv[2] || 18080));
  console.log(JSON.stringify(pairing.redactPairing({
    ok: true,
    url: `http://127.0.0.1:${instance.server.address().port}`,
    qr: pairing.machinePairingPayload({
      machineId: config.machineId,
      machineName: config.machineName,
      machineToken: config.machineToken,
      url: `http://127.0.0.1:${instance.server.address().port}`,
    }),
    machineToken: config.machineToken,
    harnessCount: config.harnesses.length,
  }), null, 2));
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      instance.close().finally(() => {
        Promise.all(backends.map((entry) => new Promise((resolve) => entry.server.close(resolve)))).finally(() => process.exit(0));
      });
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
