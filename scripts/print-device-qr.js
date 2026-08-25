#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import qrcode from "qrcode-terminal";

const args = process.argv.slice(2);
const configIndex = args.indexOf("--config");
const configPath = configIndex >= 0 && args[configIndex + 1]
  ? path.resolve(args[configIndex + 1])
  : path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "CodexPocket", "config.json");

if (!fs.existsSync(configPath)) {
  console.error(`Config not found: ${configPath}`);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""));
const publicUrl = String(config.publicUrl || "").replace(/\/+$/, "");
if (!publicUrl) {
  console.error("publicUrl is empty in the local config.");
  process.exit(1);
}

const importUrl = new URL("codexpocket://add");
importUrl.searchParams.set("name", config.machineName || os.hostname());
importUrl.searchParams.set("url", publicUrl);
importUrl.searchParams.set("token", config.accessCode || "");

console.log("");
console.log(`Device: ${config.machineName || os.hostname()}`);
console.log(`URL:    ${publicUrl}`);
console.log("Scan this code in Codex Pocket to add or update the computer:");
qrcode.generate(importUrl.toString(), { small: true });
