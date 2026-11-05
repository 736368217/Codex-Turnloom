"use strict";
/**
 * Install turnloom-pidesktop/plugin into the PI-Desktop plugin directory and register it.
 *
 * The data root can be relocated (see %APPDATA%\PI-Desktop\storage-location.json), and the
 * plugin registry lives next to the data root, so both must be resolved instead of hardcoded:
 * writing to ~/.pi-desktop/plugins while the app reads D:\pi-data\data\plugins silently
 * updates nothing (that mistake cost one debugging round).
 *
 * The deploy directory is taken from the registry entry the app already has, so an existing
 * install keeps its path and only the files are refreshed. Idempotent.
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const SRC = path.join(__dirname, "plugin");
const PLUGIN_ID = "cn.star.turnloom-bridge";

function resolvePluginsRoot() {
  const candidates = [];
  for (const name of ["PI-Desktop", "pi-desktop"]) {
    try {
      const loc = path.join(process.env.APPDATA || "", name, "storage-location.json");
      const data = JSON.parse(fs.readFileSync(loc, "utf8"))?.roots?.data;
      if (data) candidates.push(path.join(String(data), "plugins"));
    } catch {
      /* no storage-location for this name */
    }
  }
  candidates.push(path.join(os.homedir(), ".pi-desktop", "plugins"));
  return candidates.find((p) => p && fs.existsSync(path.join(p, "registry.json"))) || candidates[0];
}

const PLUGINS = resolvePluginsRoot();
const REG = path.join(PLUGINS, "registry.json");

const raw = fs.existsSync(REG) ? JSON.parse(fs.readFileSync(REG, "utf8")) : [];
const wrapped = !Array.isArray(raw) && raw && Array.isArray(raw.plugins);
const reg = Array.isArray(raw) ? raw : wrapped ? raw.plugins : null;
if (!reg) throw new Error("registry.json is neither an array nor { plugins: [] }: " + REG);

const previous = reg.find((r) => r && r.id === PLUGIN_ID);
const DEST = previous && previous.path ? String(previous.path) : path.join(PLUGINS, "installed", PLUGIN_ID);

// 1. Mirror every plugin file (flat layout).
fs.mkdirSync(DEST, { recursive: true });
const copied = [];
for (const name of fs.readdirSync(SRC)) {
  const src = path.join(SRC, name);
  if (!fs.statSync(src).isFile()) continue;
  fs.copyFileSync(src, path.join(DEST, name));
  copied.push(name);
}

// 2. Build the entry from the source manifest (authoritative) and upsert it.
const manifest = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
const now = new Date().toISOString();
const entry = {
  id: manifest.id,
  name: manifest.name,
  version: manifest.version,
  enabled: true,
  scope: { mode: "global", projects: [] },
  source: "dev",
  bundled: false,
  status: "ready",
  permissions: manifest.permissions,
  path: DEST,
  capabilities: manifest.contributes && manifest.contributes.services ? ["services"] : [],
  description: manifest.description,
  installedAt: (previous && previous.installedAt) || now,
  updatedAt: now,
  autoUpdate: false,
};

const idx = reg.findIndex((r) => r && r.id === PLUGIN_ID);
if (idx === -1) reg.push(entry);
else reg[idx] = Object.assign({}, reg[idx], entry);

fs.writeFileSync(REG, JSON.stringify(wrapped ? Object.assign({}, raw, { plugins: reg }) : reg, null, 2), "utf8");

console.log("plugins root : " + PLUGINS);
console.log("registry     : " + REG);
console.log("installed    : " + PLUGIN_ID + " -> " + DEST);
console.log("files        : " + copied.join(", "));
console.log("entries      : " + reg.length);
