"use strict";
const fs = require("node:fs");
const gateway = require("../desktop/service/machine-gateway.cjs");
const { explicitTransport, sshEnabled } = require("../desktop/service/transport.cjs");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}
function loadWatchdogConfig(mainPath, dualPath) {
  const main = readJson(mainPath);
  if (explicitTransport(main)) main.tunnel = { ...main.tunnel, enabled: sshEnabled(main) };
  if (gateway.gatewayMode(main)) {
    const machine = gateway.loadMachineConfig(main);
    return { main, machine, devices: machine.harnesses.map((h) => ({ ...h, key: h.id })) };
  }
  const dual = readJson(dualPath);
  return { main, machine: null, devices: Array.isArray(dual.devices) ? dual.devices : [] };
}
function dispatcherPlan(main, dualDir) {
  if (gateway.gatewayMode(main)) {
    const plan = gateway.gatewaySpawn(main);
    return { command: plan.nodePath, args: plan.args, cwd: plan.cwd };
  }
  return {
    command: process.execPath,
    cwd: dualDir,
    args: ["server.js", "--host", "0.0.0.0", "--port", String(main.port),
      "--password", String(main.accessCode), "--codex-home", String(main.codexHome),
      "--public-url", String(main.publicUrl || "")],
  };
}
module.exports = { loadWatchdogConfig, dispatcherPlan, checkGatewayDiscovery: gateway.checkGatewayDiscovery };
