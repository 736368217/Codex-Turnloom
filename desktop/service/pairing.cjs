"use strict";

const fs = require("node:fs");
const path = require("node:path");
const QRCode = require("qrcode");
const {
  machinePairingPayload,
  urlsFor,
  maskAccessCode,
} = require("./config.cjs");
const gateway = require("./machine-gateway.cjs");
const { PROTOCOL, VERSION, HARNESS_PATH } = require(path.join(__dirname, "..", "..", "shared", "machine-pairing.cjs"));

/**
 * 一机一码：只生成本机 QR；harness 列表由 /api/harnesses 在扫码后返回。
 *
 * The QR identity (id, name, token, origin) is taken from the SAME source the
 * gateway uses for discovery. In gateway mode that source is the per-user
 * runtime machine.json; in legacy mode it is the console config.json. Use
 * config.cjs's machinePairingPayload as the single codec entry point so the
 * QR cannot drift from discovery again.
 */
async function generatePairing(config, deviceId = "local") {
  const urls = urlsFor(config);
  const identity = gateway.pairingIdentity(config, urls);
  const payload = machinePairingPayload(config);
  const dataUrl = await QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 512,
    color: { dark: "#0F172A", light: "#FFFFFF" }
  });
  const origin = identity.url || urls.publicUrl || urls.lan;
  return {
    deviceId: "local",
    deviceName: identity.machineName,
    machineName: identity.machineName,
    machineId: identity.machineId,
    isLocal: true,
    devices: [{
      id: "local",
      name: identity.machineName,
      url: origin,
      isLocal: true,
      hasAccessCode: Boolean(identity.machineToken),
    }],
    protocol: PROTOCOL,
    version: VERSION,
    discoverPath: HARNESS_PATH,
    payload,
    dataUrl,
    url: origin,
    lanUrl: urls.lan,
    publicUrl: urls.publicUrl,
    // The QR is a bearer credential. Never fall back to the legacy accessCode
    // here: that would pair the phone to an unrelated single-harness service.
    accessCode: identity.accessCode,
    accessCodeMasked: identity.gatewayMode
      ? gateway.maskToken(identity.machineToken)
      : maskAccessCode(config.accessCode),
    machineGateway: gateway.gatewaySummary(config),
    harnessCount: identity.machine?.harnesses?.length || 0,
  };
}

function listPairingTargets(config) {
  const urls = urlsFor(config || {});
  const summary = gateway.gatewaySummary(config);
  const origin = summary.origin || urls.publicUrl || urls.lan;
  return [{
    id: "local",
    name: summary.enabled && summary.machineName ? summary.machineName : (config?.machineName || "这台电脑"),
    url: origin,
    lanUrl: urls.lan,
    publicUrl: urls.publicUrl,
    kind: "local",
    isLocal: true,
    gatewayMode: summary.enabled,
    harnessCount: summary.harnessCount,
    hasAccessCode: summary.enabled ? summary.hasMachineToken : Boolean(config?.machineToken || config?.accessCode),
  }];
}

async function savePairingPng(config, filePath, deviceId = "local") {
  const pairing = await generatePairing(config, deviceId);
  const base64 = String(pairing.dataUrl).split(",")[1] || "";
  fs.writeFileSync(filePath, Buffer.from(base64, "base64"));
  return pairing;
}

module.exports = { generatePairing, savePairingPng, listPairingTargets };
