"use strict";

const fs = require("node:fs");
const QRCode = require("qrcode");
const { pairingPayload, urlsFor } = require("./config.cjs");

async function generatePairing(config) {
  const payload = pairingPayload(config);
  const dataUrl = await QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 512,
    color: { dark: "#0F172A", light: "#FFFFFF" }
  });
  const urls = urlsFor(config);
  return {
    payload,
    dataUrl,
    machineName: config.machineName,
    url: urls.publicUrl || urls.lan,
    lanUrl: urls.lan,
    publicUrl: urls.publicUrl,
    accessCode: config.accessCode
  };
}

async function savePairingPng(config, filePath) {
  const pairing = await generatePairing(config);
  const base64 = String(pairing.dataUrl).split(",")[1] || "";
  fs.writeFileSync(filePath, Buffer.from(base64, "base64"));
  return pairing;
}

module.exports = { generatePairing, savePairingPng };
