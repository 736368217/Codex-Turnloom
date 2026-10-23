"use strict";

const fs = require("node:fs");
const QRCode = require("qrcode");
const { pairingPayload, urlsFor } = require("./config.cjs");

function localTarget(config) {
  const urls = urlsFor(config);
  return {
    id: "local",
    name: config.machineName || "这台电脑",
    url: urls.publicUrl || urls.lan,
    lanUrl: urls.lan,
    publicUrl: urls.publicUrl,
    kind: "local",
    isLocal: true,
    hasAccessCode: Boolean(config.accessCode)
  };
}

/** 配对页要展示的设备：本机 + 用户添加的其他 Turnloom（例如 PI-Desktop 桥）。 */
function listPairingTargets(config) {
  const extras = (config.extraDevices || []).map((device) => ({
    id: device.id,
    name: device.name,
    url: String(device.url || "").replace(/\/+$/, ""),
    lanUrl: "",
    publicUrl: "",
    kind: device.kind || "turnloom",
    isLocal: false,
    hasAccessCode: Boolean(device.accessCode)
  }));
  return [localTarget(config), ...extras];
}

async function generatePairing(config, deviceId = "local") {
  const targets = listPairingTargets(config);
  const target = targets.find((item) => item.id === deviceId) || targets[0];
  const device = target.isLocal
    ? null
    : (config.extraDevices || []).find((item) => item.id === target.id) || null;
  const payload = pairingPayload(config, device);
  const dataUrl = await QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 512,
    color: { dark: "#0F172A", light: "#FFFFFF" }
  });
  return {
    deviceId: target.id,
    deviceName: target.name,
    isLocal: target.isLocal,
    devices: targets,
    payload,
    dataUrl,
    machineName: target.name,
    url: target.url,
    lanUrl: target.lanUrl || "",
    publicUrl: target.publicUrl || "",
    accessCode: target.isLocal ? config.accessCode : device?.accessCode || ""
  };
}

async function savePairingPng(config, filePath, deviceId = "local") {
  const pairing = await generatePairing(config, deviceId);
  const base64 = String(pairing.dataUrl).split(",")[1] || "";
  fs.writeFileSync(filePath, Buffer.from(base64, "base64"));
  return pairing;
}

module.exports = { generatePairing, savePairingPng, listPairingTargets };
