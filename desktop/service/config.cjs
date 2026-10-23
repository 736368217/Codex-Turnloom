"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const APP_DIR = path.resolve(__dirname, "..", "..");
const LOCAL_APP_DATA = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
const CONFIG_DIR = path.join(LOCAL_APP_DATA, "CodexPocket");
const DEFAULT_LOG_DIR = path.join(CONFIG_DIR, "logs");
const DEFAULT_CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

const DEFAULT_CONSOLE = {
  autoStart: true,
  startMinimized: true,
  closeBehavior: "tray",
  theme: "system",
  logLevel: "info",
  logRetentionDays: 7
};

function configPath() {
  return process.env.TURNLOOM_CONFIG_PATH
    ? path.resolve(process.env.TURNLOOM_CONFIG_PATH)
    : DEFAULT_CONFIG_PATH;
}

function logDirFor(config) {
  return config && config.logDir ? config.logDir : DEFAULT_LOG_DIR;
}

function generateAccessCode() {
  const bytes = require("node:crypto").randomBytes(4);
  const value = bytes.readUInt32LE(0);
  return String(100000 + (value % 900000));
}

function findNodePath() {
  const explicit = String(process.env.TURNLOOM_NODE_PATH || "").trim();
  if (explicit && fs.existsSync(explicit)) return explicit;
  try {
    const out = execFileSync("where.exe", ["node.exe"], { encoding: "utf8", windowsHide: true });
    const first = out.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (first && fs.existsSync(first)) return first;
  } catch {
    // fall through
  }
  if (/node(\.exe)?$/i.test(path.basename(process.execPath))) return process.execPath;
  return "node.exe";
}

function detectCodexHomes() {
  const candidates = [];
  const add = (value, source) => {
    if (!value) return;
    const resolved = path.resolve(String(value));
    if (candidates.some((item) => item.path.toLowerCase() === resolved.toLowerCase())) return;
    candidates.push({ path: resolved, source });
  };
  add(process.env.CODEX_HOME, "环境变量 CODEX_HOME");
  add(path.join(os.homedir(), ".codex"), "用户目录");
  for (const drive of ["C", "D", "E", "F"]) {
    add(path.join(`${drive}:\\`, "codex", ".codex"), `${drive}: 盘`);
  }
  const found = [];
  const seenReal = new Set();
  for (const item of candidates) {
    const db = path.join(item.path, "state_5.sqlite");
    if (!fs.existsSync(db)) continue;
    let realPath = item.path;
    try { realPath = fs.realpathSync.native(item.path); } catch {}
    const key = process.platform === "win32" ? realPath.toLowerCase() : realPath;
    if (seenReal.has(key)) continue;
    seenReal.add(key);
    let modified = 0;
    try { modified = fs.statSync(db).mtimeMs; } catch {}
    found.push({ ...item, path: item.path, realPath, modified, stateDb: db });
  }
  return found.sort((a, b) => b.modified - a.modified);
}

function defaultConfig(overrides = {}) {
  const home = detectCodexHomes()[0]?.path || path.join(os.homedir(), ".codex");
  const base = {
    schemaVersion: 1,
    machineName: os.hostname(),
    repoRoot: APP_DIR,
    nodePath: findNodePath(),
    codexHome: home,
    host: "0.0.0.0",
    port: 8787,
    accessCode: generateAccessCode(),
    readonly: false,
    publicUrl: "",
    logDir: DEFAULT_LOG_DIR,
    tunnel: {
      enabled: false,
      host: "",
      user: "codextunnel",
      remotePort: 0,
      keyPath: path.join(os.homedir(), ".ssh", "codex_pocket_ed25519"),
      knownHostsPath: path.join(os.homedir(), ".ssh", "known_hosts")
    },
    console: { ...DEFAULT_CONSOLE }
  };
  return mergeConfig(base, overrides);
}

function mergeConfig(base, patch) {
  const result = { ...base, ...(patch || {}) };
  result.tunnel = { ...(base.tunnel || {}), ...((patch && patch.tunnel) || {}) };
  result.console = { ...DEFAULT_CONSOLE, ...(base.console || {}), ...((patch && patch.console) || {}) };
  return result;
}

function normalizeConfig(raw) {
  const base = defaultConfig();
  const merged = mergeConfig(base, raw || {});
  merged.schemaVersion = Number(merged.schemaVersion) || 1;
  merged.port = Number(merged.port) || 8787;
  merged.tunnel.remotePort = Number(merged.tunnel.remotePort) || 0;
  merged.publicUrl = String(merged.publicUrl || "").replace(/\/+$/, "");
  merged.host = String(merged.host || "0.0.0.0");
  merged.machineName = String(merged.machineName || os.hostname());
  merged.logDir = merged.logDir || DEFAULT_LOG_DIR;
  return merged;
}

function loadConfig() {
  const file = configPath();
  if (!fs.existsSync(file)) {
    return { exists: false, path: file, config: null };
  }
  try {
    const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    const raw = JSON.parse(text);
    return { exists: true, path: file, config: normalizeConfig(raw) };
  } catch (error) {
    return { exists: true, path: file, config: null, error: `配置文件读取失败：${error.message}` };
  }
}

function saveConfig(config) {
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const normalized = normalizeConfig(config);
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "") : "";
  if (existing) {
    try { fs.writeFileSync(`${file}.bak`, existing, "utf8"); } catch {}
  }
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2), "utf8");
  fs.renameSync(tmp, file);
  return normalized;
}

function validateConfig(config) {
  const errors = [];
  if (!config) return [{ field: "config", message: "配置文件不存在或无法解析。" }];
  if (!Number.isInteger(Number(config.port)) || Number(config.port) < 1 || Number(config.port) > 65535) {
    errors.push({ field: "port", message: "端口需在 1–65535 之间。" });
  }
  if (!String(config.accessCode || "").trim()) {
    errors.push({ field: "accessCode", message: "访问码不能为空。" });
  }
  if (!config.codexHome || !fs.existsSync(config.codexHome)) {
    errors.push({ field: "codexHome", message: "Codex 数据目录不存在。" });
  } else if (!fs.existsSync(path.join(config.codexHome, "state_5.sqlite"))) {
    errors.push({ field: "codexHome", message: "该目录下没有 state_5.sqlite，请选择正确的 Codex 数据目录。" });
  }
  if (!config.repoRoot || !fs.existsSync(path.join(config.repoRoot, "server.js"))) {
    errors.push({ field: "repoRoot", message: "找不到 server.js，请检查安装目录。" });
  }
  if (!config.nodePath || !fs.existsSync(config.nodePath)) {
    errors.push({ field: "nodePath", message: "找不到 node.exe，请安装 Node.js 或指定路径。" });
  }
  if (config.tunnel && config.tunnel.enabled) {
    if (!config.tunnel.host) errors.push({ field: "tunnel.host", message: "启用隧道时必须填写服务器地址。" });
    if (!config.tunnel.user) errors.push({ field: "tunnel.user", message: "启用隧道时必须填写 SSH 用户名。" });
    if (!Number.isInteger(Number(config.tunnel.remotePort)) || Number(config.tunnel.remotePort) < 1) {
      errors.push({ field: "tunnel.remotePort", message: "启用隧道时必须填写有效的远端端口。" });
    }
    if (!config.tunnel.keyPath || !fs.existsSync(config.tunnel.keyPath)) {
      errors.push({ field: "tunnel.keyPath", message: "SSH 密钥文件不存在。" });
    }
    if (!config.tunnel.knownHostsPath || !fs.existsSync(config.tunnel.knownHostsPath)) {
      errors.push({ field: "tunnel.knownHostsPath", message: "known_hosts 文件不存在。" });
    }
  }
  return errors;
}

function publicConfig(config) {
  if (!config) return null;
  return {
    exists: true,
    machineName: config.machineName,
    repoRoot: config.repoRoot,
    nodePath: config.nodePath,
    codexHome: config.codexHome,
    host: config.host,
    port: config.port,
    readonly: Boolean(config.readonly),
    publicUrl: config.publicUrl,
    logDir: config.logDir,
    tunnel: {
      enabled: Boolean(config.tunnel?.enabled),
      host: config.tunnel?.host || "",
      user: config.tunnel?.user || "",
      remotePort: Number(config.tunnel?.remotePort) || 0,
      keyPath: config.tunnel?.keyPath || "",
      knownHostsPath: config.tunnel?.knownHostsPath || ""
    },
    console: { ...DEFAULT_CONSOLE, ...(config.console || {}) },
    hasAccessCode: Boolean(config.accessCode),
    accessCodeMasked: maskAccessCode(config.accessCode)
  };
}

function lanAddress() {
  const interfaces = os.networkInterfaces();
  const candidates = [];
  for (const [name, list] of Object.entries(interfaces)) {
    for (const info of list || []) {
      if (info.family !== "IPv4" || info.internal) continue;
      candidates.push({ address: info.address, name });
    }
  }
  const score = (ip) => {
    if (ip.startsWith("192.168.")) return 0;
    if (ip.startsWith("10.")) return 1;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return 2;
    if (ip.startsWith("169.254.")) return 9;
    return 5;
  };
  candidates.sort((a, b) => score(a.address) - score(b.address));
  return candidates[0]?.address || "127.0.0.1";
}

function urlsFor(config) {
  const host = lanAddress();
  const port = Number(config?.port) || 8787;
  const lan = `http://${host}:${port}`;
  const publicUrl = String(config?.publicUrl || "").replace(/\/+$/, "");
  return { lan, publicUrl, browser: publicUrl || lan, preview: lan };
}

function pairingPayload(config) {
  const urls = urlsFor(config);
  const url = urls.publicUrl || urls.lan;
  const target = new URL("codexpocket://add");
  target.searchParams.set("name", config.machineName || os.hostname());
  target.searchParams.set("url", url);
  target.searchParams.set("token", config.accessCode || "");
  return target.toString();
}

function maskAccessCode(code) {
  const value = String(code || "");
  if (!value) return "";
  return "•".repeat(Math.max(6, Math.min(10, value.length)));
}

module.exports = {
  APP_DIR,
  CONFIG_DIR,
  DEFAULT_LOG_DIR,
  DEFAULT_CONSOLE,
  configPath,
  logDirFor,
  generateAccessCode,
  findNodePath,
  detectCodexHomes,
  defaultConfig,
  mergeConfig,
  normalizeConfig,
  loadConfig,
  saveConfig,
  validateConfig,
  publicConfig,
  lanAddress,
  urlsFor,
  pairingPayload,
  maskAccessCode
};
