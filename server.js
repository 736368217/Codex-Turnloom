#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { createReadStream, existsSync, promises as fs, realpathSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import qrcode from "qrcode-terminal";

const modulePath = fileURLToPath(import.meta.url);
const __dirname = path.dirname(modulePath);

function sameFilePath(left, right) {
  if (!left || !right) return false;
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  if (resolvedLeft === resolvedRight) return true;
  try {
    return path.resolve(realpathSync(resolvedLeft)) === path.resolve(realpathSync(resolvedRight));
  } catch {
    return false;
  }
}

const IS_MAIN = sameFilePath(process.argv[1], modulePath);

function parseCliArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [flag, inlineValue] = arg.split("=", 2);
    const nextValue = () => inlineValue ?? argv[++index];
    if (flag === "--write") {
      console.error("Ignoring deprecated --write; write mode is enabled by default. Use --readonly to disable writes.");
      continue;
    }
    if (flag === "--dev-any-code") {
      console.error("Unsupported option: --dev-any-code. This internal test flag is not valid for Codex LAN Companion.");
      options.help = true;
      options.invalid = true;
      continue;
    }
    if (flag === "--help" || flag === "-h") options.help = true;
    else if (flag === "--host") options.host = nextValue();
    else if (flag === "--port") options.port = nextValue();
    else if (flag === "--token") options.token = nextValue();
    else if (flag === "--password") options.password = nextValue();
    else if (flag === "--codex-home") options.codexHome = nextValue();
    else if (flag === "--ipc-socket") options.ipcSocket = nextValue();
    else if (flag === "--readonly") options.readonly = true;
    else if (flag === "--no-auth") options.noAuth = true;
    else if (arg) {
      console.error(`Unknown option: ${arg}`);
      options.help = true;
      options.invalid = true;
    }
  }
  return options;
}

function printHelp() {
  console.log(`Codex LAN Companion

Usage:
  codex-lan-companion [options]

Options:
  --host <host>          Bind host. Default: 0.0.0.0
  --port <port>          Bind port. Default: 8787
  --password <password>  Friendly access code. Default: generated 6-digit code per launch
  --token <token>        Alias for --password
  --readonly             Disable sending messages to Codex Desktop
  --no-auth              Disable access-code guard
  --codex-home <path>    Codex data directory. Default: ~/.codex
  --ipc-socket <path>    Codex Desktop IPC socket override
  -h, --help             Show this help

Examples:
  codex-lan-companion
  codex-lan-companion --readonly
  codex-lan-companion --port 8790 --password home-only
`);
}

const cli = IS_MAIN ? parseCliArgs(process.argv.slice(2)) : {};
if (IS_MAIN && cli.help) {
  printHelp();
  process.exit(cli.invalid ? 1 : 0);
}

function timestamp() {
  return new Date().toISOString();
}

function logInfo(message = "") {
  if (!message) console.log("");
  else console.log(`[${timestamp()}] ${message}`);
}

function logError(message = "") {
  if (!message) console.error("");
  else console.error(`[${timestamp()}] ${message}`);
}

function logFatalError(label, error) {
  const message = error?.stack || error?.message || String(error);
  logError(`[fatal] ${label}`);
  console.error(message);
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours || parts.length) parts.push(`${hours}h`);
  if (minutes || parts.length) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

const PROCESS_STARTED_AT_MS = Date.now();
const PROCESS_STARTED_AT_ISO = new Date(PROCESS_STARTED_AT_MS).toISOString();
const SYSTEM_BOOT_AT_MS = PROCESS_STARTED_AT_MS - Math.round(os.uptime() * 1000);
const SYSTEM_BOOT_AT_ISO = new Date(SYSTEM_BOOT_AT_MS).toISOString();
const START_SOURCE = process.env.XPC_SERVICE_NAME ? `launchd:${process.env.XPC_SERVICE_NAME}` : "terminal";
const IS_INTERACTIVE_TTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);
const SLOW_REQUEST_MS = 1000;
const SLOW_POLL_REQUEST_MS = 5000;
const SLOW_SQL_MS = 750;
const ACCOUNT_CACHE_MS = 60 * 1000;
const ACCOUNT_STALE_CACHE_MS = 5 * 60 * 1000;
const THREADS_CACHE_MS = 8000;
const THREADS_STALE_CACHE_MS = 60 * 1000;
const THREAD_ACCOUNT_CACHE_MS = 5 * 60 * 1000;
const SESSION_ROLLOUT_PATH_CACHE_MS = 5000;
const AUTH_WARN_LOG_INTERVAL_MS = 5 * 60 * 1000;
const CODEX_MODELS = [
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", efforts: ["low", "medium", "high", "xhigh", "max", "ultra"] },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", efforts: ["low", "medium", "high", "xhigh", "max", "ultra"] },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", efforts: ["low", "medium", "high", "xhigh", "max"] },
  { id: "gpt-5.5", label: "GPT-5.5", efforts: ["low", "medium", "high", "xhigh"] }
];
const DEFAULT_CODEX_MODEL = "gpt-5.6-sol";
const DEFAULT_CODEX_EFFORT = "medium";
const authWarnLogState = new Map();
let threadsCache = null;
let sessionRolloutPathCache = null;
let accountInfoInFlight = null;
let threadsInFlight = null;

function normalizeLogPath(pathname) {
  return String(pathname || "/").replace(/\/api\/threads\/[0-9a-fA-F-]{20,}\/messages$/, "/api/threads/:id/messages");
}

function shouldLogHttpEvent({ method, pathname, statusCode, level }) {
  if (level !== "warn" || statusCode !== 401) return true;
  const key = `${method} ${normalizeLogPath(pathname)} ${statusCode}`;
  const now = Date.now();
  const state = authWarnLogState.get(key);
  if (!state || now - state.lastLoggedAt >= AUTH_WARN_LOG_INTERVAL_MS) {
    const suppressed = state?.suppressed || 0;
    authWarnLogState.set(key, { lastLoggedAt: now, suppressed: 0 });
    return { suppressed };
  }
  state.suppressed += 1;
  return false;
}

function slowRequestThresholdMs(method, pathname) {
  const normalized = normalizeLogPath(pathname);
  if (method === "GET" && (normalized === "/api/threads" || normalized === "/api/threads/:id/messages" || normalized === "/api/account")) {
    return SLOW_POLL_REQUEST_MS;
  }
  return SLOW_REQUEST_MS;
}

function summarizeSql(sql) {
  return String(sql || "").replace(/\s+/g, " ").trim().slice(0, 180);
}

function clearThreadsCache() {
  threadsCache = null;
  threadsInFlight = null;
  accountInfoInFlight = null;
}

function invalidateThreadCaches() {
  threadsCache = null;
  threadsInFlight = null;
  messageCache.clear();
}

if (IS_MAIN) {
  process.on("uncaughtException", (error) => {
    logFatalError("Uncaught exception", error);
    process.exit(1);
  });

  process.on("unhandledRejection", (error) => {
    logFatalError("Unhandled promise rejection", error);
    process.exit(1);
  });
}

const INITIAL_CODEX_HOME = cli.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const CODEX_HOME_FIXED = Boolean(cli.codexHome || process.env.CODEX_LAN_FIXED_CODEX_HOME === "1");
const HOST = cli.host || process.env.HOST || "0.0.0.0";
const PORT = Number(cli.port || process.env.PORT || 8787);
let AUTH_REQUIRED = !cli.noAuth && process.env.CODEX_LAN_NO_AUTH !== "1";
const ACCESS_TOKEN = cli.password || cli.token || process.env.CODEX_LAN_PASSWORD || process.env.CODEX_LAN_TOKEN || String(randomInt(100000, 1000000));
const ALLOW_WRITE = !cli.readonly && process.env.CODEX_LAN_READONLY !== "1";
const CODEX_IPC_SOCKET =
  cli.ipcSocket ||
  process.env.CODEX_IPC_SOCKET ||
  (process.platform === "win32"
    ? String.raw`\\.\pipe\codex-ipc`
    : path.join(os.tmpdir(), "codex-ipc", typeof process.getuid === "function" ? `ipc-${process.getuid()}.sock` : "ipc.sock"));
function defaultCodexCli() {
  const macAppCli = "/Applications/Codex.app/Contents/Resources/codex";
  if (existsSync(macAppCli)) return macAppCli;
  if (process.platform === "win32") {
    const platformPackage = process.arch === "arm64" ? "codex-win32-arm64" : "codex-win32-x64";
    const rustTarget = process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
    const npmCli = path.join(
      os.homedir(),
      "AppData",
      "Roaming",
      "npm",
      "node_modules",
      "@openai",
      "codex",
      "node_modules",
      "@openai",
      platformPackage,
      "vendor",
      rustTarget,
      "bin",
      "codex.exe"
    );
    if (existsSync(npmCli)) return npmCli;
  }
  return "codex";
}

const CODEX_CLI = process.env.CODEX_CLI || defaultCodexCli();
const PUBLIC_DIR = path.join(__dirname, "public");
const GENERATED_IMAGES_DIR = path.join(os.homedir(), ".codex", "generated_images");
const MAX_SEND_IMAGES = 4;
const MAX_SEND_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_SEND_BODY_BYTES = 32 * 1024 * 1024;
const MAX_LOCAL_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_LOCAL_FILE_BYTES = 50 * 1024 * 1024;
const DEFAULT_MESSAGE_LIMIT = 80;
const MAX_MESSAGE_LIMIT = 1000;
const TAIL_ROLLOUT_MIN_BYTES = 512 * 1024;
const TAIL_ROLLOUT_MAX_BYTES = 4 * 1024 * 1024;
const MIN_SEND_IMAGE_BYTES = 512;
const MIN_SEND_IMAGE_EDGE = 16;
const MAX_SEND_IMAGE_EDGE = 4096;
const MAX_SEND_IMAGE_PIXELS = 12_000_000;
const SUPPORTED_SEND_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ACTIVE_TURN_STALE_MS = 10 * 60 * 1000;
const ACTIVE_STATUS_CACHE_MS = 5000;
const QUEUE_IDLE_SETTLE_MS = 3500;
const THREAD_OWNER_OPEN_TIMEOUT_MS = 20_000;
const SESSION_REPAIR_DIR_NAME = "session-repairs";
const IPC_VERSION_BY_METHOD = {
  "thread-owner-discovery": 1,
  "thread-follower-start-turn": 2,
  "thread-follower-steer-turn": 1,
  "thread-follower-compact-thread": 1,
  "thread-follower-interrupt-turn": 3,
  "thread-follower-command-approval-decision": 1,
  "thread-follower-file-approval-decision": 1,
  "thread-follower-permissions-request-approval-response": 1
};

const CORE_SKILL_ORDER = [
  "implement",
  "to-spec",
  "code-review",
  "diagnosing-bugs",
  "research",
  "tdd",
  "triage",
  "wayfinder",
  "codebase-design",
  "domain-modeling"
];

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

const messageCache = new Map();
const referencedFilesByThread = new Map();
const recentNotices = [];
let codexIpcClient = null;
let accountCache = null;
let threadAccountCache = null;
let threadAccountRefreshInFlight = null;
const sqliteQueues = new Map();
const pendingSendQueues = new Map();
const drainingSendQueues = new Set();
const queuedSendDrainTimers = new Map();
const queueIdleObservations = new Map();
const recentSendRequests = new Map();
const threadStartOperations = new Map();
let codexHomeState = {
  home: path.resolve(INITIAL_CODEX_HOME),
  version: 1,
  source: "startup",
  fixed: CODEX_HOME_FIXED,
  signature: "",
  checkedAt: 0,
  candidateCheckedAt: 0,
  changedAt: new Date().toISOString()
};

function rawDebugEventsLimit(value = 80) {
  const limit = Number(value);
  if (!Number.isFinite(limit)) return 80;
  return Math.max(1, Math.min(300, Math.floor(limit)));
}

function sendJson(res, status, body) {
  res.writeHead(status, jsonHeaders);
  res.end(JSON.stringify(body));
}

function sendText(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

function requestToken(req, url) {
  const header = req.headers["x-access-token"] || req.headers.authorization;
  if (Array.isArray(header)) return header[0] || "";
  if (typeof header === "string" && header.toLowerCase().startsWith("bearer ")) return header.slice(7);
  if (typeof header === "string") return header;
  return url.searchParams.get("token") || "";
}

function isAuthorized(req, url) {
  if (!AUTH_REQUIRED) return true;
  const token = requestToken(req, url);
  return token === ACCESS_TOKEN;
}

function requireAuthorized(req, res, url) {
  if (isAuthorized(req, url)) return true;
  sendJson(res, 401, { error: "Unauthorized", authRequired: true });
  return false;
}

function loginUrlFor(baseUrl) {
  if (!AUTH_REQUIRED) return baseUrl;
  const url = new URL(baseUrl);
  url.searchParams.set("login", ACCESS_TOKEN);
  return url.toString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSqliteLocked(error) {
  return String(error?.message || error || "").toLowerCase().includes("database is locked");
}

function isSqliteResourceTransient(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return /\b(eagain|emfile|enfile)\b/.test(message);
}

function codexPaths(home = codexHomeState.home) {
  const root = path.resolve(home || INITIAL_CODEX_HOME);
  return {
    home: root,
    stateDb: path.join(root, "state_5.sqlite"),
    logsDb: path.join(root, "logs_2.sqlite"),
    goalsDb: path.join(root, "goals_1.sqlite"),
    sessionIndex: path.join(root, "session_index.jsonl"),
    sessionsDir: path.join(root, "sessions"),
    archivedSessionsDir: path.join(root, "archived_sessions"),
    authFile: path.join(root, "auth.json")
  };
}

async function findPluginManifests(dir, depth = 0) {
  if (depth > 6) return [];
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const manifests = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".codex-plugin") {
        const manifestPath = path.join(entryPath, "plugin.json");
        if (existsSync(manifestPath)) manifests.push(manifestPath);
      } else {
        manifests.push(...(await findPluginManifests(entryPath, depth + 1)));
      }
    }
  }
  return manifests;
}

async function findSkillFiles(dir, depth = 0) {
  if (depth > 8) return [];
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === "SKILL.md") {
      files.push(entryPath);
    } else if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") {
      files.push(...(await findSkillFiles(entryPath, depth + 1)));
    }
  }
  return files;
}

function pluginMarketplaceFromManifest(manifestPath, cacheRoot) {
  const relative = path.relative(cacheRoot, manifestPath);
  const [marketplace] = relative.split(path.sep);
  return marketplace && !marketplace.startsWith("..") ? marketplace : "";
}

function compactPluginDescription(value) {
  const firstLine = String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return "";
  return firstLine.length > 180 ? `${firstLine.slice(0, 177)}...` : firstLine;
}

function parseSkillMetadata(raw, fallbackName) {
  const text = String(raw || "");
  const frontmatter = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const meta = {};
  if (frontmatter) {
    for (const line of frontmatter[1].split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!match) continue;
      const value = match[2].trim().replace(/^["']|["']$/g, "");
      meta[match[1]] = value;
    }
  }
  const body = frontmatter ? text.slice(frontmatter[0].length) : text;
  const description =
    meta.description ||
    body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#")) ||
    "";
  return {
    name: String(meta.name || fallbackName || "").trim(),
    description: compactPluginDescription(description)
  };
}

function skillSourceInfo(skillPath, home) {
  const skillsRoot = path.join(home, "skills");
  const pluginCacheRoot = path.join(home, "plugins", "cache");
  const relativeLocal = path.relative(skillsRoot, skillPath);
  if (relativeLocal && !relativeLocal.startsWith("..") && !path.isAbsolute(relativeLocal)) {
    const [scope] = relativeLocal.split(path.sep);
    return {
      key: scope === ".system" ? "system" : "local",
      label: scope === ".system" ? "System" : "Local"
    };
  }
  const relativePlugin = path.relative(pluginCacheRoot, skillPath);
  if (relativePlugin && !relativePlugin.startsWith("..") && !path.isAbsolute(relativePlugin)) {
    const [marketplace, pluginName] = relativePlugin.split(path.sep);
    return {
      key: `plugin:${marketplace}:${pluginName}`,
      label: [marketplace, pluginName].filter(Boolean).join("/")
    };
  }
  return { key: "unknown", label: "Unknown" };
}

function mimeTypeForAsset(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".tif" || ext === ".tiff") return "image/tiff";
  return "";
}

async function readPluginIconDataUrl(manifest, manifestPath) {
  const pluginInterface = manifest.interface && typeof manifest.interface === "object" ? manifest.interface : {};
  const iconValue = String(
    manifest.composerIcon ||
      manifest.icon ||
      manifest.logo ||
      pluginInterface.composerIcon ||
      pluginInterface.icon ||
      pluginInterface.logo ||
      ""
  ).trim();
  if (!iconValue || /^https?:\/\//i.test(iconValue) || iconValue.startsWith("data:")) return "";
  const pluginRoot = path.dirname(path.dirname(manifestPath));
  const iconPath = path.resolve(pluginRoot, iconValue);
  if (!iconPath.startsWith(pluginRoot + path.sep)) return "";
  const mimeType = mimeTypeForAsset(iconPath);
  if (!mimeType) return "";
  try {
    const stat = await fs.stat(iconPath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > 200 * 1024) return "";
    const data = await fs.readFile(iconPath);
    return `data:${mimeType};base64,${data.toString("base64")}`;
  } catch {
    return "";
  }
}

async function getPlugins() {
  const homeState = await refreshCodexHomeContext({ source: "plugins" });
  const cacheRoot = path.join(homeState.home, "plugins", "cache");
  const manifests = await findPluginManifests(cacheRoot);
  const byUri = new Map();
  for (const manifestPath of manifests) {
    try {
      const raw = await fs.readFile(manifestPath, "utf8");
      const manifest = JSON.parse(raw);
      const name = String(manifest.name || "").trim();
      const marketplace = pluginMarketplaceFromManifest(manifestPath, cacheRoot);
      if (!name || !marketplace) continue;
      const pluginInterface = manifest.interface && typeof manifest.interface === "object" ? manifest.interface : {};
      const displayName = String(pluginInterface.displayName || manifest.displayName || manifest.display_name || manifest.title || name).trim();
      const description = compactPluginDescription(
        pluginInterface.shortDescription ||
          pluginInterface.short_description ||
          manifest.shortDescription ||
          manifest.short_description ||
          manifest.description ||
          pluginInterface.longDescription ||
          ""
      );
      const uri = `plugin://${name}@${marketplace}`;
      const iconDataUrl = await readPluginIconDataUrl(manifest, manifestPath);
      byUri.set(uri, {
        name,
        displayName,
        description,
        marketplace,
        uri,
        iconDataUrl
      });
    } catch {
      // Ignore stale or partially installed plugin cache entries.
    }
  }
  const plugins = [...byUri.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));
  return {
    plugins,
    codexHome: homeState.home,
    codexHomeVersion: homeState.version
  };
}

async function getSkills() {
  const homeState = await refreshCodexHomeContext({ source: "skills" });
  const roots = [path.join(homeState.home, "skills"), path.join(homeState.home, "plugins", "cache")];
  const files = [];
  for (const root of roots) files.push(...(await findSkillFiles(root)));
  const byUri = new Map();
  for (const skillPath of files) {
    try {
      const raw = await fs.readFile(skillPath, "utf8");
      const fallbackName = path.basename(path.dirname(skillPath));
      const metadata = parseSkillMetadata(raw, fallbackName);
      if (!metadata.name) continue;
      const source = skillSourceInfo(skillPath, homeState.home);
      const uri = `skill://${encodeURIComponent(metadata.name)}@${encodeURIComponent(source.key)}`;
      byUri.set(uri, {
        name: metadata.name,
        displayName: metadata.name,
        description: metadata.description,
        source: source.label,
        priority: source.key === "system" ? 0 : source.key === "local" ? 100 : 200,
        uri
      });
    } catch {
      // Ignore stale or partially installed skill entries.
    }
  }
  const skills = [
    {
      name: "compact-context",
      displayName: "压缩上下文",
      description: "调用 Codex Desktop 的上下文压缩操作",
      source: "内置操作",
      priority: -10,
      kind: "builtin",
      action: "compact",
      uri: "builtin://compact-context"
    },
    {
      name: "plan",
      displayName: "计划",
      description: "让 Codex 先整理执行计划",
      source: "内置操作",
      priority: -9,
      kind: "builtin",
      action: "plan",
      uri: "builtin://plan"
    },
    {
      name: "goal",
      displayName: "目标",
      description: "查看或编辑当前 Codex 目标",
      source: "内置操作",
      priority: -8,
      kind: "builtin",
      action: "goal",
      uri: "builtin://goal"
    },
    ...[...byUri.values()].sort((a, b) => {
      const aName = String(a.name || "").toLowerCase();
      const bName = String(b.name || "").toLowerCase();
      const aCore = CORE_SKILL_ORDER.indexOf(aName);
      const bCore = CORE_SKILL_ORDER.indexOf(bName);
      const aRank = aCore >= 0 ? aCore + 1 : a.priority === 0 ? 50 : a.priority ?? 200;
      const bRank = bCore >= 0 ? bCore + 1 : b.priority === 0 ? 50 : b.priority ?? 200;
      return aRank - bRank || a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
    })
  ];
  return {
    skills,
    codexHome: homeState.home,
    codexHomeVersion: homeState.version
  };
}

function clearHomeScopedCaches() {
  accountCache = null;
  accountInfoInFlight = null;
  threadAccountCache = null;
  threadAccountRefreshInFlight = null;
  threadsCache = null;
  threadsInFlight = null;
  messageCache.clear();
  referencedFilesByThread.clear();
  recentNotices.splice(0, recentNotices.length);
  codexIpcClient?.clearHomeScopedState?.();
}

function normalizeCandidateHome(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const expanded = text.startsWith("~/") ? path.join(os.homedir(), text.slice(2)) : text;
  const normalized = path.resolve(expanded);
  const parts = normalized.split(path.sep);
  const codexIndex = parts.lastIndexOf(".codex");
  if (codexIndex >= 0) return parts.slice(0, codexIndex + 1).join(path.sep) || path.sep;
  if (["state_5.sqlite", "session_index.jsonl", "auth.json"].includes(path.basename(normalized))) return path.dirname(normalized);
  return normalized;
}

function isLikelyCodexHome(home) {
  if (!home || !existsSync(home)) return false;
  const paths = codexPaths(home);
  return existsSync(paths.stateDb) || existsSync(paths.sessionIndex) || existsSync(paths.authFile) || existsSync(path.join(paths.home, "sessions"));
}

function applyCodexHomeCandidate(candidate, source = "unknown") {
  if (codexHomeState.fixed) return false;
  const home = normalizeCandidateHome(candidate);
  if (!isLikelyCodexHome(home)) return false;
  if (home === codexHomeState.home) return false;
  codexHomeState = {
    ...codexHomeState,
    home,
    version: codexHomeState.version + 1,
    source,
    signature: "",
    checkedAt: 0,
    changedAt: new Date().toISOString()
  };
  clearHomeScopedCaches();
  logInfo(`Codex home changed: ${home} (${source})`);
  return true;
}

function extractCodexHomeCandidates(value, depth = 0, seen = new Set(), keyHint = "") {
  if (value == null || depth > 8) return [];
  if (typeof value === "string") {
    const hint = String(keyHint || "").toLowerCase();
    const looksLikeHomeKey = /codex[_-]?home|codexhome|data[_-]?dir|data[_-]?directory/.test(hint);
    const looksLikeCodexPath = value.includes(`${path.sep}.codex`) || value.includes("/.codex") || value.includes("\\.codex");
    if (looksLikeHomeKey || looksLikeCodexPath || ["state_5.sqlite", "session_index.jsonl", "auth.json"].some((name) => value.includes(name))) {
      return [normalizeCandidateHome(value)];
    }
    return [];
  }
  if (typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  const candidates = [];
  if (Array.isArray(value)) {
    for (const item of value) candidates.push(...extractCodexHomeCandidates(item, depth + 1, seen, keyHint));
    return candidates;
  }
  for (const [key, child] of Object.entries(value)) {
    candidates.push(...extractCodexHomeCandidates(child, depth + 1, seen, key));
  }
  return candidates;
}

function maybeUpdateCodexHomeFromMessage(message) {
  for (const candidate of extractCodexHomeCandidates(message)) {
    if (applyCodexHomeCandidate(candidate, "desktop-ipc")) return true;
  }
  return false;
}

async function fileSignature(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return `${filePath}:${stat.size}:${Math.round(stat.mtimeMs)}`;
  } catch {
    return `${filePath}:missing`;
  }
}

async function fileMtimeMs(filePath) {
  try {
    return (await fs.stat(filePath)).mtimeMs;
  } catch {
    return 0;
  }
}

async function discoverCodexHomeCandidates() {
  const candidates = new Set([
    INITIAL_CODEX_HOME,
    process.env.CODEX_HOME,
    path.join(os.homedir(), ".codex"),
    ...(process.env.CODEX_LAN_CODEX_HOME_CANDIDATES || "").split(path.delimiter)
  ]);
  try {
    for (const entry of await fs.readdir(os.homedir(), { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith(".codex")) {
        candidates.add(path.join(os.homedir(), entry.name));
      }
    }
  } catch {
    // Candidate discovery is best-effort; IPC is the preferred signal.
  }
  const appSupport = path.join(os.homedir(), "Library", "Application Support");
  try {
    for (const entry of await fs.readdir(appSupport, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.toLowerCase().includes("codex")) {
        candidates.add(path.join(appSupport, entry.name));
      }
    }
  } catch {
    // Ignore unavailable platform-specific directories.
  }
  return [...candidates].map(normalizeCandidateHome).filter((candidate) => candidate && isLikelyCodexHome(candidate));
}

async function maybeDiscoverNewCodexHome(now) {
  if (codexHomeState.fixed || now - codexHomeState.candidateCheckedAt < 10000) return false;
  codexHomeState = { ...codexHomeState, candidateCheckedAt: now };
  const currentAuthMtime = await fileMtimeMs(codexPaths().authFile);
  let best = null;
  for (const candidate of await discoverCodexHomeCandidates()) {
    if (candidate === codexHomeState.home) continue;
    const authMtime = await fileMtimeMs(codexPaths(candidate).authFile);
    if (authMtime > currentAuthMtime && (!best || authMtime > best.authMtime)) {
      best = { home: candidate, authMtime };
    }
  }
  return best ? applyCodexHomeCandidate(best.home, "poll-discovery") : false;
}

async function codexHomeSignature(home = codexHomeState.home) {
  const paths = codexPaths(home);
  return fileSignature(paths.authFile);
}

async function refreshCodexHomeContext({ force = false, source = "poll" } = {}) {
  maybeUpdateCodexHomeFromMessage(codexIpcClient?.events?.at(-1)?.message);
  const now = Date.now();
  await maybeDiscoverNewCodexHome(now);
  if (!force && now - codexHomeState.checkedAt < 2000) return codexHomeState;
  const signature = await codexHomeSignature();
  if (codexHomeState.signature && signature !== codexHomeState.signature) {
    codexHomeState = {
      ...codexHomeState,
      version: codexHomeState.version + 1,
      source,
      signature,
      checkedAt: now,
      changedAt: new Date().toISOString()
    };
    clearHomeScopedCaches();
  } else {
    codexHomeState = {
      ...codexHomeState,
      signature,
      checkedAt: now
    };
  }
  return codexHomeState;
}

function runSqlJsonAttempt(sql, dbPath = codexPaths().stateDb) {
  return new Promise((resolve, reject) => {
    execFile("sqlite3", ["-json", "-cmd", ".timeout 5000", dbPath, sql], { maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      try {
        resolve(stdout.trim() ? JSON.parse(stdout) : []);
      } catch (parseError) {
        reject(parseError);
      }
    });
  });
}

async function runSqlJsonFromDb(dbPath, sql) {
  const work = async () => {
    let lastError;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await runSqlJsonAttempt(sql, dbPath);
      } catch (error) {
        lastError = error;
        if (!isSqliteLocked(error) && !isSqliteResourceTransient(error)) throw error;
        await sleep(150 * (attempt + 1) + (isSqliteResourceTransient(error) ? 100 : 0));
      }
    }
    throw lastError;
  };
  const queueKey = path.resolve(dbPath);
  const queue = sqliteQueues.get(queueKey) || Promise.resolve();
  const next = queue.then(work, work);
  sqliteQueues.set(queueKey, next.catch(() => {}));
  return next;
}

async function runSqlJson(sql) {
  const { stateDb } = codexPaths((await refreshCodexHomeContext()).home);
  return runSqlJsonFromDb(stateDb, sql);
}

async function readJsonBody(req, limit = 128 * 1024) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > limit) {
      const err = new Error("Request body too large");
      err.status = 413;
      throw err;
    }
  }
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    const err = new Error("Invalid JSON body");
    err.status = 400;
    throw err;
  }
}

class DesktopCodexIpcClient {
  constructor() {
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.ready = null;
    this.clientId = null;
    this.events = [];
    this.desktopConversationRows = new Map();
    this.followingByConversation = new Map();
  }

  async ensureReady() {
    if (this.socket?.writable && this.ready) {
      return this.ready;
    }
    this.ready = this.connect();
    return this.ready;
  }

  async connect() {
    if (process.platform !== "win32" && !existsSync(CODEX_IPC_SOCKET)) {
      throw new Error(`Codex desktop IPC socket not found: ${CODEX_IPC_SOCKET}`);
    }
    this.buffer = Buffer.alloc(0);
    this.pending.clear();
    this.clientId = null;

    await new Promise((resolve, reject) => {
      const socket = net.createConnection(CODEX_IPC_SOCKET);
      const fail = (error) => {
        socket.destroy();
        reject(error);
      };
      socket.once("connect", () => {
        socket.off("error", fail);
        resolve();
      });
      socket.once("error", fail);
      this.socket = socket;
    });

    this.socket.on("data", (chunk) => this.handleData(chunk));
    this.socket.on("error", (error) => this.reset(error));
    this.socket.on("close", () => this.reset(new Error("Codex desktop IPC connection closed")));

    const response = await this.request("initialize", { clientType: "webcontrolui" }, { includeVersion: false });
    if (response.resultType !== "success") {
      throw new Error(response.error || "Codex desktop IPC initialize failed");
    }
    this.clientId = response.result?.clientId || null;
    return response;
  }

  reset(error) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      if (error) reject(error);
    }
    this.pending.clear();
    this.ready = null;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.clientId = null;
  }

  close() {
    const socket = this.socket;
    if (socket) {
      socket.removeAllListeners();
      try {
        socket.end();
      } catch {
        // Ignore shutdown errors.
      }
      try {
        socket.destroy();
      } catch {
        // Ignore shutdown errors.
      }
    }
    this.reset();
  }

  encode(message) {
    const payload = Buffer.from(JSON.stringify(message), "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(payload.length, 0);
    return Buffer.concat([header, payload]);
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (this.buffer.length < 4 + length) return;
      const payload = this.buffer.subarray(4, 4 + length).toString("utf8");
      this.buffer = this.buffer.subarray(4 + length);
      try {
        this.handleMessage(JSON.parse(payload));
      } catch {
        // Ignore malformed frames from experimental desktop IPC.
      }
    }
  }

  handleMessage(message) {
    if (message.type !== "response" || !message.requestId) {
      this.captureEvent(message);
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (!pending) {
      this.captureEvent(message);
      return;
    }
    this.pending.delete(message.requestId);
    clearTimeout(pending.timer);
    this.captureEvent({
      ...message,
      direction: "incoming-response",
      method: message.method || pending.method,
      params: pending.params
    });
    if (message.resultType === "error") {
      const error = new Error(message.error || `${message.method || pending.method || "IPC request"} failed`);
      error.ipcMessage = message;
      error.ipcMethod = pending.method;
      error.ipcParams = pending.params;
      pending.reject(error);
      return;
    }
    pending.resolve(message);
  }

  captureEvent(message) {
    if (!message || typeof message !== "object") return;
    maybeUpdateCodexHomeFromMessage(message);
    this.rememberDesktopConversation(message);
    this.rememberConversationFollowing(message);
    this.events.push({
      timestamp: new Date().toISOString(),
      message
    });
    if (this.events.length > 120) this.events.splice(0, this.events.length - 120);
  }

  clearHomeScopedState() {
    this.events = [];
    this.desktopConversationRows.clear();
    this.followingByConversation.clear();
  }

  rememberConversationFollowing(message) {
    const type = String(message?.type || message?.method || "").toLowerCase();
    if (!type.includes("following")) return;
    const id = this.conversationIdFromMessage(message);
    if (!id) return;
    const payload = message?.payload || message?.params || message;
    const following = payload?.following ?? payload?.isFollowing ?? payload?.value;
    if (typeof following === "boolean") this.followingByConversation.set(String(id), following);
  }

  isFollowingConversation(threadId) {
    return this.followingByConversation.get(String(threadId || "")) === true;
  }

  followingConversationState(threadId) {
    return this.followingByConversation.get(String(threadId || ""));
  }

  conversationIdFromMessage(message) {
    return (
      message?.conversationId ||
      message?.conversation_id ||
      message?.threadId ||
      message?.thread_id ||
      message?.params?.conversationId ||
      message?.params?.conversation_id ||
      message?.params?.threadId ||
      message?.params?.thread_id ||
      message?.params?.conversationState?.id ||
      ""
    );
  }

  rememberDesktopConversation(message) {
    const id = this.conversationIdFromMessage(message);
    if (!id) return;
    const timestampMs = Date.now();
    const key = String(id);
    const existing = this.desktopConversationRows.get(key) || {};
    const title = firstString(message?.params?.conversationState?.title, message?.params?.title, message?.title, existing.title);
    this.desktopConversationRows.set(key, {
      id: key,
      title: title || existing.title || "Desktop conversation",
      rolloutPath: null,
      createdAtMs: existing.createdAtMs || timestampMs,
      updatedAtMs: Math.max(existing.updatedAtMs || 0, timestampMs),
      archived: false,
      preview: existing.preview || "",
      cwd: existing.cwd || "",
      model: existing.model || "",
      source: "desktop-ipc"
    });
    if (this.desktopConversationRows.size > 80) {
      const oldest = [...this.desktopConversationRows.values()].sort((a, b) => (a.updatedAtMs || 0) - (b.updatedAtMs || 0))[0];
      if (oldest?.id) this.desktopConversationRows.delete(oldest.id);
    }
  }

  rawEvents(limit = 80) {
    return this.events.slice(-rawDebugEventsLimit(limit)).map((event, index) => ({
      index,
      timestamp: event.timestamp,
      type: event.message?.type || "",
      method: event.message?.method || "",
      resultType: event.message?.resultType || "",
      requestId: event.message?.requestId || "",
      conversationId:
        event.message?.conversationId ||
        event.message?.conversation_id ||
        event.message?.threadId ||
        event.message?.thread_id ||
        event.message?.params?.conversationId ||
        event.message?.params?.conversation_id ||
        event.message?.params?.threadId ||
        event.message?.params?.thread_id ||
        "",
      summary: compact(redactLargePayloads(event.message), 3000)
    }));
  }

  getRecentConversationIds(maxAgeMs = 15 * 60 * 1000) {
    const cutoff = Date.now() - maxAgeMs;
    const ids = new Set();
    for (const event of this.events) {
      if (Date.parse(event.timestamp) < cutoff) continue;
      const id = this.conversationIdFromMessage(event.message);
      if (id) ids.add(String(id));
    }
    return ids;
  }

  getDesktopConversationIds() {
    return new Set(this.getDesktopConversationRows().map((row) => row.id));
  }

  getDesktopConversationRows() {
    return [...this.desktopConversationRows.values()].sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));
  }

  getRecentConversationRows(maxAgeMs = 15 * 60 * 1000) {
    const cutoff = Date.now() - maxAgeMs;
    const rowsById = new Map();
    for (const event of this.events) {
      const timestampMs = Date.parse(event.timestamp);
      if (timestampMs < cutoff) continue;
      const id = this.conversationIdFromMessage(event.message);
      if (!id) continue;
      const existing = rowsById.get(String(id)) || {};
      const title = firstString(
        event.message?.params?.conversationState?.title,
        event.message?.params?.title,
        event.message?.title,
        existing.title
      );
      rowsById.set(String(id), {
        id: String(id),
        title: title || "Desktop conversation",
        rolloutPath: null,
        createdAtMs: existing.createdAtMs || timestampMs,
        updatedAtMs: Math.max(existing.updatedAtMs || 0, timestampMs),
        archived: false,
        preview: existing.preview || "",
        cwd: existing.cwd || "",
        model: existing.model || "",
        source: "desktop-ipc"
      });
    }
    return [...rowsById.values()].sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));
  }

  hasConversationEvent(threadId, sinceMs = 0) {
    const selectedThreadId = String(threadId || "");
    if (!selectedThreadId) return false;
    return this.events.some((event) => {
      if (sinceMs && Date.parse(event.timestamp) < sinceMs) return false;
      const id =
        event.message?.conversationId ||
        event.message?.conversation_id ||
        event.message?.threadId ||
        event.message?.thread_id ||
        event.message?.params?.conversationId ||
        event.message?.params?.conversation_id ||
        event.message?.params?.threadId ||
        event.message?.params?.thread_id ||
        "";
      return String(id) === selectedThreadId;
    });
  }

  async waitForConversationEvent(threadId, { sinceMs = 0, timeoutMs = 5000 } = {}) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (this.hasConversationEvent(threadId, sinceMs)) return true;
      await sleep(150);
    }
    return false;
  }

  getRecentInteractionMessages(threadId) {
    const selectedThreadId = String(threadId || "");
    const cutoff = Date.now() - 10 * 60 * 1000;
    return this.events.flatMap((event, index) => {
        if (Date.parse(event.timestamp) < cutoff) return [];
        const payload = event.message?.payload || event.message?.params || event.message;
        const messageThreadId =
          event.message?.conversationId ||
          event.message?.conversation_id ||
          event.message?.threadId ||
          event.message?.thread_id ||
          event.message?.params?.conversationId ||
          event.message?.params?.conversation_id ||
          event.message?.params?.threadId ||
          event.message?.params?.thread_id ||
          "";
        if (selectedThreadId && (!messageThreadId || String(messageThreadId) !== selectedThreadId)) return [];
        const meta = {
          source: "desktop-ipc",
          turnId: event.message?.turnId || event.message?.params?.turnId || null
        };
        const payloads = interactionPayloadsFromIpcMessage(event.message);
        if (!payloads.length && isInteractionPayload(payload)) payloads.push(payload);
        return payloads
          .map((interactionPayload, payloadIndex) => {
            const interaction = messageFromInteractionEvent(event.timestamp, interactionPayload, meta);
            if (!hasDisplayableMessageContent(interaction)) return null;
            return {
              ...interaction,
              lineNumber: 1000000 + index * 20 + payloadIndex,
              requiresDesktopAction: true
            };
          })
          .filter(Boolean);
      })
  }

  getRecentNoticeMessages(threadId) {
    const selectedThreadId = String(threadId || "");
    return this.events
      .map((event, index) => {
        const payload = event.message?.payload || event.message?.params || event.message;
        const messageThreadId =
          event.message?.conversationId ||
          event.message?.conversation_id ||
          event.message?.threadId ||
          event.message?.thread_id ||
          event.message?.params?.conversationId ||
          event.message?.params?.conversation_id ||
          event.message?.params?.threadId ||
          event.message?.params?.thread_id ||
          "";
        if (selectedThreadId && (!messageThreadId || String(messageThreadId) !== selectedThreadId)) return null;
        const notice = messageFromNoticeEvent(event.timestamp, payload, {
          source: "desktop-ipc",
          turnId: event.message?.turnId || event.message?.params?.turnId || null
        });
        if (!hasDisplayableMessageContent(notice)) return null;
        return {
          ...notice,
          lineNumber: 1500000 + index
        };
      })
      .filter(Boolean);
  }

  request(method, params = {}, { includeVersion = true, timeoutMs = 12000 } = {}) {
    return new Promise((resolve, reject) => {
      if (!this.socket?.writable) {
        reject(new Error("Codex desktop IPC is not connected"));
        return;
      }
      const requestId = randomUUID();
      const message = {
        type: "request",
        requestId,
        sourceClientId: this.clientId || undefined,
        method,
        params
      };
      if (params?.hostId) {
        message.hostId = params.hostId;
      }
      if (includeVersion) {
        message.version = ipcVersionForRequest(method, params);
      }
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        this.captureEvent({
          type: "response",
          direction: "timeout",
          requestId,
          method,
          params,
          resultType: "error",
          error: `${method} timed out`
        });
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer, method, params });
      this.captureEvent({
        ...message,
        direction: "outgoing-request"
      });
      this.socket.write(this.encode(message));
    });
  }

  async startTurn(threadId, text, images = [], turnSettings = {}) {
    await this.ensureReady();
    const { method, params } = desktopStartTurnRequest(threadId, text, images, turnSettings);
    return this.request(method, params);
  }

  async findThreadOwner(threadId, hostId = "local") {
    await this.ensureReady();
    try {
      const response = await this.request(
        "thread-owner-discovery",
        { hostId, conversationId: threadId },
        { timeoutMs: 2000 }
      );
      return response?.handledByClientId || response?.result?.handledByClientId || null;
    } catch (error) {
      if (isNoOpenOwnerError(error)) return null;
      throw error;
    }
  }

  async waitForThreadOwner(threadId, { hostId = "local", timeoutMs = 6000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ownerClientId = await this.findThreadOwner(threadId, hostId);
      if (ownerClientId) return ownerClientId;
      await sleep(150);
    }
    return null;
  }

  async steerTurn(threadId, text, images = [], { cwd = process.cwd() } = {}) {
    await this.ensureReady();
    const clientUserMessageId = randomUUID();
    return this.request("thread-follower-steer-turn", {
      conversationId: threadId,
      hostId: "local",
      input: desktopTurnInput(text, images),
      restoreMessage: desktopSteerRestoreMessage(text, cwd, clientUserMessageId),
      serviceTier: null,
      attachments: [],
      clientUserMessageId,
      additionalContext: null
    });
  }

  async interruptTurn(threadId, expectedTurnId = null) {
    await this.ensureReady();
    const { method, params } = desktopInterruptTurnRequest(threadId, expectedTurnId);
    return this.request(method, params);
  }

  async getThreadGoal(threadId) {
    await this.ensureReady();
    const response = await this.request("thread/goal/get", { threadId }, { timeoutMs: 5000 });
    return response?.result?.goal ?? response?.goal ?? null;
  }

  async setThreadGoal(threadId, { objective, status = null } = {}) {
    await this.ensureReady();
    const response = await this.request("thread/goal/set", {
      threadId,
      objective: objective == null ? null : String(objective),
      status: status || null
    }, { timeoutMs: 8000 });
    return response?.result?.goal ?? response?.goal ?? null;
  }

  async clearThreadGoal(threadId) {
    await this.ensureReady();
    const response = await this.request("thread/goal/clear", { threadId }, { timeoutMs: 8000 });
    return response?.result ?? response;
  }

  async compactThread(threadId) {
    await this.ensureReady();
    return this.request("thread-follower-compact-thread", { conversationId: threadId }, { timeoutMs: 15000 });
  }

  async refreshRecentConversations(hostId = "local") {
    await this.ensureReady();
    return this.request("refresh-recent-conversations-for-host", { hostId }, { timeoutMs: 8000 });
  }

  async setActiveConversation(threadId, active = true, hostId = "local") {
    await this.ensureReady();
    return this.request(
      "set-active-conversation",
      {
        hostId,
        conversationId: threadId,
        active
      },
      { timeoutMs: 8000 }
    );
  }

  async startConversation(text, images = [], turnSettings = {}) {
    await this.ensureReady();
    const { model, effort } = normalizeTurnSettings(turnSettings);
    const input = [];
    if (text) input.push({ type: "text", text, text_elements: [] });
    for (const image of images) {
      input.push({
        type: "image",
        url: `data:${image.mimeType};base64,${image.data}`
      });
    }
    return this.request(
      "start-conversation",
      {
        hostId: "local",
        input,
        attachments: [],
        cwd: process.cwd(),
        workspaceRoots: [process.cwd()],
        model,
        effort,
        collaborationMode: null,
        threadSource: "user",
        approvalsReviewer: "user"
      },
      { timeoutMs: 60000 }
    );
  }
}

function getCodexIpcClient() {
  if (!codexIpcClient) codexIpcClient = new DesktopCodexIpcClient();
  return codexIpcClient;
}

function keepIpcWarm() {
  if (!ALLOW_WRITE) return;
  getCodexIpcClient()
    .ensureReady()
    .catch(() => {
      // The health endpoint should not fail just because Codex Desktop is closed.
    });
}

function sqlString(value) {
  return String(value).replaceAll("'", "''");
}

function decodeJwtPayload(token) {
  if (!token || typeof token !== "string") return null;
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function displayPlanName(plan) {
  const normalized = String(plan || "").trim().toLowerCase();
  if (!normalized) return "";
  const names = {
    free: "Free",
    plus: "Plus",
    pro: "Pro",
    team: "Team",
    enterprise: "Enterprise"
  };
  return names[normalized] || normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

async function readAuthProfile() {
  const { authFile } = codexPaths((await refreshCodexHomeContext()).home);
  if (!existsSync(authFile)) return {};
  const raw = await fs.readFile(authFile, "utf8");
  const auth = JSON.parse(raw);
  const idClaims = decodeJwtPayload(auth.tokens?.id_token) || {};
  const accessClaims = decodeJwtPayload(auth.tokens?.access_token) || {};
  const planClaim =
    idClaims["https://api.openai.com/auth.chatgpt_plan_type"] ||
    accessClaims["https://api.openai.com/auth.chatgpt_plan_type"];
  return {
    name: idClaims.name || accessClaims.name || "",
    email: idClaims.email || accessClaims.email || "",
    sub: idClaims.sub || accessClaims.sub || "",
    authMode: auth.auth_mode || "",
    tokenPlan: planClaim || ""
  };
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function extractTelemetryAccount(body) {
  const text = String(body || "");
  const email = text.match(/\buser\.email="([^"]+)"/)?.[1] || "";
  const accountId = text.match(/\buser\.account_id="([^"]+)"/)?.[1] || "";
  if (!email && !accountId) return null;
  return {
    email: normalizeEmail(email),
    accountId: String(accountId || "").trim()
  };
}

function accountFilterFromMap(latestByThread, currentEmail) {
  const knownEmails = new Set([...latestByThread.values()].map((account) => account.email).filter(Boolean));
  if (!knownEmails.size) return null;

  const allowedThreadIds = new Set(
    [...latestByThread.entries()].filter(([, account]) => account.email === currentEmail).map(([threadId]) => threadId)
  );
  return {
    currentEmail,
    knownEmails,
    allowedThreadIds,
    mappedThreadIds: new Set(latestByThread.keys()),
    active: knownEmails.has(currentEmail) || allowedThreadIds.size > 0
  };
}

async function refreshThreadAccountMap(homeState, logsDb, threadIds) {
  const existing =
    threadAccountCache?.home === homeState.home && threadAccountCache?.version === homeState.version
      ? threadAccountCache
      : null;
  const requested = [...new Set(threadIds.map((id) => String(id || "").trim()).filter(Boolean))];
  const valuesSql = requested.map((id) => `('${sqlString(id)}')`).join(",");
  // Probe each thread through the indexed thread_id timeline; scanning all telemetry bodies is prohibitively slow on large logs databases.
  const rows = requested.length
    ? await runSqlJsonFromDb(
        logsDb,
        `
          WITH requested(thread_id) AS (VALUES ${valuesSql})
          SELECT requested.thread_id AS threadId,
                 (
                   SELECT logs.feedback_log_body
                   FROM logs
                   WHERE logs.thread_id = requested.thread_id
                     AND logs.target = 'codex_otel.log_only'
                   ORDER BY logs.ts DESC, logs.ts_nanos DESC, logs.id DESC
                   LIMIT 1
                 ) AS body
          FROM requested;
        `
      )
    : [];
  const latestByThread = new Map(existing?.latestByThread || []);
  const checkedThreadIds = new Set(existing?.checkedThreadIds || []);
  for (const row of rows) {
    const threadId = String(row.threadId || "").trim();
    if (!threadId) continue;
    checkedThreadIds.add(threadId);
    const account = extractTelemetryAccount(row.body);
    if (account?.email) latestByThread.set(threadId, account);
  }

  threadAccountCache = {
    home: homeState.home,
    version: homeState.version,
    latestByThread,
    checkedThreadIds,
    cachedAt: Date.now()
  };
  return threadAccountCache;
}

async function readThreadAccountFilter(threadIds = []) {
  const homeState = await refreshCodexHomeContext();
  const profile = await readAuthProfile();
  const currentEmail = normalizeEmail(profile.email);
  if (!currentEmail) return null;

  const { logsDb } = codexPaths(homeState.home);
  if (!existsSync(logsDb)) return null;

  const now = Date.now();
  const cached =
    threadAccountCache?.home === homeState.home && threadAccountCache?.version === homeState.version
      ? threadAccountCache
      : null;
  const requested = [...new Set(threadIds.map((id) => String(id || "").trim()).filter(Boolean))];
  const missing = requested.filter((id) => !cached?.checkedThreadIds?.has(id));
  if (cached && !missing.length && now - cached.cachedAt < THREAD_ACCOUNT_CACHE_MS) {
    return accountFilterFromMap(cached.latestByThread, currentEmail);
  }

  if (threadAccountRefreshInFlight) {
    await threadAccountRefreshInFlight;
    return readThreadAccountFilter(requested);
  }
  threadAccountRefreshInFlight = refreshThreadAccountMap(homeState, logsDb, missing.length ? missing : requested).finally(() => {
    threadAccountRefreshInFlight = null;
  });
  const refreshed = await threadAccountRefreshInFlight;
  return accountFilterFromMap(refreshed.latestByThread, currentEmail);
}

async function filterRowsForCurrentAccount(rows, idSelector = (row) => row.id, preserveIds = []) {
  const rowIds = rows.map((row) => idSelector(row));
  const filter = await readThreadAccountFilter(rowIds);
  if (!filter?.active) return { rows, accountFiltered: false, accountEmail: filter?.currentEmail || "" };
  const desktopVisibleIds = codexIpcClient?.getDesktopConversationIds?.() || codexIpcClient?.getRecentConversationIds?.() || new Set();
  const preserved = new Set(preserveIds.map((id) => String(id || "").trim()).filter(Boolean));
  return {
    rows: rows.filter((row) => {
      const id = String(idSelector(row) || "");
      return filter.allowedThreadIds.has(id) || desktopVisibleIds.has(id) || preserved.has(id) || !filter.mappedThreadIds.has(id);
    }),
    accountFiltered: true,
    accountEmail: filter.currentEmail
  };
}

function normalizeRateLimitWindow(limit) {
  if (!limit || typeof limit !== "object") return null;
  const resetsAtSeconds = Number(limit.resets_at);
  const usedPercent = Number(limit.used_percent);
  const windowMinutes = Number(limit.window_minutes);
  return {
    usedPercent: Number.isFinite(usedPercent) ? usedPercent : null,
    windowMinutes: Number.isFinite(windowMinutes) ? windowMinutes : null,
    resetsAtMs: Number.isFinite(resetsAtSeconds) ? resetsAtSeconds * 1000 : null
  };
}

function normalizeRateLimits(rateLimits, updatedAt) {
  if (!rateLimits || typeof rateLimits !== "object") return null;
  const normalized = {
    planType: rateLimits.plan_type || "",
    primary: normalizeRateLimitWindow(rateLimits.primary),
    secondary: normalizeRateLimitWindow(rateLimits.secondary),
    credits:
      rateLimits.credits && typeof rateLimits.credits === "object"
        ? {
            hasCredits: Boolean(rateLimits.credits.has_credits),
            unlimited: Boolean(rateLimits.credits.unlimited),
            balance: Number.isFinite(Number(rateLimits.credits.balance)) ? Number(rateLimits.credits.balance) : null
          }
        : null,
    updatedAt: updatedAt || null
  };
  const hasUsefulUsage =
    Boolean(normalized.planType) ||
    Boolean(normalized.primary) ||
    Boolean(normalized.secondary) ||
    Boolean(normalized.credits?.hasCredits) ||
    Boolean(normalized.credits?.unlimited);
  return hasUsefulUsage ? normalized : null;
}

async function latestRolloutPaths(limit = 8) {
  const { stateDb } = codexPaths((await refreshCodexHomeContext()).home);
  const rows = [];
  const seen = new Set();
  if (existsSync(stateDb)) {
    const stateRows = await runSqlJson(`
      SELECT id, rollout_path AS rolloutPath, updated_at_ms AS updatedAtMs
      FROM threads
      WHERE rollout_path IS NOT NULL
      ORDER BY updated_at_ms DESC, updated_at DESC
      LIMIT 200;
    `);
    const filtered = await filterRowsForCurrentAccount(stateRows);
    for (const row of filtered.rows) {
      const id = String(row.id || "");
      if (id) seen.add(id);
      rows.push(row);
    }
  }
  const indexFiltered = await filterRowsForCurrentAccount(await readSessionIndexRows());
  for (const row of indexFiltered.rows) {
    const id = String(row.id || "");
    if (!row.rolloutPath || seen.has(id)) continue;
    seen.add(id);
    rows.push(row);
  }
  return rows
    .sort((a, b) => (Number(b.updatedAtMs) || 0) - (Number(a.updatedAtMs) || 0))
    .slice(0, Number(limit) || 8)
    .map((row) => {
      try {
        return resolveRolloutPath(row.rolloutPath);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function readLatestRateLimits() {
  const rolloutPaths = await latestRolloutPaths();
  for (const rolloutPath of rolloutPaths) {
    if (!existsSync(rolloutPath)) continue;
    const content = await fs.readFile(rolloutPath, "utf8");
    const lines = content.split(/\r?\n/);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index]?.trim();
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        const rateLimits = entry.type === "event_msg" && entry.payload?.type === "token_count" ? entry.payload.rate_limits : null;
        if (rateLimits) {
          const normalized = normalizeRateLimits(rateLimits, entry.timestamp);
          if (normalized) return normalized;
        }
      } catch {
        // Skip malformed historical lines.
      }
    }
  }
  return null;
}

async function readSessionIndexTitleMap() {
  const { sessionIndex } = codexPaths((await refreshCodexHomeContext()).home);
  if (!existsSync(sessionIndex)) return new Map();
  const content = await fs.readFile(sessionIndex, "utf8");
  const titles = new Map();
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      const id = String(row.id || "");
      const title = String(row.thread_name || row.title || "").trim();
      if (id && title) titles.set(id, title);
    } catch {
      // Ignore malformed historical index lines.
    }
  }
  return titles;
}

async function findSessionRolloutPathsInDir(dir, home, depth = 0) {
  if (depth > 8) return [];
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const matches = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      matches.push(...(await findSessionRolloutPathsInDir(entryPath, home, depth + 1)));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const id = entry.name.match(/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.jsonl$/)?.[1];
    if (!id) continue;
    let mtimeMs = 0;
    try {
      mtimeMs = (await fs.stat(entryPath)).mtimeMs;
    } catch {
      // Keep the path even if stat races with Codex writing/removing a file.
    }
    matches.push({ id, rolloutPath: path.relative(home, entryPath), mtimeMs });
  }
  return matches;
}

async function readSessionRolloutPathMap() {
  const homeState = await refreshCodexHomeContext();
  const { home, sessionsDir, archivedSessionsDir } = codexPaths(homeState.home);
  const cacheKey = `${homeState.home}:${homeState.version}`;
  const now = Date.now();
  if (sessionRolloutPathCache?.key === cacheKey && now - sessionRolloutPathCache.cachedAt < SESSION_ROLLOUT_PATH_CACHE_MS) {
    return sessionRolloutPathCache.value;
  }
  const rolloutRows = [
    ...(await findSessionRolloutPathsInDir(sessionsDir, home)),
    ...(await findSessionRolloutPathsInDir(archivedSessionsDir, home))
  ];
  const paths = new Map();
  for (const row of rolloutRows) {
    const existing = paths.get(row.id);
    if (!existing || row.mtimeMs >= existing.mtimeMs) paths.set(row.id, row);
  }
  const value = new Map([...paths.entries()].map(([id, row]) => [id, row.rolloutPath]));
  sessionRolloutPathCache = { key: cacheKey, cachedAt: now, value };
  return value;
}

// The Desktop migration can leave state_5.sqlite pointing at the old CODEX_HOME.
// Prefer the rollout discovered under the active home when the session id matches.
function rolloutPathForCurrentHome(row, rolloutPaths) {
  const id = String(row?.id || "");
  return (id && rolloutPaths?.get(id)) || row?.rolloutPath || null;
}

async function readSessionIndexRows() {
  const { sessionIndex } = codexPaths((await refreshCodexHomeContext()).home);
  if (!existsSync(sessionIndex)) return [];
  const content = await fs.readFile(sessionIndex, "utf8");
  const rolloutPaths = await readSessionRolloutPathMap();
  const rowsById = new Map();
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      const id = String(row.id || "").trim();
      if (!id) continue;
      const title = String(row.thread_name || row.title || "").trim();
      rowsById.set(id, {
        id,
        title: title || "Untitled",
        rolloutPath: rolloutPaths.get(id) || null,
        createdAtMs: null,
        updatedAtMs: Date.parse(row.updated_at),
        archived: false,
        preview: "",
        cwd: "",
        model: "",
        source: "session-index"
      });
    } catch {
      // Ignore malformed historical index lines.
    }
  }
  return [...rowsById.values()].sort((a, b) => (Number(b.updatedAtMs) || 0) - (Number(a.updatedAtMs) || 0));
}

function displayThreadTitle(row, sessionIndexTitles) {
  const indexedTitle = sessionIndexTitles?.get(String(row.id || ""));
  return indexedTitle || row.title || "Untitled";
}

function isSubagentThread(row) {
  if (String(row?.threadSource || row?.thread_source || "").toLowerCase() === "subagent") return true;
  const source = row?.source;
  if (!source || typeof source !== "string" || !source.trim().startsWith("{")) return false;
  try {
    return Boolean(JSON.parse(source)?.subagent);
  } catch {
    return false;
  }
}

function visibleThreadRows(rows, preserveIds = []) {
  const preserved = new Set(preserveIds.map((id) => String(id || "").trim()).filter(Boolean));
  return rows.filter((row) => !isSubagentThread(row) || preserved.has(String(row?.id || "")));
}

function normalizedProjectPath(cwd) {
  let value = String(cwd || "").trim();
  if (!value) return "";
  value = value.replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\/, "");
  return path.win32.normalize(value);
}

function projectRootMetadata(rows = []) {
  const byPath = new Map();
  for (const row of rows) {
    const root = normalizedProjectPath(row?.projectRoot);
    const projectId = String(row?.projectId || "").trim();
    const projectName = String(row?.projectName || "").trim();
    if (!root || !projectId || !projectName) continue;
    const key = root.toLowerCase();
    const candidates = byPath.get(key) || [];
    candidates.push({ key: `project:${projectId}`, id: projectId, name: projectName, native: true, root });
    byPath.set(key, candidates);
  }
  return byPath;
}

function projectForRoot(cwd, projectRootsByPath) {
  if (!projectRootsByPath) return null;
  const normalizedCwd = normalizedProjectPath(cwd);
  if (!normalizedCwd) return null;
  const cwdKey = normalizedCwd.toLowerCase();
  let bestRootLength = -1;
  let bestCandidates = null;
  for (const [rootKey, candidates] of projectRootsByPath.entries()) {
    if (!rootKey || !Array.isArray(candidates) || !candidates.length) continue;
    const isExact = cwdKey === rootKey;
    const isChild = cwdKey.startsWith(`${rootKey}\\`);
    if (!isExact && !isChild) continue;
    if (rootKey.length > bestRootLength) {
      bestRootLength = rootKey.length;
      bestCandidates = candidates;
    }
  }
  const uniqueCandidates = [];
  const candidateIds = new Set();
  for (const candidate of bestCandidates || []) {
    const candidateId = String(candidate?.id || "").trim();
    if (!candidateId || candidateIds.has(candidateId)) continue;
    candidateIds.add(candidateId);
    uniqueCandidates.push(candidate);
  }
  if (uniqueCandidates.length !== 1) return null;
  // A migrated Desktop profile can retain one workspace root in multiple
  // projects. Ambiguous roots remain ungrouped because choosing by position or
  // project name would silently put conversations into the wrong project.
  return uniqueCandidates[0];
}

function threadListMetadata(row, projectRootsByPath = null) {
  const projectId = String(row?.projectId || row?.project_id || "").trim();
  const projectName = String(row?.projectName || row?.project_name || "").trim();
  const sectionName = String(row?.sectionName || row?.section_name || "").trim();
  const pinned = Number(row?.isPinned ?? row?.is_pinned) === 1 || sectionName.toLowerCase() === "pinned";
  if (projectId) {
    return {
      pinned,
      project: projectName ? { key: `project:${projectId}`, id: projectId, name: projectName, native: true } : null
    };
  }
  const project = projectForRoot(row?.cwd, projectRootsByPath);
  if (project) return { pinned, project };
  return { pinned, project: null };
}

async function readProjectRoots() {
  try {
    return projectRootMetadata(await runSqlJson(`
      SELECT projects.id AS projectId, projects.name AS projectName, project_roots.path AS projectRoot
      FROM project_roots
      INNER JOIN projects ON projects.id = project_roots.project_id
      ORDER BY projects.position ASC, project_roots.position ASC;
    `));
  } catch {
    return new Map();
  }
}

async function threadListStatus(row) {
  const rolloutPath = resolveRolloutPath(row?.rolloutPath);
  if (!rolloutPath || !existsSync(rolloutPath)) {
    return { state: "unknown", thinking: false, interactionRequired: false };
  }
  try {
    const parsed = await parseRollout(rolloutPath, { limit: 1, preferTail: true });
    return {
      state: parsed.status?.thinking ? "running" : parsed.status?.interactionRequired ? "waiting" : "ended",
      thinking: Boolean(parsed.status?.thinking),
      interactionRequired: Boolean(parsed.status?.interactionRequired),
      turnId: parsed.status?.turnId || null,
      startedAtMs: parsed.status?.startedAtMs || null
    };
  } catch {
    return { state: "unknown", thinking: false, interactionRequired: false };
  }
}

function isArchivedThread(row) {
  return row?.archived === true || Number(row?.archived) === 1;
}

async function getAccountInfo() {
  const now = Date.now();
  if (accountCache && now - accountCache.cachedAt < ACCOUNT_CACHE_MS) return accountCache.value;
  if (accountInfoInFlight) return accountInfoInFlight;

  accountInfoInFlight = (async () => {
    try {
      const profile = await readAuthProfile();
      const usage = await readLatestRateLimits();
      const plan = usage?.planType || profile.tokenPlan || "";
      const value = {
        user: {
          name: profile.name,
          email: profile.email,
          label: profile.name || profile.email || "Codex"
        },
        plan: {
          type: String(plan || "").toLowerCase(),
          label: displayPlanName(plan)
        },
        usage
      };
      accountCache = { cachedAt: Date.now(), value };
      return value;
    } catch (error) {
      if (accountCache && Date.now() - accountCache.cachedAt < ACCOUNT_STALE_CACHE_MS) {
        logError(`[cache:stale] GET /api/account using cached account after refresh failed: ${error?.message || error}`);
        return accountCache.value;
      }
      throw error;
    } finally {
      accountInfoInFlight = null;
    }
  })();
  return accountInfoInFlight;
}

async function getThreads({ preserveIds = [] } = {}) {
  const preserveKey = [...new Set(preserveIds.map((id) => String(id || "").trim()).filter(Boolean))].sort().join(",");
  const now = Date.now();
  if (threadsCache?.key === preserveKey && now - threadsCache.cachedAt < THREADS_CACHE_MS) return threadsCache.value;
  if (threadsInFlight?.key === preserveKey) return threadsInFlight.promise;

  const promise = loadThreadsUncached({ preserveIds, preserveKey });
  threadsInFlight = { key: preserveKey, promise };
  try {
    return await promise;
  } finally {
    if (threadsInFlight?.promise === promise) threadsInFlight = null;
  }
}

async function loadThreadsUncached({ preserveIds = [], preserveKey = "" } = {}) {
  const { stateDb, sessionIndex } = codexPaths((await refreshCodexHomeContext()).home);
  const currentRolloutPaths = await readSessionRolloutPathMap();
  const projectRootsByPath = await readProjectRoots();
  const appendRecentIpcRows = (rows, excludedIds = new Set()) => {
    const seen = new Set(rows.map((row) => String(row.id || "")));
    const recentRows = codexIpcClient?.getDesktopConversationRows?.() || codexIpcClient?.getRecentConversationRows?.() || [];
    return [
      ...rows,
      ...recentRows.filter((row) => {
        const id = String(row.id || "");
        return !isArchivedThread(row) && !excludedIds.has(id) && !seen.has(id) && row.rolloutPath;
      }).map((row) => ({ ...row, rolloutPath: rolloutPathForCurrentHome(row, currentRolloutPaths) }))
    ].sort((a, b) => {
      const updatedA = Number(a.updatedAtMs) || 0;
      const updatedB = Number(b.updatedAtMs) || 0;
      return updatedB - updatedA;
    });
  };
  try {
    let value;
    if (existsSync(stateDb)) {
      const sessionIndexTitles = await readSessionIndexTitleMap();
      const rows = await runSqlJson(`
        SELECT threads.id, threads.title, threads.rollout_path AS rolloutPath,
               threads.created_at_ms AS createdAtMs, threads.updated_at_ms AS updatedAtMs,
               threads.archived, threads.preview, threads.cwd, threads.model, threads.source,
               threads.thread_source AS threadSource, threads.agent_path AS agentPath,
               threads.is_pinned AS isPinned, threads.thread_section_id AS threadSectionId,
               thread_sections.name AS sectionName, threads.section_position AS sectionPosition,
               threads.project_id AS projectId, projects.name AS projectName
        FROM threads
        LEFT JOIN thread_sections ON thread_sections.id = threads.thread_section_id
        LEFT JOIN projects ON projects.id = threads.project_id
        ORDER BY threads.updated_at_ms DESC, threads.updated_at DESC
        LIMIT 500;
      `);
      const filtered = await filterRowsForCurrentAccount(rows, (row) => row.id, preserveIds);
      const archivedIds = new Set(rows.filter(isArchivedThread).map((row) => String(row.id || "")));
      const visibleRows = visibleThreadRows(filtered.rows, preserveIds);
      const hiddenIds = new Set(rows.filter((row) => isSubagentThread(row) && !visibleRows.includes(row)).map((row) => String(row.id || "")));
      const excludedIds = new Set([...archivedIds, ...hiddenIds]);
      const stateRows = visibleRows.filter((row) => !isArchivedThread(row)).map((row) => ({
        id: row.id,
        title: displayThreadTitle(row, sessionIndexTitles),
        rolloutPath: rolloutPathForCurrentHome(row, currentRolloutPaths),
        createdAtMs: row.createdAtMs,
        updatedAtMs: row.updatedAtMs,
        archived: Boolean(row.archived),
        preview: row.preview || "",
        cwd: row.cwd || "",
        model: row.model || "",
         ...threadListMetadata(row, projectRootsByPath)
      }));
      const seen = new Set(stateRows.map((row) => String(row.id || "")));
      const indexFiltered = await filterRowsForCurrentAccount(await readSessionIndexRows(), (row) => row.id, preserveIds);
      const indexRows = indexFiltered.rows
        .filter((row) => !seen.has(String(row.id || "")) && !excludedIds.has(String(row.id || "")))
         .map((row) => ({ ...row, ...threadListMetadata(row, projectRootsByPath) }));
      value = appendRecentIpcRows([...stateRows, ...indexRows], excludedIds).map((row) => (
        Object.hasOwn(row, "pinned") ? row : { ...row, ...threadListMetadata(row, projectRootsByPath) }
      ));
    } else {
      const rows = await readSessionIndexRows();
      const filtered = await filterRowsForCurrentAccount(rows, (row) => row.id, preserveIds);
      value = appendRecentIpcRows(visibleThreadRows(filtered.rows, preserveIds)).map((row) => ({
        ...row,
        ...threadListMetadata(row, projectRootsByPath)
      }));
    }
    const statusRows = await Promise.all(value.slice(0, 120).map(async (row) => ({
      id: row.id,
      status: await threadListStatus(row)
    })));
    const statusById = new Map(statusRows.map((row) => [String(row.id || ""), row.status]));
    value = value.map((row) => ({
      ...row,
      status: statusById.get(String(row.id || "")) || { state: "unknown", thinking: false, interactionRequired: false }
    }));
    threadsCache = { key: preserveKey, cachedAt: Date.now(), value };
    return value;
  } catch (error) {
    if (threadsCache?.key === preserveKey && Date.now() - threadsCache.cachedAt < THREADS_STALE_CACHE_MS) {
      logError(`[cache:stale] GET /api/threads using cached threads after refresh failed: ${error?.message || error}`);
      return threadsCache.value;
    }
    throw error;
  }
}

async function findThread(id) {
  const recentIpcThread =
    (codexIpcClient?.getDesktopConversationRows?.() || codexIpcClient?.getRecentConversationRows?.() || []).find((row) => row.id === String(id)) ||
    null;
  const sessionIndexTitles = await readSessionIndexTitleMap();
  const currentRolloutPaths = await readSessionRolloutPathMap();
  const rows = await runSqlJson(`
    SELECT id, title, rollout_path AS rolloutPath, updated_at_ms AS updatedAtMs, cwd
    FROM threads
    WHERE id = '${sqlString(id)}'
    LIMIT 1;
  `);
  if (!rows[0]) {
    const indexedThread = (await readSessionIndexRows()).find((row) => row.id === String(id));
    if (indexedThread) return indexedThread;
    return recentIpcThread;
  }
  const resolvedRolloutPath = rolloutPathForCurrentHome(rows[0], currentRolloutPaths);
  let rolloutUpdatedAtMs = Number(rows[0].updatedAtMs) || 0;
  if (resolvedRolloutPath) {
    try {
      rolloutUpdatedAtMs = Math.max(rolloutUpdatedAtMs, Number((await fs.stat(resolvedRolloutPath)).mtimeMs) || 0);
    } catch {
      // Keep the Desktop database timestamp when the rollout is unavailable.
    }
  }
  return {
    ...rows[0],
    rolloutPath: resolvedRolloutPath,
    updatedAtMs: rolloutUpdatedAtMs,
    cwd: rows[0].cwd || "",
    title: displayThreadTitle(rows[0], sessionIndexTitles)
  };
}

function resolveRolloutPath(rolloutPath) {
  if (!rolloutPath) return null;
  const { home } = codexPaths();
  const rawPath = String(rolloutPath);
  const portablePath =
    process.platform === "win32" && rawPath.startsWith("\\\\?\\UNC\\")
      ? `\\${rawPath.slice(8)}`
      : process.platform === "win32" && rawPath.startsWith("\\\\?\\")
        ? rawPath.slice(4)
        : rawPath;
  const absolute = path.isAbsolute(portablePath) ? portablePath : path.join(home, portablePath);
  const normalized = path.resolve(absolute);
  const normalizedHome = path.resolve(home);
  const relative = path.relative(normalizedHome, normalized);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Rollout path is outside CODEX_HOME");
  }
  return normalized;
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      return part.text || part.input_text || part.output_text || "";
    })
    .filter(Boolean)
    .join("\n");
}

function imagesFromContent(content) {
  if (!Array.isArray(content)) return [];
  return content
    .map((part) => {
      const source = part?.source || {};
      if (part?.type === "input_image" && typeof part.image_url === "string" && part.image_url.startsWith("data:image/")) {
        return part.image_url;
      }
      if (part?.type !== "image" || source.type !== "base64" || !source.data || !source.media_type) return null;
      return `data:${source.media_type};base64,${source.data}`;
    })
    .filter(Boolean);
}

function stripCodexDirectives(text) {
  return String(text || "")
    .split(/\r?\n/)
    .filter((line) => !line.trim().match(/^::[a-zA-Z][\w-]*\{/))
    .join("\n")
    .trim();
}

function compact(value, limit = 6000) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n... truncated ${text.length - limit} chars`;
}

function parseMaybeJsonObject(value) {
  if (!value || typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseMaybeJsonValue(value) {
  if (!value || typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function imageUrlsFromValue(value, images = [], depth = 0, seen = new Set()) {
  if (images.length >= 8 || value == null || depth > 8) return images;
  if (typeof value === "string") {
    if (value.startsWith("data:image/")) images.push(value);
    return images;
  }
  if (typeof value !== "object" || seen.has(value)) return images;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) imageUrlsFromValue(item, images, depth + 1, seen);
    return images;
  }
  const imageUrl = value.image_url || value.imageUrl;
  if (typeof imageUrl === "string" && imageUrl.startsWith("data:image/")) images.push(imageUrl);
  const source = value.source || {};
  if (source.type === "base64" && source.media_type && source.data) {
    images.push(`data:${source.media_type};base64,${source.data}`);
  }
  for (const item of Object.values(value)) imageUrlsFromValue(item, images, depth + 1, seen);
  return images;
}

function imagesFromToolOutput(output) {
  const parsed = parseMaybeJsonValue(output);
  return Array.from(new Set(imageUrlsFromValue(parsed ?? output)));
}

function compactToolOutput(output, images = []) {
  if (images.length) return `[image output: ${images.length} image${images.length === 1 ? "" : "s"}]`;
  const contentText = textFromContent(output);
  if (contentText) return compact(contentText);
  const parsed = parseMaybeJsonValue(output);
  if (parsed) return compact(redactLargePayloads(parsed), images.length ? 1800 : 6000);
  return compact(output || "");
}

function localPathCandidates(value) {
  const text = String(value || "");
  const matches = text.match(/(?:\\\\\?\\[A-Za-z]:\\|[A-Za-z]:[\\/])[^<>"'`\r\n)\]]+|\/(?:Users|home|tmp|var|mnt|workspace)\/[^<>"'`\r\n)\]]+/g) || [];
  return Array.from(
    new Set(
      matches
        .map((item) => item.replace(/\\\\/g, "\\").trim().replace(/^[({[]+/, "").replace(/[)\]}>.,;。，；、]+$/, ""))
        .map((item) => item.replace(/:(\d+)(?::\d+)?$/, ""))
        .filter((item) => path.isAbsolute(item) && !/^https?:\/\//i.test(item))
    )
  );
}

function localPathCandidateVariants(candidate) {
  const value = String(candidate || "").trim();
  const variants = [value];
  const words = value.split(/\s+/);
  while (words.length > 1) {
    words.pop();
    variants.push(words.join(" "));
  }
  return Array.from(new Set(variants.map((item) => item.replace(/[)\]}>.,;。，；、]+$/, "").replace(/:(\d+)(?::\d+)?$/, ""))));
}

async function inspectLocalFileCandidate(candidate) {
  for (const variant of localPathCandidateVariants(candidate)) {
    if (!path.isAbsolute(variant) || variant.includes("\0")) continue;
    try {
      const canonicalPath = await fs.realpath(path.resolve(variant));
      const stat = await fs.stat(canonicalPath);
      if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_LOCAL_FILE_BYTES) continue;
      const mimeType = mimeTypeForAsset(canonicalPath) || "application/octet-stream";
      return {
        name: path.basename(canonicalPath),
        path: canonicalPath,
        size: stat.size,
        mimeType,
        inline: mimeType.startsWith("image/")
      };
    } catch {
      // Try a shorter candidate when prose followed the path on the same line.
    }
  }
  return null;
}

function canExposeLocalFilesForMessage(message) {
  const role = String(message?.role || "").trim().toLowerCase();
  return role !== "system" && role !== "developer";
}

function stripHiddenMessageLocalAssets(message) {
  if (canExposeLocalFilesForMessage(message)) return message;
  const { files: _files, localImages: _localImages, ...safeMessage } = message || {};
  return safeMessage;
}

async function decorateMessageFiles(messages, threadId, thread = {}) {
  const authorized = new Map();
  const decorated = [];
  for (const message of messages || []) {
    if (!canExposeLocalFilesForMessage(message)) {
      decorated.push(stripHiddenMessageLocalAssets(message));
      continue;
    }
    const candidates = new Set();
    const add = (value) => localPathCandidates(value).forEach((item) => candidates.add(item));
    add(message.content);
    for (const item of message.localImages || []) add(item);
    for (const item of message.files || []) add(item.path);
    const messageFiles = new Map();
    for (const candidate of candidates) {
      const file = await inspectLocalFileCandidate(candidate);
      if (!file) continue;
      authorized.set(file.path, file);
      messageFiles.set(file.path, file);
    }
    decorated.push(messageFiles.size ? { ...message, files: [...messageFiles.values()] } : message);
  }
  referencedFilesByThread.set(String(threadId), authorized);
  return decorated;
}

const INTERACTION_TYPE_PATTERNS = [
  "approval",
  "permission",
  "permissions",
  "elicitation",
  "request_user_input",
  "user_input_request",
  "terminal_interaction",
  "dynamic_tool_call_request",
  "command_approval",
  "file_approval"
];

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value) && value.length) {
      const joined = value
        .map((part) => (typeof part === "string" ? part : ""))
        .filter(Boolean)
        .join(" ");
      if (joined.trim()) return joined.trim();
    }
  }
  return "";
}

function redactLargePayloads(value, depth = 0) {
  if (depth > 5) return "[nested payload]";
  if (typeof value === "string") {
    if (value.length > 240 && /^[A-Za-z0-9+/]+={0,2}$/.test(value)) return `[base64 data ${value.length} chars]`;
    if (value.length > 1200) return `${value.slice(0, 1200)}...`;
    return value;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactLargePayloads(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey.includes("image") || normalizedKey.includes("base64") || normalizedKey === "data") {
        if (typeof item === "string") return [key, `[omitted ${item.length} chars]`];
        return [key, "[omitted binary payload]"];
      }
      return [key, redactLargePayloads(item, depth + 1)];
    })
  );
}

function isInteractionPayload(payload) {
  if (isApprovalDecisionPayload(payload)) return false;
  const toolArguments = parseMaybeJsonObject(payload?.arguments);
  const params = payload?.params || payload?.payload || {};
  if (
    toolArguments?.sandbox_permissions === "require_escalated" ||
    params?.sandbox_permissions === "require_escalated" ||
    params?.sandboxPermissions === "require_escalated" ||
    payload?.sandbox_permissions === "require_escalated" ||
    payload?.sandboxPermissions === "require_escalated"
  ) {
    return true;
  }
  const text = [
    payload?.type,
    payload?.method,
    payload?.name,
    payload?.event,
    payload?.kind,
    payload?.payload?.type,
    payload?.params?.type
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return INTERACTION_TYPE_PATTERNS.some((pattern) => text.includes(pattern));
}

function isApprovalDecisionPayload(payload) {
  const method = String(payload?.method || payload?.name || payload?.type || "").toLowerCase();
  const params = payload?.params || payload?.payload || {};
  return (
    payload?.direction === "outgoing-request" ||
    method.includes("approval-decision") ||
    method.includes("approval_decision") ||
    method.includes("approval-response") ||
    method.includes("approval_response") ||
    ((params?.decision || params?.response) && method.includes("approval"))
  );
}

function interactionTitle(payload) {
  const toolArguments = parseMaybeJsonObject(payload?.arguments);
  if (toolArguments?.sandbox_permissions === "require_escalated") return "Command approval requested";
  const type = String(payload?.type || payload?.method || payload?.name || payload?.kind || "").toLowerCase();
  if (type.includes("command") || type.includes("exec")) return "Command approval requested";
  if (type.includes("apply_patch")) return "Patch approval requested";
  if (type.includes("file")) return "File approval requested";
  if (type.includes("permission")) return "Permission requested";
  if (type.includes("elicitation")) return "Additional information requested";
  if (type.includes("user_input")) return "User input requested";
  if (type.includes("terminal")) return "Terminal interaction requested";
  if (type.includes("tool")) return "Tool interaction requested";
  return "Codex interaction requested";
}

function approvalKindFromPayload(payload) {
  const toolArguments = parseMaybeJsonObject(payload?.arguments);
  const params = payload?.params || payload?.payload || {};
  const type = String(payload?.type || payload?.method || payload?.name || payload?.kind || "").toLowerCase();
  if (
    toolArguments?.sandbox_permissions === "require_escalated" ||
    params?.sandbox_permissions === "require_escalated" ||
    params?.sandboxPermissions === "require_escalated" ||
    payload?.sandbox_permissions === "require_escalated" ||
    payload?.sandboxPermissions === "require_escalated"
  ) {
    return "command";
  }
  if (type.includes("apply_patch") || type.includes("filechange") || type.includes("file_change") || type.includes("file")) return "file";
  if (type.includes("permission")) return "permission";
  if (type.includes("command") || type.includes("exec") || type.includes("terminal")) return "command";
  return "";
}

function interactionContent(payload) {
  const toolArguments = parseMaybeJsonObject(payload?.arguments);
  const params = payload?.params || payload?.payload || toolArguments || {};
  const request = payload?.request || params?.request || {};
  const toolCall = payload?.tool_call || params?.tool_call || params?.toolCall || {};
  const command = firstString(
    payload?.command,
    params?.command,
    toolArguments?.cmd,
    toolArguments?.command,
    request?.command,
    payload?.cmd,
    params?.cmd,
    payload?.program,
    params?.program,
    payload?.execve,
    params?.execve,
    toolCall?.command,
    toolCall?.name
  );
  const pathValue = firstString(
    payload?.path,
    params?.path,
    request?.path,
    payload?.file_path,
    params?.file_path,
    request?.file_path,
    payload?.grant_root,
    params?.grant_root
  );
  const prompt = firstString(
    payload?.message,
    params?.message,
    request?.message,
    payload?.prompt,
    params?.prompt,
    payload?.question,
    params?.question,
    request?.question,
    payload?.reason,
    params?.reason,
    toolArguments?.justification,
    params?.justification,
    request?.reason
  );
  const choices = Array.isArray(payload?.available_decisions)
    ? payload.available_decisions
    : Array.isArray(params?.available_decisions)
      ? params.available_decisions
      : Array.isArray(payload?.options)
    ? payload.options
    : Array.isArray(params?.options)
      ? params.options
      : Array.isArray(request?.options)
        ? request.options
        : [];
  const lines = [
    prompt ? `Prompt: ${prompt}` : "",
    command ? `Command: ${command}` : "",
    pathValue ? `Path: ${pathValue}` : "",
    firstString(toolArguments?.workdir, params?.workdir, params?.cwd) ? `Workdir: ${firstString(toolArguments?.workdir, params?.workdir, params?.cwd)}` : "",
    choices.length ? `Options: ${choices.map((option) => firstString(option?.label, option?.title, option?.id, option)).filter(Boolean).join(", ")}` : ""
  ].filter(Boolean);
  if (lines.length) return lines.join("\n\n");
  return compact(redactLargePayloads(payload), 2400);
}

function interactionRequestId(payload) {
  const params = payload?.params || payload?.payload || {};
  const request = payload?.request || params?.request || {};
  return (
    payload?.request_id ||
    payload?.requestId ||
    payload?.approval_id ||
    payload?.approvalId ||
    payload?.id ||
    payload?.call_id ||
    payload?.callId ||
    params?.request_id ||
    params?.requestId ||
    params?.approval_id ||
    params?.approvalId ||
    params?.id ||
    request?.request_id ||
    request?.requestId ||
    request?.approval_id ||
    request?.approvalId ||
    request?.id ||
    null
  );
}

function collectInteractionPayloads(value, depth = 0, seen = new Set(), results = []) {
  if (!value || typeof value !== "object" || depth > 12 || seen.has(value)) return results;
  seen.add(value);
  if (isInteractionPayload(value) && interactionRequestId(value)) results.push(value);
  if (Array.isArray(value)) {
    for (const item of value) collectInteractionPayloads(item, depth + 1, seen, results);
    return results;
  }
  for (const child of Object.values(value)) collectInteractionPayloads(child, depth + 1, seen, results);
  return results;
}

function interactionPayloadsFromIpcMessage(message) {
  const payloads = collectInteractionPayloads(message);
  const seen = new Set();
  const unique = payloads.filter((payload) => {
    const key = `${interactionRequestId(payload) || ""}:${payload?.method || payload?.type || payload?.name || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const bestPriority = Math.min(...unique.map(interactionPayloadPriority));
  return unique
    .filter((payload) => interactionPayloadPriority(payload) === bestPriority || bestPriority > 1)
    .sort((a, b) => interactionPayloadPriority(a) - interactionPayloadPriority(b));
}

function interactionPayloadPriority(payload) {
  const method = String(payload?.method || payload?.type || payload?.name || payload?.kind || "").toLowerCase();
  if (method.includes("requestapproval")) return 0;
  if (method.includes("approval") || method.includes("permission")) return 1;
  return 2;
}

function messageFromInteractionEvent(timestamp, payload, meta = {}) {
  if (!isInteractionPayload(payload)) return null;
  const approvalKind = approvalKindFromPayload(payload);
  return {
    role: "interaction",
    kind: payload?.type || payload?.method || payload?.name || "interaction",
    timestamp,
    ...meta,
    title: interactionTitle(payload),
    requestId: interactionRequestId(payload),
    approvalKind,
    canApprove: Boolean(approvalKind),
    content: interactionContent(payload),
    requiresDesktopAction: true
  };
}

function normalizeApprovalCommandForKey(command) {
  const text = String(command || "").trim();
  const shellMatch = text.match(/^\/bin\/(?:zsh|bash|sh)\s+-lc\s+["']([\s\S]+)["']$/);
  if (!shellMatch) return text.replace(/\s+/g, " ");
  return shellMatch[1].replace(/\\"/g, "\"").replace(/\\'/g, "'").replace(/\s+/g, " ").trim();
}

function interactionContentField(content, label) {
  const match = String(content || "").match(new RegExp(`(?:^|\\n)${label}:\\s*([^\\n]+)`, "i"));
  return match?.[1]?.trim() || "";
}

function interactionDedupeKey(message) {
  if (message?.role !== "interaction") return "";
  const prompt = interactionContentField(message.content, "Prompt");
  const command = normalizeApprovalCommandForKey(interactionContentField(message.content, "Command"));
  const workdir = interactionContentField(message.content, "Workdir");
  const pathValue = interactionContentField(message.content, "Path");
  const content = String(message.content || "").replace(/\s+/g, " ").trim();
  return [message.approvalKind || "", prompt || content, command, pathValue, workdir].join("\n");
}

function preferredInteractionMessage(existing, candidate) {
  const existingIsLive = existing?.source === "desktop-ipc";
  const candidateIsLive = candidate?.source === "desktop-ipc";
  const display = String(candidate?.content || "").length < String(existing?.content || "").length ? candidate : existing;
  const live = candidateIsLive ? candidate : existingIsLive ? existing : null;
  if (!live) return display;
  return {
    ...display,
    source: live.source,
    requestId: live.requestId || display.requestId,
    approvalKind: live.approvalKind || display.approvalKind,
    canApprove: live.canApprove || display.canApprove,
    requiresDesktopAction: Boolean(live.requiresDesktopAction || display.requiresDesktopAction),
    lineNumber: Math.min(existing.lineNumber || candidate.lineNumber || 0, candidate.lineNumber || existing.lineNumber || 0),
    timestamp: display.timestamp || live.timestamp
  };
}

function dedupeInteractionMessages(messages) {
  const byKey = new Map();
  const result = [];
  for (const message of messages) {
    const key = interactionDedupeKey(message);
    if (!key) {
      result.push(message);
      continue;
    }
    const existingIndex = byKey.get(key);
    if (existingIndex === undefined) {
      byKey.set(key, result.length);
      result.push(message);
      continue;
    }
    result[existingIndex] = preferredInteractionMessage(result[existingIndex], message);
  }
  return result;
}

function messageSortCompare(a, b) {
  if (a.timestamp && b.timestamp) return String(a.timestamp).localeCompare(String(b.timestamp));
  return (a.lineNumber || 0) - (b.lineNumber || 0);
}

function normalizeMessageLimit(value) {
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_MESSAGE_LIMIT;
  return Math.min(MAX_MESSAGE_LIMIT, Math.max(20, Math.floor(limit)));
}

function isImportantNoticeMessage(message) {
  if (message?.kind === "error") return true;
  const text = [message?.kind, message?.title, message?.content].filter(Boolean).join(" ").toLowerCase();
  return /\b(error|failed?|limit|quota|rate_limit|usage_limit|plan_limit)\b/.test(text);
}

function shouldAlwaysReturnMessage(message, status = {}) {
  if (!message) return false;
  if (message.requiresDesktopAction) return true;
  if (message.role === "interaction") return Boolean(status.interactionRequired && message.source === "desktop-ipc" && message.canApprove);
  if (message.role === "notice") return isImportantNoticeMessage(message);
  return false;
}

function isLowPriorityHiddenByDefaultMessage(message) {
  if (!message) return false;
  if (message.role === "tool") return true;
  if (message.role === "notice" && !isImportantNoticeMessage(message)) return true;
  return false;
}

function clientMessageKey(message) {
  return [
    message?.id,
    message?.requestId,
    message?.turnId,
    message?.lineNumber,
    message?.role,
    message?.timestamp,
    String(message?.content || "").slice(0, 120)
  ]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .join(":");
}

function limitMessagesForClient(messages, status = {}, limit = DEFAULT_MESSAGE_LIMIT) {
  const normalizedLimit = normalizeMessageLimit(limit);
  const sorted = Array.isArray(messages) ? messages.slice().sort(messageSortCompare) : [];
  const recentLowPriorityKeys = new Set(sorted.slice(-10).filter(isLowPriorityHiddenByDefaultMessage).map(clientMessageKey));
  const visiblePriorityMessages = sorted.filter((message) => !isLowPriorityHiddenByDefaultMessage(message) || recentLowPriorityKeys.has(clientMessageKey(message)));
  const hiddenMessages = Math.max(0, sorted.length - visiblePriorityMessages.length);
  if (visiblePriorityMessages.length <= normalizedLimit) {
    return {
      messages: visiblePriorityMessages,
      totalMessages: sorted.length,
      truncated: false,
      hasOlderMessages: false,
      limit: normalizedLimit,
      omittedMessages: 0,
      hiddenMessages
    };
  }
  const tail = visiblePriorityMessages.slice(-normalizedLimit);
  const includedKeys = new Set(tail.map(clientMessageKey));
  const pinned = visiblePriorityMessages.filter((message) => shouldAlwaysReturnMessage(message, status) && !includedKeys.has(clientMessageKey(message)));
  const limited = [...pinned, ...tail].sort(messageSortCompare);
  return {
    messages: limited,
    totalMessages: sorted.length,
    truncated: true,
    hasOlderMessages: true,
    limit: normalizedLimit,
    omittedMessages: Math.max(0, visiblePriorityMessages.length - limited.length),
    hiddenMessages
  };
}

function includePartialHistoryAvailability(limited, partial = false) {
  const hasOlderMessages = Boolean(partial || limited.hasOlderMessages);
  return {
    ...limited,
    hasOlderMessages,
    truncated: hasOlderMessages
  };
}

const NOTICE_TYPE_PATTERNS = [
  "notice",
  "notification",
  "toast",
  "banner",
  "alert",
  "warning",
  "error",
  "limit",
  "quota",
  "rate_limit",
  "usage_limit",
  "plan_limit"
];

function isNoticePayload(payload) {
  const output = String(payload?.output || "");
  if (payload?.type === "function_call_output" && /Rejected\(|rejected by user|require_escalated/i.test(output)) return true;
  const text = [
    payload?.type,
    payload?.method,
    payload?.name,
    payload?.event,
    payload?.kind,
    payload?.code,
    payload?.errorCode,
    payload?.payload?.type,
    payload?.payload?.code,
    payload?.params?.type,
    payload?.params?.code
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return NOTICE_TYPE_PATTERNS.some((pattern) => text.includes(pattern));
}

function noticeSeverity(payload, fallback = "info") {
  if (payload?.type === "function_call_output" && /Rejected\(|rejected by user/i.test(String(payload?.output || ""))) return "warning";
  const text = [
    fallback,
    payload?.level,
    payload?.severity,
    payload?.type,
    payload?.kind,
    payload?.code,
    payload?.errorCode,
    payload?.resultType,
    payload?.params?.level,
    payload?.payload?.level
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (text.includes("error") || text.includes("fail") || text.includes("limit") || text.includes("quota")) return "error";
  if (text.includes("warn")) return "warning";
  return fallback || "info";
}

function noticeTitle(payload, severity = "info") {
  if (payload?.type === "function_call_output" && /Rejected\(|rejected by user/i.test(String(payload?.output || ""))) return "Approval dismissed";
  const text = [
    payload?.title,
    payload?.params?.title,
    payload?.payload?.title,
    payload?.code,
    payload?.errorCode,
    payload?.type,
    payload?.kind
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (text.includes("limit") || text.includes("quota") || text.includes("rate")) return "Usage limit";
  if (severity === "error") return "Error";
  if (severity === "warning") return "Warning";
  return "Notice";
}

function noticeContent(payload) {
  if (payload?.type === "function_call_output" && payload?.output) return String(payload.output);
  const params = payload?.params || payload?.payload || {};
  const content = firstString(
    payload?.message,
    payload?.error,
    payload?.description,
    payload?.body,
    payload?.text,
    payload?.title,
    params?.message,
    params?.error,
    params?.description,
    params?.body,
    params?.text,
    params?.title
  );
  if (content) return content;
  return compact(redactLargePayloads(payload), 1800);
}

function messageFromNoticeEvent(timestamp, payload, meta = {}) {
  if (!isNoticePayload(payload)) return null;
  const severity = noticeSeverity(payload);
  return {
    role: "notice",
    kind: severity,
    timestamp,
    ...meta,
    title: noticeTitle(payload, severity),
    content: noticeContent(payload)
  };
}

function contextCompactionMessage(timestamp, payload, meta = {}) {
  const item = payload?.item || payload?.payload?.item;
  const isItem = payload?.type === "item_completed" && item?.type === "ContextCompaction";
  const isNotification = payload?.type === "thread/compacted" || payload?.type === "context_compacted";
  if (!isItem && !isNotification) return null;
  return {
    role: "notice",
    kind: "context_compaction",
    timestamp,
    ...meta,
    title: "上下文已压缩",
    content: "Codex 已压缩此前的上下文，后续任务将继续使用新的上下文摘要。"
  };
}

function planMessage(timestamp, payload, meta = {}) {
  const type = String(payload?.type || "").toLowerCase();
  const plan = Array.isArray(payload?.plan) ? payload.plan : Array.isArray(payload?.item?.plan) ? payload.item.plan : null;
  if (!plan && type !== "plan" && type !== "plan_update" && type !== "turn_plan_updated") return null;
  const steps = (plan || []).map((entry) => {
    const step = String(entry?.step || entry?.text || entry || "").trim();
    if (!step) return "";
    const status = String(entry?.status || "pending");
    return `${status === "completed" ? "[x]" : status === "inProgress" ? "[>]" : "[ ]"} ${step}`;
  }).filter(Boolean);
  const content = steps.join("\n") || String(payload?.text || payload?.explanation || "").trim();
  if (!content) return null;
  return {
    role: "notice",
    kind: "plan",
    timestamp,
    ...meta,
    title: "计划",
    content
  };
}

function recordNotice(threadId, { severity = "info", title = "", content = "", source = "server" } = {}) {
  if (!threadId || !content) return null;
  const notice = {
    id: randomUUID(),
    threadId: String(threadId),
    timestamp: new Date().toISOString(),
    role: "notice",
    kind: severity,
    title: title || noticeTitle({ type: severity }, severity),
    content: String(content).trim(),
    source,
    lineNumber: 2000000 + recentNotices.length
  };
  recentNotices.push(notice);
  if (recentNotices.length > 120) recentNotices.splice(0, recentNotices.length - 120);
  return notice;
}

function getRecentNoticeMessages(threadId) {
  const selectedThreadId = String(threadId || "");
  return recentNotices
    .filter((notice) => notice.threadId === selectedThreadId)
    .map((notice, index) => ({ ...notice, lineNumber: notice.lineNumber || 2000000 + index }));
}

function messageFromEvent(timestamp, payload, meta = {}) {
  if (payload?.type === "user_message") {
    return {
      role: "user",
      kind: "message",
      timestamp,
      ...meta,
      content: stripCodexDirectives(payload.message),
      images: Array.isArray(payload.images) ? payload.images : [],
      localImages: Array.isArray(payload.local_images) ? payload.local_images : []
    };
  }
  if (payload?.type === "agent_message") {
    return {
      role: "assistant",
      kind: "message",
      timestamp,
      ...meta,
      phase: payload.phase || "",
      content: stripCodexDirectives(payload.message)
    };
  }
  return null;
}

function messageFromResponseItem(timestamp, payload) {
  if (payload?.type === "function_call" || payload?.type === "custom_tool_call") {
    return {
      role: "tool",
      kind: "tool_call",
      timestamp,
      title: payload.name || "tool_call",
      content: compact(payload.arguments || payload.input || "")
    };
  }
  if (payload?.type === "function_call_output" || payload?.type === "custom_tool_call_output") {
    const images = imagesFromToolOutput(payload.output);
    return {
      role: "tool",
      kind: "tool_output",
      timestamp,
      title: payload.call_id || "tool_output",
      content: compactToolOutput(payload.output || "", images),
      images
    };
  }
  if (payload?.type === "message") {
    return {
      role: payload.role || "assistant",
      kind: "message",
      timestamp,
      content: stripCodexDirectives(textFromContent(payload.content)),
      images: imagesFromContent(payload.content)
    };
  }
  return null;
}

function hasDisplayableMessageContent(message) {
  return Boolean(message?.content || message?.images?.length || message?.localImages?.length);
}

function isTurnEndEvent(payload) {
  return payload?.type === "task_complete" || payload?.type === "turn_aborted";
}

function repairInvalidCustomToolCallIdsInText(text) {
  const source = String(text || "");
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const hadTrailingNewline = source.endsWith("\n");
  const replacements = [];
  const lines = source.split(/\r?\n/);
  if (hadTrailingNewline) lines.pop();
  const repairedLines = lines.map((line, index) => {
    if (!line.includes('"type":"custom_tool_call"') || !line.includes('"id":"fc_')) return line;
    try {
      const entry = JSON.parse(line);
      const payload = entry?.type === "response_item" ? entry.payload : null;
      if (payload?.type !== "custom_tool_call" || typeof payload.id !== "string" || !payload.id.startsWith("fc_")) return line;
      const previousId = payload.id;
      payload.id = `ctc_${previousId.slice(3)}`;
      replacements.push({ lineNumber: index + 1, previousId, repairedId: payload.id, callId: payload.call_id || null });
      return JSON.stringify(entry);
    } catch {
      return line;
    }
  });
  return {
    text: `${repairedLines.join(newline)}${hadTrailingNewline ? newline : ""}`,
    replacements
  };
}

async function repairInvalidCustomToolCallIds(threadId) {
  const thread = await findThread(threadId);
  const filePath = resolveRolloutPath(thread?.rolloutPath);
  if (!filePath || !existsSync(filePath)) return { repaired: 0, filePath: null, backupPath: null };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = await fs.stat(filePath);
    const source = await fs.readFile(filePath, "utf8");
    const result = repairInvalidCustomToolCallIdsInText(source);
    if (!result.replacements.length) return { repaired: 0, filePath, backupPath: null };
    const afterRead = await fs.stat(filePath);
    if (afterRead.size !== before.size || afterRead.mtimeMs !== before.mtimeMs) {
      if (attempt === 0) continue;
      const err = new Error("Conversation history changed while it was being checked. Wait for the current task to finish, then try again.");
      err.status = 409;
      throw err;
    }

    const repairDir = path.join(codexHomeState.home, ".codex-lan-companion", SESSION_REPAIR_DIR_NAME);
    await fs.mkdir(repairDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(repairDir, `${threadId}-${stamp}.jsonl.bak`);
    const temporaryPath = `${filePath}.ccpocket-${randomUUID()}.tmp`;
    await fs.copyFile(filePath, backupPath);
    try {
      await fs.writeFile(temporaryPath, result.text, "utf8");
      const beforeReplace = await fs.stat(filePath);
      if (beforeReplace.size !== before.size || beforeReplace.mtimeMs !== before.mtimeMs) {
        const err = new Error("Conversation history changed before the repair could be applied. Try again after the current task finishes.");
        err.status = 409;
        throw err;
      }
      try {
        await fs.rename(temporaryPath, filePath);
      } catch (error) {
        if (process.platform !== "win32" || !["EPERM", "EBUSY", "EACCES"].includes(error?.code)) throw error;
        const handle = await fs.open(filePath, "r+");
        try {
          const data = Buffer.from(result.text, "utf8");
          await handle.write(data, 0, data.length, 0);
          await handle.truncate(data.length);
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => {});
    }
    messageCache.delete(filePath);
    clearThreadsCache();
    return { repaired: result.replacements.length, filePath, backupPath, replacements: result.replacements };
  }
  return { repaired: 0, filePath, backupPath: null };
}

function createRolloutParseState(stat, nowMs) {
  return {
    eventMessages: [],
    fallbackMessages: [],
    toolMessages: [],
    interactionMessages: [],
    noticeMessages: [],
    meta: {},
    lineNumber: 0,
    activeTurn: null,
    openTurns: new Map(),
    lastEntryAtMs: Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : nowMs,
    latestCompletedAtMs: 0,
    assistantMessagesByTurn: new Map()
  };
}

function observeTurnFromPayload(payload, timestamp, state) {
  const turnId = payload?.turn_id || payload?.turnId || payload?.internal_chat_message_metadata_passthrough?.turn_id || null;
  if (!turnId || state.activeTurn) return;
  if (state.openTurns.has(turnId)) {
    state.activeTurn = state.openTurns.get(turnId);
    return;
  }
  const itemStartedAtMs = Number(payload?.started_at_ms);
  const createTimeMs = Number(payload?.internal_chat_message_metadata_passthrough?.create_time) * 1000;
  const startedAtMs = Number.isFinite(itemStartedAtMs)
    ? itemStartedAtMs
    : Number.isFinite(createTimeMs)
      ? createTimeMs
      : Date.parse(timestamp);
  const turn = { turnId, startedAtMs };
  state.openTurns.set(turnId, turn);
  state.activeTurn = turn;
}

function parseRolloutLine(line, state) {
  state.lineNumber += 1;
  if (!line.trim()) return;
  try {
    const entry = JSON.parse(line);
    const entryAtMs = Date.parse(entry.timestamp);
    if (Number.isFinite(entryAtMs)) state.lastEntryAtMs = entryAtMs;
    if (entry.type === "session_meta") {
      state.meta = { ...state.meta, ...(entry.payload || {}) };
      return;
    }
    if (entry.type === "event_msg") {
      if (entry.payload?.type === "task_started") {
        const turn = {
          turnId: entry.payload.turn_id || null,
          startedAtMs: Number(entry.payload.started_at) ? Number(entry.payload.started_at) * 1000 : Date.parse(entry.timestamp)
        };
        state.activeTurn = turn;
        if (turn.turnId) state.openTurns.set(turn.turnId, turn);
        return;
      }
      if (isTurnEndEvent(entry.payload)) {
        const turnId = entry.payload.turn_id || state.activeTurn?.turnId || null;
        const durationMs = Number(entry.payload.duration_ms);
        const completedAtMs = Number(entry.payload.completed_at) ? Number(entry.payload.completed_at) * 1000 : Date.parse(entry.timestamp);
        if (Number.isFinite(completedAtMs)) state.latestCompletedAtMs = Math.max(state.latestCompletedAtMs || 0, completedAtMs);
        if (turnId && state.assistantMessagesByTurn.has(turnId)) {
          const message = state.assistantMessagesByTurn.get(turnId);
          if (Number.isFinite(durationMs)) message.durationMs = durationMs;
          if (Number.isFinite(completedAtMs)) message.completedAtMs = completedAtMs;
        }
        if (turnId) state.openTurns.delete(turnId);
        if (turnId && state.activeTurn?.turnId === turnId) state.activeTurn = null;
        if (entry.payload?.error) {
          state.noticeMessages.push({
            role: "notice",
            kind: "error",
            timestamp: entry.timestamp,
            turnId,
            title: "Task failed",
            content: firstString(entry.payload.error?.message, entry.payload.error?.error?.message) || compact(entry.payload.error, 1800),
            lineNumber: state.lineNumber
          });
        }
        return;
      }
      observeTurnFromPayload(entry.payload, entry.timestamp, state);
      const messageMeta = {
        turnId: state.activeTurn?.turnId || null,
        turnStartedAtMs: state.activeTurn?.startedAtMs || null
      };
      const compaction = contextCompactionMessage(entry.timestamp, entry.payload, messageMeta);
      if (hasDisplayableMessageContent(compaction)) {
        state.noticeMessages.push({ ...compaction, lineNumber: state.lineNumber });
        return;
      }
      const plan = planMessage(entry.timestamp, entry.payload, messageMeta);
      if (hasDisplayableMessageContent(plan)) {
        state.noticeMessages.push({ ...plan, lineNumber: state.lineNumber });
        return;
      }
      const interaction = messageFromInteractionEvent(entry.timestamp, entry.payload, messageMeta);
      if (hasDisplayableMessageContent(interaction)) {
        state.interactionMessages.push({ ...interaction, lineNumber: state.lineNumber });
        return;
      }
      const notice = messageFromNoticeEvent(entry.timestamp, entry.payload, messageMeta);
      if (hasDisplayableMessageContent(notice)) {
        state.noticeMessages.push({ ...notice, lineNumber: state.lineNumber });
        return;
      }
      const msg = messageFromEvent(entry.timestamp, entry.payload, messageMeta);
      if (hasDisplayableMessageContent(msg)) {
        const message = { ...msg, lineNumber: state.lineNumber };
        state.eventMessages.push(message);
        if (message.role === "assistant" && message.turnId) state.assistantMessagesByTurn.set(message.turnId, message);
      }
      return;
    }
    if (entry.type === "response_item") {
      observeTurnFromPayload(entry.payload, entry.timestamp, state);
      const messageMeta = {
        turnId: state.activeTurn?.turnId || null,
        turnStartedAtMs: state.activeTurn?.startedAtMs || null
      };
      const compaction = contextCompactionMessage(entry.timestamp, entry.payload, messageMeta);
      if (hasDisplayableMessageContent(compaction)) {
        state.noticeMessages.push({ ...compaction, lineNumber: state.lineNumber });
        return;
      }
      const plan = planMessage(entry.timestamp, entry.payload, messageMeta);
      if (hasDisplayableMessageContent(plan)) {
        state.noticeMessages.push({ ...plan, lineNumber: state.lineNumber });
        return;
      }
      const interaction = messageFromInteractionEvent(entry.timestamp, entry.payload, messageMeta);
      if (hasDisplayableMessageContent(interaction)) {
        state.interactionMessages.push({ ...interaction, lineNumber: state.lineNumber });
        return;
      }
      const notice = messageFromNoticeEvent(entry.timestamp, entry.payload);
      if (hasDisplayableMessageContent(notice)) {
        state.noticeMessages.push({ ...notice, lineNumber: state.lineNumber });
        return;
      }
      const msg = messageFromResponseItem(entry.timestamp, entry.payload);
      if (!hasDisplayableMessageContent(msg)) return;
      if (msg.role === "tool") state.toolMessages.push({ ...msg, lineNumber: state.lineNumber });
      else state.fallbackMessages.push({ ...msg, lineNumber: state.lineNumber });
    }
  } catch {
    state.fallbackMessages.push({
      role: "system",
      kind: "parse_error",
      timestamp: null,
      lineNumber: state.lineNumber,
      content: `Could not parse JSONL line ${state.lineNumber}`
    });
  }
}

function rolloutResultFromState({ filePath, stat, nowMs, state, partial = false }) {
  const chatMessages = state.eventMessages.length ? state.eventMessages : state.fallbackMessages;
  if (partial) {
    const recentOpenTurn = [...state.openTurns.values()].at(-1) || null;
    // A tool call can run for minutes without appending to the rollout. The
    // explicit end event, rather than a short quiet period, closes the turn.
    state.activeTurn = recentOpenTurn;
  }
  const activeTurnLastUpdatedAtMs = state.activeTurn
    ? Math.max(state.activeTurn.startedAtMs || 0, state.lastEntryAtMs || 0, Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : 0)
    : null;
  const activeTurnStale = Boolean(state.activeTurn && nowMs - activeTurnLastUpdatedAtMs > ACTIVE_TURN_STALE_MS);
  const visibleActiveTurn = activeTurnStale ? null : state.activeTurn;
  for (const message of state.interactionMessages) {
    message.requiresDesktopAction = Boolean(visibleActiveTurn && (!message.turnId || message.turnId === visibleActiveTurn.turnId));
  }
  const pendingInteractions = state.interactionMessages.filter((message) => message.requiresDesktopAction);
  const activeTurnWaitMs = visibleActiveTurn?.startedAtMs ? nowMs - visibleActiveTurn.startedAtMs : 0;
  return {
    meta: state.meta,
    file: filePath,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    partial,
    status: {
      thinking: Boolean(visibleActiveTurn),
      turnId: visibleActiveTurn?.turnId || null,
      startedAtMs: visibleActiveTurn?.startedAtMs || null,
      interactionRequired: pendingInteractions.length > 0,
      possibleDesktopAttention: Boolean(visibleActiveTurn && pendingInteractions.length === 0 && activeTurnWaitMs > 45_000),
      latestCompletedAtMs: state.latestCompletedAtMs || 0,
      staleTurn: activeTurnStale,
      staleTurnId: activeTurnStale ? state.activeTurn?.turnId || null : null,
      staleTurnLastUpdatedAtMs: activeTurnStale ? activeTurnLastUpdatedAtMs : null
    },
    messages: dedupeInteractionMessages([...chatMessages, ...pendingInteractions, ...state.noticeMessages, ...state.toolMessages]).sort(messageSortCompare)
  };
}

async function readRolloutTailLines(filePath, stat, limit) {
  const bytes = Math.min(TAIL_ROLLOUT_MAX_BYTES, Math.max(TAIL_ROLLOUT_MIN_BYTES, normalizeMessageLimit(limit) * 24 * 1024));
  const start = Math.max(0, stat.size - bytes);
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(stat.size - start);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    let text = buffer.subarray(0, bytesRead).toString("utf8");
    if (start > 0) {
      const firstNewline = text.indexOf("\n");
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : "";
    }
    return text.split(/\r?\n/).filter((line) => line.trim());
  } finally {
    await handle.close();
  }
}

async function parseRolloutTail(filePath, stat, limit, nowMs) {
  const state = createRolloutParseState(stat, nowMs);
  const lines = await readRolloutTailLines(filePath, stat, limit);
  for (const line of lines) parseRolloutLine(line, state);
  return rolloutResultFromState({ filePath, stat, nowMs, state, partial: true });
}

async function parseRollout(filePath, { limit = DEFAULT_MESSAGE_LIMIT, preferTail = false } = {}) {
  const stat = await fs.stat(filePath);
  const signature = `${stat.size}:${stat.mtimeMs}:${preferTail ? normalizeMessageLimit(limit) : "full"}`;
  const cached = messageCache.get(filePath);
  const nowMs = Date.now();
  const cachedAgeMs = nowMs - (cached?.cachedAtMs || 0);
  if (cached?.signature === signature && (!cached.result?.status?.thinking || cachedAgeMs < ACTIVE_STATUS_CACHE_MS)) return cached.result;

  if (preferTail && stat.size > TAIL_ROLLOUT_MAX_BYTES) {
    const result = await parseRolloutTail(filePath, stat, limit, nowMs);
    messageCache.set(filePath, { signature, result, cachedAtMs: nowMs });
    return result;
  }

  const state = createRolloutParseState(stat, nowMs);
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    parseRolloutLine(line, state);
  }

  const result = rolloutResultFromState({ filePath, stat, nowMs, state, partial: false });

  messageCache.set(filePath, { signature, result, cachedAtMs: nowMs });
  return result;
}

async function getMessages(id, { limit = DEFAULT_MESSAGE_LIMIT, fullHistory = false } = {}) {
  keepIpcWarm();
  const thread = await findThread(id);
  if (!thread) {
    const err = new Error("Thread not found");
    err.status = 404;
    throw err;
  }
  const ipcInteractions = codexIpcClient?.getRecentInteractionMessages(id) || [];
  const ipcNotices = codexIpcClient?.getRecentNoticeMessages(id) || [];
  const goal = await getThreadGoalSafe(id);
  const serverNotices = getRecentNoticeMessages(id);
  const liveMessages = [...ipcInteractions, ...ipcNotices, ...serverNotices];
  const rolloutPath = resolveRolloutPath(thread.rolloutPath);
  if (!rolloutPath || !existsSync(rolloutPath)) {
    const messages = await decorateMessageFiles(dedupeInteractionMessages(liveMessages).sort(messageSortCompare), id, thread);
    const limited = limitMessagesForClient(messages, { thinking: false, interactionRequired: ipcInteractions.some((message) => message.requiresDesktopAction) }, limit);
    return finalizeMessagesResponse(id, {
      thread,
      goal,
      meta: {},
      file: null,
      size: 0,
      mtimeMs: 0,
      status: {
        thinking: false,
        turnId: null,
        startedAtMs: null,
        interactionRequired: ipcInteractions.some((message) => message.requiresDesktopAction),
        possibleDesktopAttention: false
      },
      ...limited
    });
  }
  const parsed = await parseRollout(rolloutPath, { limit, preferTail: !fullHistory });
  if (!liveMessages.length) {
    const messages = await decorateMessageFiles(parsed.messages, id, thread);
    const limited = limitMessagesForClient(messages, parsed.status, limit);
    return finalizeMessagesResponse(id, { thread, goal, ...parsed, messages, ...includePartialHistoryAvailability(limited, parsed.partial) });
  }
  const status = {
    ...parsed.status,
    interactionRequired: parsed.status?.interactionRequired || ipcInteractions.some((message) => message.requiresDesktopAction)
  };
  const messages = await decorateMessageFiles(dedupeInteractionMessages([...parsed.messages, ...liveMessages]).sort(messageSortCompare), id, thread);
  const limited = limitMessagesForClient(messages, status, limit);
  return finalizeMessagesResponse(id, {
    thread,
    goal,
    ...parsed,
    status,
    ...includePartialHistoryAvailability(limited, parsed.partial)
  });
}

async function getThreadGoalSafe(threadId) {
  const id = String(threadId || "").trim();
  try {
    const ipcGoal = sanitizeThreadGoal(await getCodexIpcClient().getThreadGoal(id));
    if (ipcGoal) return ipcGoal;
  } catch (error) {
    logInfo(`[goal:read] IPC unavailable for ${id}; reading Desktop goal store.`);
  }
  try {
    const { goalsDb } = codexPaths((await refreshCodexHomeContext()).home);
    if (!existsSync(goalsDb)) return null;
    const rows = await runSqlJsonFromDb(goalsDb, `
      SELECT thread_id AS threadId, objective, status,
             created_at_ms AS createdAt, updated_at_ms AS updatedAt
      FROM thread_goals
      WHERE thread_id = '${sqlString(id)}'
      LIMIT 1;
    `);
    return sanitizeThreadGoal(rows[0] || null);
  } catch (error) {
    logError(`[goal:read] ${id}: ${error?.message || error}`);
    return null;
  }
}

function sanitizeThreadGoal(goal) {
  if (!goal || typeof goal !== "object" || !String(goal.objective || "").trim()) return null;
  const statusMap = {
    usage_limited: "usageLimited",
    budget_limited: "budgetLimited"
  };
  const rawStatus = String(goal.status || "active");
  return {
    threadId: String(goal.threadId || ""),
    objective: String(goal.objective).trim(),
    status: statusMap[rawStatus] || rawStatus,
    createdAt: Number.isFinite(Number(goal.createdAt)) ? Number(goal.createdAt) : null,
    updatedAt: Number.isFinite(Number(goal.updatedAt)) ? Number(goal.updatedAt) : null
  };
}

async function setThreadGoal(threadId, body = {}) {
  const objective = body.objective == null ? null : String(body.objective).trim();
  if (objective !== null && objective.length > 4000) {
    const error = new Error("Goal objective is too long");
    error.status = 413;
    throw error;
  }
  const status = body.status == null || body.status === "" ? null : String(body.status);
  const allowedStatuses = new Set(["active", "paused", "blocked", "usageLimited", "budgetLimited", "complete"]);
  if (status && !allowedStatuses.has(status)) {
    const error = new Error("Invalid goal status");
    error.status = 400;
    throw error;
  }
  if (!(await findThread(threadId))) {
    const error = new Error("Thread not found");
    error.status = 404;
    throw error;
  }
  return sanitizeThreadGoal(await getCodexIpcClient().setThreadGoal(String(threadId), { objective: objective || null, status }));
}

async function clearThreadGoal(threadId) {
  if (!(await findThread(threadId))) {
    const error = new Error("Thread not found");
    error.status = 404;
    throw error;
  }
  await getCodexIpcClient().clearThreadGoal(String(threadId));
  return { goal: null, cleared: true };
}

async function compactThread(threadId) {
  if (!(await findThread(threadId))) {
    const error = new Error("Thread not found");
    error.status = 404;
    throw error;
  }
  await getCodexIpcClient().compactThread(String(threadId));
  return { ok: true, threadId: String(threadId) };
}

function desktopTurnInput(text, images = []) {
  const input = [];
  if (text) input.push({ type: "text", text, text_elements: [] });
  for (const image of images) {
    input.push({
      type: "image",
      url: `data:${image.mimeType};base64,${image.data}`
    });
  }
  return input;
}

function normalizeTurnSettings({ model, effort } = {}) {
  const selectedModel = CODEX_MODELS.find((entry) => entry.id === String(model || "").trim()) ||
    CODEX_MODELS.find((entry) => entry.id === DEFAULT_CODEX_MODEL) || CODEX_MODELS[0];
  const selectedEffort = selectedModel.efforts.includes(String(effort || "").trim())
    ? String(effort).trim()
    : selectedModel.efforts.includes(DEFAULT_CODEX_EFFORT)
      ? DEFAULT_CODEX_EFFORT
      : selectedModel.efforts[0];
  return { model: selectedModel.id, effort: selectedEffort };
}

function desktopStartTurnRequest(threadId, text, images = [], turnSettings = {}) {
  const { model, effort } = normalizeTurnSettings(turnSettings);
  return {
    method: "thread-follower-start-turn",
    params: {
      conversationId: threadId,
      hostId: "local",
      turnStart: {
        request: {
          threadId,
          model,
          effort,
          input: desktopTurnInput(text, images)
        },
        context: {
          localTurnMetadata: { fileAttachmentCount: 0 },
          attachments: [],
          commentAttachments: [],
          mcpAppModelContextAttachments: [],
          useAppServerPermissionDefault: true,
          usePermissionSelection: false,
          inheritThreadSettings: false
        }
      }
    }
  };
}

function ipcVersionForMethod(method) {
  return IPC_VERSION_BY_METHOD[method] ?? 0;
}

function ipcVersionForRequest(method, params = {}) {
  if (method === "thread-follower-interrupt-turn") {
    return typeof params.expectedTurnId === "string" && params.expectedTurnId ? 4 : 3;
  }
  return ipcVersionForMethod(method);
}

function desktopInterruptTurnRequest(threadId, expectedTurnId = null) {
  const params = {
    conversationId: threadId,
    mode: "user-stop"
  };
  if (typeof expectedTurnId === "string" && expectedTurnId) params.expectedTurnId = expectedTurnId;
  return { method: "thread-follower-interrupt-turn", params };
}

function desktopSteerRestoreMessage(text, cwd, clientUserMessageId = randomUUID()) {
  const resolvedCwd = String(cwd || process.cwd());
  return {
    id: clientUserMessageId,
    text: String(text || ""),
    context: {
      prompt: String(text || ""),
      addedFiles: [],
      fileAttachments: [],
      ideContext: null,
      imageAttachments: [],
      commentAttachments: [],
      workspaceRoots: [resolvedCwd],
      collaborationMode: null
    },
    cwd: resolvedCwd,
    createdAt: Date.now(),
    responsesapiClientMetadata: {}
  };
}

function queuedSendStatus(threadId) {
  const queue = pendingSendQueues.get(String(threadId || "")) || [];
  return {
    queueLength: queue.length,
    queuedMessages: queue.map((item) => ({
      id: item.id,
      text: item.text,
      preview: item.text.slice(0, 160),
      imageCount: item.images.length,
      enqueuedAt: item.enqueuedAt,
      lastError: item.lastError || null
    }))
  };
}

function finalizeMessagesResponse(threadId, response) {
  const queueStatus = queuedSendStatus(threadId);
  const result = {
    ...response,
    status: {
      ...(response.status || {}),
      ...queueStatus
    }
  };
  if (!result.status.thinking && queueStatus.queueLength) scheduleQueuedSendDrain(threadId);
  return result;
}

function enqueueSend(threadId, text, images, turnSettings) {
  const key = String(threadId);
  const queue = pendingSendQueues.get(key) || [];
  queueIdleObservations.delete(key);
  const item = {
    id: randomUUID(),
    text,
    images,
    turnSettings,
    enqueuedAt: new Date().toISOString(),
    lastError: null,
    nextAttemptAtMs: 0
  };
  queue.push(item);
  pendingSendQueues.set(key, queue);
  scheduleQueuedSendDrain(key);
  return {
    ok: true,
    mode: "queue",
    queued: true,
    threadId: key,
    queueItem: queuedSendStatus(key).queuedMessages.find((entry) => entry.id === item.id),
    queueLength: queue.length,
    sentAt: item.enqueuedAt
  };
}

function cancelQueuedSend(threadId, itemId = "") {
  const key = String(threadId || "");
  const queue = pendingSendQueues.get(key) || [];
  if (!queue.length) return { ok: true, threadId: key, cancelled: 0, ...queuedSendStatus(key) };
  const remaining = itemId ? queue.filter((item) => item.id !== itemId) : [];
  const cancelled = queue.length - remaining.length;
  if (remaining.length) pendingSendQueues.set(key, remaining);
  else {
    pendingSendQueues.delete(key);
    queueIdleObservations.delete(key);
    const timer = queuedSendDrainTimers.get(key);
    if (timer) clearTimeout(timer);
    queuedSendDrainTimers.delete(key);
  }
  return { ok: true, threadId: key, cancelled, ...queuedSendStatus(key) };
}

function sendRequestFingerprint(body = {}) {
  return JSON.stringify({
    threadId: body.threadId || null,
    newThread: Boolean(body.newThread),
    mode: body.mode || "start",
    model: body.model || null,
    effort: body.effort || null,
    message: body.message || "",
    images: Array.isArray(body.images)
      ? body.images.map((image) => ({ name: image?.name || "", mimeType: image?.mimeType || "", data: image?.data || "" }))
      : []
  });
}

function runIdempotentSend(requestId, fingerprint, execute, store = recentSendRequests) {
  const key = String(requestId || "").trim();
  if (!key) return Promise.resolve().then(execute);
  const existing = store.get(key);
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      const err = new Error("This send request ID was already used for a different message.");
      err.status = 409;
      return Promise.reject(err);
    }
    return existing.promise;
  }
  const promise = Promise.resolve().then(execute);
  store.set(key, { fingerprint, promise });
  const timer = setTimeout(() => store.delete(key), 5 * 60 * 1000);
  timer.unref?.();
  return promise;
}

function runSerializedThreadStart(threadId, execute, store = threadStartOperations) {
  const key = String(threadId || "");
  const previous = store.get(key) || Promise.resolve();
  const operation = previous.catch(() => {}).then(execute);
  store.set(key, operation);
  operation
    .finally(() => {
      if (store.get(key) === operation) store.delete(key);
    })
    .catch(() => {});
  return operation;
}

function scheduleQueuedSendDrain(threadId, delayMs = 250) {
  const key = String(threadId || "");
  if (!key || drainingSendQueues.has(key) || queuedSendDrainTimers.has(key)) return;
  const timer = setTimeout(() => {
    queuedSendDrainTimers.delete(key);
    void drainQueuedSend(key);
  }, delayMs);
  queuedSendDrainTimers.set(key, timer);
  timer.unref?.();
}

function queuedSendIdleDecision(thinking, idleSinceMs, nowMs = Date.now(), settleMs = QUEUE_IDLE_SETTLE_MS) {
  if (thinking) return { ready: false, idleSinceMs: null, retryAfterMs: null };
  const observedIdleSinceMs = Number.isFinite(idleSinceMs) ? idleSinceMs : nowMs;
  const elapsedMs = Math.max(0, nowMs - observedIdleSinceMs);
  return {
    ready: elapsedMs >= settleMs,
    idleSinceMs: observedIdleSinceMs,
    retryAfterMs: Math.max(0, settleMs - elapsedMs)
  };
}

async function drainQueuedSend(threadId) {
  const key = String(threadId || "");
  if (!key || drainingSendQueues.has(key)) return;
  const queue = pendingSendQueues.get(key);
  if (!queue?.length) return;
  drainingSendQueues.add(key);
  try {
    const item = queue[0];
    if (item.nextAttemptAtMs > Date.now()) return;
    const current = await getMessages(key, { limit: 20, fullHistory: true });
    const idleDecision = queuedSendIdleDecision(
      Boolean(current.status?.thinking),
      queueIdleObservations.get(key),
      Date.now()
    );
    if (current.status?.thinking) {
      queueIdleObservations.delete(key);
      return;
    }
    queueIdleObservations.set(key, idleDecision.idleSinceMs);
    if (!idleDecision.ready) {
      scheduleQueuedSendDrain(key, idleDecision.retryAfterMs);
      return;
    }
    queueIdleObservations.delete(key);
    try {
      await sendToCodex(item.text, key, item.images, { mode: "start", ...item.turnSettings });
      queue.shift();
      if (queue.length) pendingSendQueues.set(key, queue);
      else pendingSendQueues.delete(key);
      recordNotice(key, {
        severity: "info",
        title: "Queued message sent",
        content: "The next queued message was sent after the previous task finished.",
        source: "queue"
      });
    } catch (error) {
      if (error?.status === 409 && /still running/i.test(error?.message || "")) return;
      item.lastError = error?.message || "Queued send failed";
      item.nextAttemptAtMs = Date.now() + 30_000;
      recordNotice(key, {
        severity: "error",
        title: "Queued send failed",
        content: item.lastError,
        source: "queue"
      });
    }
  } finally {
    drainingSendQueues.delete(key);
    const remaining = pendingSendQueues.get(key);
    if (remaining?.length) {
      const retryDelayMs = Math.max(1500, (remaining[0].nextAttemptAtMs || 0) - Date.now());
      scheduleQueuedSendDrain(key, retryDelayMs);
    }
  }
}

function normalizeSendImages(images) {
  if (!Array.isArray(images)) return [];
  if (images.length > MAX_SEND_IMAGES) {
    const err = new Error(`Too many images. Maximum is ${MAX_SEND_IMAGES}.`);
    err.status = 400;
    throw err;
  }
  return images.map((image, index) => {
    const mimeType = String(image?.mimeType || "").trim().toLowerCase();
    const data = String(image?.data || "").replace(/^data:[^;]+;base64,/, "");
    const name = String(image?.name || `image-${index + 1}`).slice(0, 120);
    if (!SUPPORTED_SEND_IMAGE_MIME_TYPES.has(mimeType)) {
      const err = new Error("Unsupported image format. Use JPEG, PNG, or WebP.");
      err.status = 400;
      throw err;
    }
    if (!data || data.length % 4 !== 0 || !/^[a-zA-Z0-9+/]+={0,2}$/.test(data)) {
      const err = new Error("Invalid image data");
      err.status = 400;
      throw err;
    }
    const bytes = Buffer.from(data, "base64");
    const validation = validateSendImageBytes(bytes, mimeType);
    if (bytes.byteLength > MAX_SEND_IMAGE_BYTES) {
      const err = new Error(`Image is too large. Maximum is ${Math.round(MAX_SEND_IMAGE_BYTES / 1024 / 1024)} MB.`);
      err.status = 400;
      throw err;
    }
    return { name, mimeType, data, size: bytes.byteLength, width: validation.width, height: validation.height };
  });
}

function invalidImage(message = "Invalid image data") {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function validateSendImageBytes(bytes, mimeType) {
  if (!Buffer.isBuffer(bytes) || bytes.byteLength < MIN_SEND_IMAGE_BYTES) {
    throw invalidImage("Invalid image: image data is too small.");
  }
  const dimensions =
    mimeType === "image/jpeg"
      ? jpegDimensions(bytes)
      : mimeType === "image/png"
        ? pngDimensions(bytes)
        : mimeType === "image/webp"
          ? webpDimensions(bytes)
          : null;
  if (!dimensions) {
    throw invalidImage("Invalid image: file content does not match its image type.");
  }
  const { width, height } = dimensions;
  const pixels = width * height;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < MIN_SEND_IMAGE_EDGE ||
    height < MIN_SEND_IMAGE_EDGE ||
    width > MAX_SEND_IMAGE_EDGE ||
    height > MAX_SEND_IMAGE_EDGE ||
    pixels > MAX_SEND_IMAGE_PIXELS
  ) {
    throw invalidImage(
      `Invalid image: dimensions must be ${MIN_SEND_IMAGE_EDGE}-${MAX_SEND_IMAGE_EDGE}px per side and under ${Math.round(MAX_SEND_IMAGE_PIXELS / 1_000_000)}MP.`
    );
  }
  return dimensions;
}

function pngDimensions(bytes) {
  const signature = "89504e470d0a1a0a";
  if (bytes.byteLength < 33 || bytes.subarray(0, 8).toString("hex") !== signature) return null;
  if (bytes.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return { width, height };
}

function jpegDimensions(bytes) {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) return null;
    let marker = bytes[offset + 1];
    while (marker === 0xff) {
      offset += 1;
      marker = bytes[offset + 1];
    }
    offset += 2;
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 2 > bytes.byteLength) return null;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) return null;
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (segmentLength < 7) return null;
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      return { width, height };
    }
    offset += segmentLength;
  }
  return null;
}

function webpDimensions(bytes) {
  if (bytes.byteLength < 30 || bytes.subarray(0, 4).toString("ascii") !== "RIFF" || bytes.subarray(8, 12).toString("ascii") !== "WEBP") {
    return null;
  }
  const chunk = bytes.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X" && bytes.byteLength >= 30) {
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3)
    };
  }
  if (chunk === "VP8 " && bytes.byteLength >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff
    };
  }
  if (chunk === "VP8L" && bytes.byteLength >= 25 && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1
    };
  }
  return null;
}

async function sendToCodex(text, threadId, images = [], { newThread = false, mode = "start", model, effort } = {}) {
  await refreshCodexHomeContext({ source: "send" });
  if (!ALLOW_WRITE) {
    const err = new Error("Read-only mode is enabled. Restart without --readonly to send messages to Codex Desktop.");
    err.status = 403;
    throw err;
  }
  const trimmed = String(text || "").trim();
  const normalizedImages = normalizeSendImages(images);
  const turnSettings = normalizeTurnSettings({ model, effort });
  const sendMode = newThread ? "start" : String(mode || "start").toLowerCase();
  if (!["start", "queue", "steer"].includes(sendMode)) {
    const err = new Error("Invalid send mode. Use start, queue, or steer.");
    err.status = 400;
    throw err;
  }
  if (!trimmed && !normalizedImages.length) {
    const err = new Error("Message is empty");
    err.status = 400;
    throw err;
  }
  if (trimmed.length > 12000) {
    const err = new Error("Message is too long");
    err.status = 400;
    throw err;
  }
  if (newThread) {
    if (normalizedImages.length) {
      const err = new Error("Starting a new Codex conversation with images from the web is not supported yet. Create the conversation with text first, then send images in the new thread.");
      err.status = 409;
      throw err;
    }
    const result = await startNewCodexThread(trimmed, turnSettings);
    if (result.threadId) {
      await notifyCodexDesktopThreadCreated(result.threadId);
    }
    return {
      ok: true,
      mode: result.source || "desktop-ipc",
      threadId: result.threadId,
      images: [],
      turnId: result.turnId,
      fallbackReason: result.fallbackReason || null,
      sent: true,
      sentAt: new Date().toISOString()
    };
  }

  const targetThreadId = threadId || (await getThreads())[0]?.id;
  if (!targetThreadId) {
    const err = new Error("No target thread selected");
    err.status = 400;
    throw err;
  }
  const targetThread = await findThread(targetThreadId);
  if (!targetThread) {
    const err = new Error("Thread not found");
    err.status = 404;
    throw err;
  }

  if (sendMode === "queue") return enqueueSend(targetThreadId, trimmed, normalizedImages, turnSettings);

  if (sendMode === "steer") {
    const current = await getMessages(targetThreadId, { limit: 20, fullHistory: true });
    if (!current.status?.thinking) {
      const err = new Error("There is no active Codex turn to insert this message into. Send it as a normal message instead.");
      err.status = 409;
      throw err;
    }
    let result;
    try {
      result = await getCodexIpcClient().steerTurn(targetThreadId, trimmed, normalizedImages, { cwd: targetThread.cwd });
    } catch (error) {
      if (isIpcTimeoutError(error)) return ambiguousSendResult(targetThreadId, trimmed, "steer");
      if (!isNoActiveTurnError(error)) throw error;
      const refreshed = await getMessages(targetThreadId, { limit: 20, fullHistory: true });
      if (refreshed.status?.thinking) {
        const err = new Error("Codex changed turns while the insert was being sent. Try Insert again or choose Queue.");
        err.status = 409;
        throw err;
      }
      const fallback = await sendToCodex(trimmed, targetThreadId, normalizedImages, { mode: "start", ...turnSettings });
      return { ...fallback, mode: "start-after-steer", fallbackFrom: "steer" };
    }
    const response = {
      ok: true,
      mode: "steer",
      threadId: targetThreadId,
      images: normalizedImages.map(({ name, mimeType, size }) => ({ name, mimeType, size })),
      turnId: result?.result?.result?.turnId || result?.result?.turnId || current.status.turnId || null,
      sentAt: new Date().toISOString()
    };
    void refreshCodexDesktopAfterSend(targetThreadId, getCodexIpcClient(), { turnId: response.turnId }).catch((error) => {
      logError(`[send-refresh] ${targetThreadId}: ${error?.message || error}`);
    });
    return response;
  }
  return runSerializedThreadStart(targetThreadId, async () => {
    const current = await getMessages(targetThreadId, { limit: 1, fullHistory: true });
    if (current.status?.thinking) {
      const err = new Error("Codex is still running. Choose Queue or Insert for this follow-up message.");
      err.status = 409;
      throw err;
    }

    const repair = await repairInvalidCustomToolCallIds(targetThreadId);
    if (repair.repaired) {
      recordNotice(targetThreadId, {
        severity: "warning",
        title: "Conversation repaired",
        content: `Repaired ${repair.repaired} invalid custom tool-call ID${repair.repaired === 1 ? "" : "s"} before sending. A backup was saved locally.`,
        source: "session-repair"
      });
    }

    // The repair check can take long enough for another Desktop action to
    // start a turn. Recheck immediately before Desktop creates its optimistic
    // in-progress turn.
    const finalStatus = await getMessages(targetThreadId, { limit: 1, fullHistory: true });
    if (finalStatus.status?.thinking) {
      const err = new Error("Codex is still running. Choose Queue or Insert for this follow-up message.");
      err.status = 409;
      throw err;
    }

    let result;
    try {
      result = await startTurnWithOwnerRecovery(getCodexIpcClient(), targetThreadId, trimmed, normalizedImages, turnSettings);
    } catch (error) {
      const noticeMessage = error?.message || "Codex Desktop rejected the message.";
      if (isNoOpenOwnerError(error)) {
        const err = new Error(`Codex Desktop has no open owner for this thread. I tried opening the target conversation, but it did not become ready. Last IPC error: ${noticeMessage}.`);
        err.status = 409;
        recordNotice(targetThreadId, {
          severity: "error",
          title: "Send failed",
          content: err.message,
          source: "send"
        });
        throw err;
      } else if (isIpcTimeoutError(error)) {
        recordNotice(targetThreadId, {
          severity: "warning",
          title: "Send timed out",
          content: "Codex Desktop did not confirm the send request in time. Companion will not send it a second time.",
          source: "send"
        });
        return ambiguousSendResult(targetThreadId, trimmed, "start");
      } else {
        recordNotice(targetThreadId, {
          severity: noticeSeverity(error?.ipcMessage || { type: "error", message: noticeMessage }, "error"),
          title: noticeTitle(error?.ipcMessage || { type: "error", message: noticeMessage }, "error"),
          content: noticeMessage,
          source: "send"
        });
        throw error;
      }
    }
    const response = {
      ok: true,
      mode: "desktop-ipc",
      threadId: targetThreadId,
      images: normalizedImages.map(({ name, mimeType, size }) => ({ name, mimeType, size })),
      turnId: result?.result?.turn?.id || result?.result?.turnId || null,
      sentAt: new Date().toISOString()
    };
    void refreshCodexDesktopAfterSend(targetThreadId, getCodexIpcClient(), { turnId: response.turnId }).catch((error) => {
      logError(`[send-refresh] ${targetThreadId}: ${error?.message || error}`);
    });
    return response;
  });
}

async function setThreadPinned(threadId, pinned) {
  if (!ALLOW_WRITE) {
    const err = new Error("Read-only mode is enabled. Restart without --readonly to manage conversations.");
    err.status = 403;
    throw err;
  }
  const id = String(threadId || "").trim();
  const rows = await runSqlJson(`
    SELECT threads.id, threads.is_pinned AS isPinned, threads.thread_section_id AS threadSectionId,
           thread_sections.name AS sectionName
    FROM threads
    LEFT JOIN thread_sections ON thread_sections.id = threads.thread_section_id
    WHERE threads.id = '${sqlString(id)}'
    LIMIT 1;
  `);
  if (!rows[0]) {
    const err = new Error("Thread not found");
    err.status = 404;
    throw err;
  }

  const currentPinned = threadListMetadata(rows[0]).pinned;
  if (currentPinned !== Boolean(pinned)) {
    if (pinned) {
      const sections = await runSqlJson(`SELECT id FROM thread_sections WHERE lower(name) = 'pinned' ORDER BY id LIMIT 1;`);
      const sectionId = String(sections[0]?.id || randomUUID());
      await runSqlJson(`
        BEGIN IMMEDIATE;
        INSERT OR IGNORE INTO thread_sections (id, name, appearance)
        VALUES ('${sqlString(sectionId)}', 'Pinned', NULL);
        UPDATE threads
        SET is_pinned = 1,
            thread_section_id = '${sqlString(sectionId)}',
            section_position = (
              SELECT COALESCE(MAX(section_position), 0) + 1000000
              FROM threads
              WHERE thread_section_id = '${sqlString(sectionId)}' AND id <> '${sqlString(id)}'
            ),
            section_entered_at_ms = ${Date.now()}
        WHERE id = '${sqlString(id)}';
        COMMIT;
      `);
    } else {
      await runSqlJson(`
        UPDATE threads
        SET is_pinned = 0, thread_section_id = NULL, section_position = NULL, section_entered_at_ms = NULL
        WHERE id = '${sqlString(id)}';
      `);
    }
  }

  invalidateThreadCaches();
  void getCodexIpcClient().refreshRecentConversations("local").catch((error) => {
    logError(`[pin-refresh] ${id}: ${error?.message || error}`);
  });
  return { ok: true, threadId: id, pinned: Boolean(pinned), desktopRefreshQueued: true };
}

async function waitForDesktopTurnPersistence(threadId, turnId, timeoutMs = 5000) {
  const id = String(threadId || "").trim();
  const expectedTurnId = String(turnId || "").trim();
  if (!id || !expectedTurnId) {
    await sleep(650);
    return false;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const current = await getMessages(id, { limit: 1, fullHistory: true });
      if (String(current.status?.turnId || "") === expectedTurnId) return true;
    } catch {
      // The rollout may still be appended; retry until the bounded deadline.
    }
    await sleep(180);
  }
  return false;
}

async function refreshCodexDesktopAfterSend(
  threadId,
  client = getCodexIpcClient(),
  { turnId = null, waitForPersistence = waitForDesktopTurnPersistence } = {}
) {
  const id = String(threadId || "").trim();
  if (!id) return { refreshed: false, failures: [] };

  // The rollout is already written by Desktop at this point. Drop local
  // snapshots first so the next API read cannot serve the pre-send state.
  invalidateThreadCaches();
  const persisted = await waitForPersistence(id, turnId);

  const failures = [];
  let refreshed = false;
  let openedThread = false;
  const following = client.followingConversationState?.(id) === true;
  for (let attempt = 0; attempt < 2 && !refreshed; attempt += 1) {
    try {
      await client.refreshRecentConversations("local");
      refreshed = true;
    } catch (error) {
      failures.push(`refresh: ${error?.message || error}`);
      if (attempt === 0) {
        // If the desktop currently follows this conversation, reopening its
        // deep link re-establishes the owner and prompts the detail view to
        // reload the rollout before the bounded retry.
        if (following) {
          try {
            await openCodexUrl(`codex://threads/${encodeURIComponent(id)}`);
            openedThread = true;
          } catch (openError) {
            failures.push(`open: ${openError?.message || openError}`);
          }
        }
        await sleep(persisted ? 250 : 650);
      }
    }
  }

  // Only re-select the conversation when Desktop has told us it is currently
  // following that stream. This refreshes an open detail view without pulling
  // the user away from a different conversation on the computer.
  if (following) {
    try {
      await client.setActiveConversation(id, true, "local");
    } catch (error) {
      failures.push(`set active: ${error?.message || error}`);
    }
  }

  const onlyNoClientFound = failures.length > 0 && failures.every((failure) => /no-client-found/i.test(String(failure)));
  if (shouldRecordDesktopRefreshNotice(failures)) {
    recordNotice(id, {
      severity: "warning",
      title: "Desktop refresh delayed",
      content: `The message was sent, but Codex Desktop did not fully refresh yet.\n\n${failures.join("\n")}`,
      source: "send-refresh"
    });
  } else if (onlyNoClientFound) {
    logInfo(`[send-refresh] Desktop refresh deferred for ${id}: no active Desktop client.`);
  }
  return { refreshed, failures, openedThread, persisted };
}

function shouldRecordDesktopRefreshNotice(failures = []) {
  const items = Array.isArray(failures) ? failures.filter(Boolean).map(String) : [];
  return items.length > 0 && !items.every((failure) => /no-client-found/i.test(failure));
}

function conversationIdFromStartConversation(response) {
  const result = response?.result;
  if (typeof result === "string" && result) return result;
  return firstString(result?.conversationId, result?.threadId, result?.id, response?.conversationId, response?.threadId, response?.id);
}

function turnIdFromStartConversation(response) {
  const result = response?.result;
  return firstString(result?.turn?.id, result?.turnId, result?.turn_id, response?.turnId, response?.turn_id);
}

async function startNewCodexThread(text, turnSettings) {
  try {
    const response = await getCodexIpcClient().startConversation(text, [], turnSettings);
    const threadId = conversationIdFromStartConversation(response);
    if (!threadId) throw new Error(`Codex Desktop did not return a conversation id. ${compact(response, 1200)}`);
    return {
      threadId,
      turnId: turnIdFromStartConversation(response),
      source: "desktop-ipc"
    };
  } catch (error) {
    const fallback = await startNewCodexThreadViaAppServer(text);
    return {
      ...fallback,
      source: "app-server-fallback",
      fallbackReason: error.message || String(error)
    };
  }
}

function startNewCodexThreadViaAppServer(text) {
  return new Promise((resolve, reject) => {
    const { home } = codexPaths();
    const child = spawn(CODEX_CLI, ["debug", "app-server", "send-message-v2", text], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CODEX_HOME: home
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let threadId = "";
    let turnId = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      const err = new Error("Timed out starting a new Codex conversation.");
      err.status = 504;
      reject(err);
    }, 45000);

    const maybeResolve = () => {
      threadId ||= firstRegexGroup(stdout, /"thread"[\s\S]*?"id"\s*:\s*"([^"]+)"/);
      turnId ||= firstRegexGroup(stdout, /"turn"[\s\S]*?"id"\s*:\s*"([^"]+)"/);
      if (!settled && threadId && turnId) {
        settled = true;
        clearTimeout(timer);
        resolve({ threadId, turnId });
      }
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 2_000_000) stdout = stdout.slice(-1_000_000);
      maybeResolve();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      maybeResolve();
      if (settled) return;
      const detail = firstString(stderr, stdout, `codex app-server exited with code ${code}`);
      const err = new Error(`Failed to start a new Codex conversation. ${compact(detail, 1200)}`);
      err.status = 502;
      reject(err);
    });
  });
}

async function notifyCodexDesktopThreadCreated(threadId) {
  const id = String(threadId || "").trim();
  if (!id) return;
  const client = getCodexIpcClient();
  const failures = [];
  try {
    await client.refreshRecentConversations("local");
  } catch (error) {
    failures.push(`refresh: ${error.message || error}`);
  }
  try {
    await client.setActiveConversation(id, true, "local");
  } catch (error) {
    failures.push(`set active: ${error.message || error}`);
  }
  try {
    await openCodexUrl(`codex://threads/${encodeURIComponent(id)}`);
  } catch (error) {
    failures.push(`open: ${error.message || error}`);
  }
  if (failures.length) {
    recordNotice(id, {
      severity: "warning",
      title: "Desktop refresh delayed",
      content: `The conversation was created, but Codex Desktop may need a moment to refresh.\n\n${failures.join("\n")}`,
      source: "new-thread"
    });
  }
}

function firstRegexGroup(text, regex) {
  const match = String(text || "").match(regex);
  return match?.[1] || "";
}

async function openCodexUrl(url) {
  await new Promise((resolve, reject) => {
    const command = process.platform === "win32" ? "rundll32.exe" : "open";
    const args = process.platform === "win32"
      ? ["url.dll,FileProtocolHandler", url]
      : String(url || "").startsWith("codex://")
        ? ["-b", "com.openai.codex", url]
        : [url];
    execFile(command, args, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function isNoOpenOwnerError(error) {
  const message = String(error?.message || "");
  return message === "no-client-found" || message.includes("thread-role-timeout");
}

function isNoActiveTurnError(error) {
  const message = String(error?.message || "");
  return /without an active turn id|no active codex turn|no active turn/i.test(message);
}

function isStaleInterruptTurnError(error) {
  const message = String(error?.message || "").toLowerCase();
  return /expected.?turn|turn.?id/.test(message) && /(invalid|mismatch|stale|not found|unknown|different|expired)/.test(message);
}

function interruptResultPayload(response) {
  const outerResult = response?.result;
  if (outerResult?.result && typeof outerResult.result === "object") return outerResult.result;
  if (outerResult && typeof outerResult === "object") return outerResult;
  return response && typeof response === "object" ? response : null;
}

function isExplicitInterruptNoop(response) {
  const result = interruptResultPayload(response);
  return Boolean(
    result &&
    Object.prototype.hasOwnProperty.call(result, "interruptedTurnId") &&
    !String(result.interruptedTurnId || "").trim()
  );
}

async function startTurnWithOwnerRecovery(
  ipcClient,
  threadId,
  text,
  images = [],
  {
    model,
    effort,
    openThread = (selectedThreadId) => openCodexUrl(`codex://threads/${encodeURIComponent(selectedThreadId)}`),
    ownerTimeoutMs = THREAD_OWNER_OPEN_TIMEOUT_MS
  } = {}
) {
  const turnSettings = normalizeTurnSettings({ model, effort });
  try {
    return await ipcClient.startTurn(threadId, text, images, turnSettings);
  } catch (error) {
    if (!isNoOpenOwnerError(error)) throw error;
    await openThread(threadId);
    const ownerClientId = await ipcClient.waitForThreadOwner(threadId, { timeoutMs: ownerTimeoutMs });
    if (!ownerClientId) throw error;
    return ipcClient.startTurn(threadId, text, images, turnSettings);
  }
}

async function interruptTurnWithOwnerRecovery(
  ipcClient,
  threadId,
  expectedTurnId = null,
  {
    openThread = (selectedThreadId) => openCodexUrl(`codex://threads/${encodeURIComponent(selectedThreadId)}`),
    refreshExpectedTurnId = async () => expectedTurnId,
    ownerTimeoutMs = THREAD_OWNER_OPEN_TIMEOUT_MS
  } = {}
) {
  try {
    return await ipcClient.interruptTurn(threadId, expectedTurnId);
  } catch (error) {
    if (!isNoOpenOwnerError(error)) throw error;
    await openThread(threadId);
    const ownerClientId = await ipcClient.waitForThreadOwner(threadId, { timeoutMs: ownerTimeoutMs });
    if (!ownerClientId) throw error;
    return ipcClient.interruptTurn(threadId, await refreshExpectedTurnId());
  }
}

async function interruptTurnWithFallback(
  ipcClient,
  threadId,
  expectedTurnId = null,
  options = {}
) {
  let response;
  try {
    response = await interruptTurnWithOwnerRecovery(ipcClient, threadId, expectedTurnId, options);
  } catch (error) {
    if (!expectedTurnId || (!isNoActiveTurnError(error) && !isStaleInterruptTurnError(error))) throw error;
    // Desktop can advance the active turn between the status read and the
    // interrupt request. Retry with the protocol's no-turn-id form so a stale
    // optimistic status cannot leave the phone's task stuck in "running".
    return interruptTurnWithOwnerRecovery(ipcClient, threadId, null, options);
  }
  if (expectedTurnId && isExplicitInterruptNoop(response)) {
    return interruptTurnWithOwnerRecovery(ipcClient, threadId, null, options);
  }
  return response;
}

async function interruptTurnAndConfirm(
  ipcClient,
  threadId,
  initialStatus,
  {
    readStatus = async (selectedThreadId) => (await getMessages(selectedThreadId, { limit: 1 })).status,
    beforeStatusRead = invalidateThreadCaches,
    attempts = 24,
    intervalMs = 180,
    sleepFn = sleep,
    ...interruptOptions
  } = {}
) {
  const originalTurnId = String(initialStatus?.turnId || "").trim() || null;
  if (!initialStatus?.thinking) {
    return { confirmed: true, alreadyStopped: true, response: null, status: initialStatus || { thinking: false, turnId: null } };
  }

  const response = await interruptTurnWithFallback(ipcClient, threadId, originalTurnId, interruptOptions);
  let status = initialStatus;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    beforeStatusRead();
    const snapshot = await readStatus(threadId);
    status = snapshot?.status || snapshot || { thinking: false, turnId: null };
    const currentTurnId = String(status?.turnId || "").trim() || null;
    if (!status?.thinking || (originalTurnId && currentTurnId && currentTurnId !== originalTurnId)) {
      return { confirmed: true, alreadyStopped: false, response, status };
    }
    if (attempt + 1 < attempts) await sleepFn(intervalMs);
  }

  const error = new Error("Codex Desktop acknowledged the stop request, but the original turn is still running.");
  error.status = 409;
  error.code = "INTERRUPT_NOT_CONFIRMED";
  throw error;
}

function isIpcTimeoutError(error) {
  return /timed out/i.test(String(error?.message || ""));
}

function messageTextForMatch(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(messageTextForMatch).filter(Boolean).join("\n");
  if (!value || typeof value !== "object") return "";
  return [value.text, value.content, value.message, value.prompt].map(messageTextForMatch).filter(Boolean).join("\n");
}

function hasUserMessageText(messages, expectedText) {
  const expected = String(expectedText || "").trim();
  if (!expected) return false;
  return (Array.isArray(messages) ? messages : []).some((message) => {
    if (message?.role !== "user") return false;
    return messageTextForMatch(message.content || message.text || message).includes(expected);
  });
}

async function ambiguousSendResult(threadId, text, mode) {
  // A desktop IPC timeout is ambiguous: the request may have reached Codex even
  // though the response did not reach Companion. Never make the phone retry it.
  await sleep(350);
  try {
    const refreshed = await getMessages(threadId, { limit: 20 });
    return {
      ok: true,
      uncertain: true,
      accepted: Boolean(refreshed.status?.thinking || hasUserMessageText(refreshed.messages, text)),
      mode: `${mode}-uncertain`,
      threadId,
      turnId: refreshed.status?.turnId || null,
      sentAt: new Date().toISOString()
    };
  } catch {
    return {
      ok: true,
      uncertain: true,
      accepted: false,
      mode: `${mode}-uncertain`,
      threadId,
      turnId: null,
      sentAt: new Date().toISOString()
    };
  }
}

async function interruptCodex(threadId) {
  if (!ALLOW_WRITE) {
    const err = new Error("Read-only mode is enabled. Restart without --readonly to control Codex Desktop.");
    err.status = 403;
    throw err;
  }
  const targetThreadId = threadId || (await getThreads())[0]?.id;
  if (!targetThreadId) {
    const err = new Error("No target thread selected");
    err.status = 400;
    throw err;
  }
  if (!(await findThread(targetThreadId))) {
    const err = new Error("Thread not found");
    err.status = 404;
    throw err;
  }

  const currentStatus = async () => (await getMessages(targetThreadId, { limit: 1 })).status;
  const initialStatus = await currentStatus();

  try {
    await interruptTurnAndConfirm(getCodexIpcClient(), targetThreadId, initialStatus, {
      readStatus: currentStatus,
      refreshExpectedTurnId: async () => {
        const status = await currentStatus();
        return status?.thinking ? status.turnId || null : null;
      }
    });
  } catch (error) {
    if (isNoOpenOwnerError(error)) {
      const err = new Error("Codex Desktop has no open owner for this thread. Open the target conversation in Codex Desktop, then try again.");
      err.status = 409;
      throw err;
    }
    throw error;
  }
  return {
    ok: true,
    mode: "desktop-ipc",
    threadId: targetThreadId,
    interruptedAt: new Date().toISOString()
  };
}

function normalizeApprovalDecision(value) {
  const text = String(value || "").trim();
  if (["accept", "approve", "yes", "true"].includes(text)) return "accept";
  if (["acceptForSession", "approve-for-session", "always", "session"].includes(text)) return "acceptForSession";
  if (["decline", "deny", "no", "false"].includes(text)) return "decline";
  const err = new Error("Unknown approval decision");
  err.status = 400;
  throw err;
}

function approvalDecisionCandidates(value) {
  const normalized = normalizeApprovalDecision(value);
  if (normalized === "accept") return ["accept", "approve"];
  if (normalized === "acceptForSession") return ["acceptForSession", "approve_for_session", "approveForSession", "accept_for_session"];
  if (normalized === "decline") return ["decline", "deny"];
  return [normalized];
}

function approvalDecisionCandidatesForRequest(value, liveRequest) {
  const normalized = normalizeApprovalDecision(value);
  const options = Array.isArray(liveRequest?.availableDecisions) ? liveRequest.availableDecisions : [];
  const matches = options
    .map((option) => (typeof option === "string" ? option : firstString(option?.id, option?.value, option?.action, option?.label, option?.title)))
    .filter(Boolean)
    .filter((option) => {
      try {
        return normalizeApprovalDecision(option) === normalized;
      } catch {
        return false;
      }
    });
  return [...new Set([...matches, ...approvalDecisionCandidates(value)])];
}

function approvalKindFromMethod(method) {
  const text = String(method || "").toLowerCase();
  if (text.includes("file")) return "file";
  if (text.includes("permission")) return "permission";
  if (text.includes("command") || text.includes("execution") || text.includes("exec") || text.includes("terminal")) return "command";
  return "";
}

function approvalMethodForKind(kind) {
  if (kind === "file") return "thread-follower-file-approval-decision";
  if (kind === "permission") return "thread-follower-permissions-request-approval-response";
  return "thread-follower-command-approval-decision";
}

function approvalMethodCandidatesForKind(kind) {
  if (kind === "file") {
    return [
      { method: "thread-follower-file-approval-decision", mode: "follower" },
      { method: "reply-with-file-change-approval-decision", mode: "direct" }
    ];
  }
  if (kind === "permission") {
    return [
      { method: "thread-follower-permissions-request-approval-response", mode: "follower" },
      { method: "reply-with-permissions-request-approval-response", mode: "direct" }
    ];
  }
  return [
    { method: "thread-follower-command-approval-decision", mode: "follower" },
    { method: "reply-with-command-execution-approval-decision", mode: "direct" }
  ];
}

function approvalAvailableDecisions(payload) {
  const params = payload?.params || payload?.payload || {};
  const request = payload?.request || params?.request || {};
  return (
    (Array.isArray(payload?.available_decisions) && payload.available_decisions) ||
    (Array.isArray(payload?.availableDecisions) && payload.availableDecisions) ||
    (Array.isArray(params?.available_decisions) && params.available_decisions) ||
    (Array.isArray(params?.availableDecisions) && params.availableDecisions) ||
    (Array.isArray(request?.available_decisions) && request.available_decisions) ||
    (Array.isArray(request?.availableDecisions) && request.availableDecisions) ||
    (Array.isArray(payload?.options) && payload.options) ||
    (Array.isArray(params?.options) && params.options) ||
    (Array.isArray(request?.options) && request.options) ||
    []
  );
}

function visitObjects(value, visitor, depth = 0, seen = new Set()) {
  if (!value || typeof value !== "object" || depth > 10 || seen.has(value)) return null;
  seen.add(value);
  const result = visitor(value);
  if (result) return result;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = visitObjects(item, visitor, depth + 1, seen);
      if (found) return found;
    }
    return null;
  }
  for (const child of Object.values(value)) {
    const found = visitObjects(child, visitor, depth + 1, seen);
    if (found) return found;
  }
  return null;
}

function findLiveApprovalRequest(threadId, fallbackRequestId) {
  const selectedThreadId = String(threadId || "");
  const fallback = String(fallbackRequestId || "");
  const events = codexIpcClient?.events || [];
  const candidates = [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const messageThreadId =
      event.message?.conversationId ||
      event.message?.conversation_id ||
      event.message?.threadId ||
      event.message?.thread_id ||
      event.message?.params?.conversationId ||
      event.message?.params?.conversation_id ||
      event.message?.params?.threadId ||
      event.message?.params?.thread_id ||
      "";
    if (selectedThreadId && (!messageThreadId || String(messageThreadId) !== selectedThreadId)) continue;
    const found = interactionPayloadsFromIpcMessage(event.message)
      .map((object) => {
        const methodText = String(object.method || object.type || object.name || "");
        const id = interactionRequestId(object);
        const kind = approvalKindFromPayload(object) || approvalKindFromMethod(methodText);
        if (!id || !kind) return null;
        return {
          requestId: id,
          kind,
          method: methodText,
          availableDecisions: approvalAvailableDecisions(object),
          priority: interactionPayloadPriority(object)
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.priority - b.priority);
    candidates.push(...found);
  }
  return candidates.find((candidate) => fallback && candidate.requestId === fallback) || candidates[0] || null;
}

async function respondToApproval({ threadId, requestId, decision, approvalKind } = {}) {
  if (!ALLOW_WRITE) {
    const err = new Error("Read-only mode is enabled. Restart without --readonly to control Codex Desktop.");
    err.status = 403;
    throw err;
  }
  const targetThreadId = threadId || (await getThreads())[0]?.id;
  if (!targetThreadId) {
    const err = new Error("No target thread selected");
    err.status = 400;
    throw err;
  }
  if (!(await findThread(targetThreadId))) {
    const err = new Error("Thread not found");
    err.status = 404;
    throw err;
  }
  const normalizedDecision = normalizeApprovalDecision(decision);
  const liveRequest = findLiveApprovalRequest(targetThreadId, requestId);
  const decisionCandidates = approvalDecisionCandidatesForRequest(decision, liveRequest);
  const resolvedRequestId = liveRequest?.requestId || String(requestId || "");
  const resolvedKind = liveRequest?.kind || String(approvalKind || "command");
  if (!resolvedRequestId) {
    const err = new Error("No approval request id found");
    err.status = 400;
    throw err;
  }

  const methodCandidates = approvalMethodCandidatesForKind(resolvedKind);
  const paramsForDecision = (candidate, mode) => {
    const base =
      resolvedKind === "permission"
        ? { conversationId: targetThreadId, requestId: resolvedRequestId, response: candidate }
        : { conversationId: targetThreadId, requestId: resolvedRequestId, decision: candidate };
    return mode === "follower" ? { hostId: "local", ...base } : base;
  };
  try {
    let lastError = null;
    for (const { method, mode } of methodCandidates) {
      for (const candidate of decisionCandidates) {
        try {
          await getCodexIpcClient().request(method, paramsForDecision(candidate, mode));
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!lastError) break;
    }
    if (lastError) throw lastError;
  } catch (error) {
    recordNotice(targetThreadId, {
      severity: "error",
      title: "Approval failed",
      content: `${error.message || "Codex Desktop rejected the approval decision."}\n\nMethods: ${methodCandidates.map((item) => item.method).join(", ")}\n\nRequest: ${resolvedRequestId}\n\nTried: ${decisionCandidates.join(", ")}`,
      source: "approval"
    });
    throw error;
  }
  return {
    ok: true,
    mode: "desktop-ipc",
    threadId: targetThreadId,
    requestId: resolvedRequestId,
    decision: normalizedDecision,
    approvalKind: resolvedKind,
    decidedAt: new Date().toISOString()
  };
}

async function serveStatic(res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(path.normalize(PUBLIC_DIR + path.sep))) {
    sendText(res, 403, "Forbidden");
    return;
  }
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".png": "image/png",
      ".svg": "image/svg+xml"
    };
    res.writeHead(200, {
      "content-type": types[ext] || "application/octet-stream",
      "cache-control": "no-store, must-revalidate"
    });
    res.end(data);
  } catch {
    sendText(res, 404, "Not found");
  }
}

async function allowedLocalFilePath(rawPath, threadId = "") {
  const requested = String(rawPath || "").trim();
  const selectedThreadId = String(threadId || "").trim();
  if (!requested || !selectedThreadId || requested.startsWith("file://") || requested.includes("\0") || !path.isAbsolute(requested)) return null;
  let canonicalPath;
  try {
    canonicalPath = await fs.realpath(path.resolve(requested));
  } catch {
    return null;
  }
  let authorized = referencedFilesByThread.get(selectedThreadId);
  if (!authorized?.has(canonicalPath)) {
    try {
      await getMessages(selectedThreadId, { limit: MAX_MESSAGE_LIMIT });
    } catch {
      return null;
    }
    authorized = referencedFilesByThread.get(selectedThreadId);
  }
  return authorized?.has(canonicalPath) ? canonicalPath : null;
}

async function serveLocalImage(res, filePath, threadId = "") {
  const normalized = await allowedLocalFilePath(filePath, threadId);
  if (!normalized) {
    sendText(res, 403, "Forbidden");
    return;
  }
  const mimeType = mimeTypeForAsset(normalized);
  if (!mimeType.startsWith("image/")) {
    sendText(res, 415, "Unsupported image type");
    return;
  }
  try {
    const stat = await fs.stat(normalized);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_LOCAL_IMAGE_BYTES) {
      sendText(res, 404, "Not found");
      return;
    }
    const data = await fs.readFile(normalized);
    res.writeHead(200, {
      "content-type": mimeType,
      "cache-control": "no-store, must-revalidate"
    });
    res.end(data);
  } catch {
    sendText(res, 404, "Not found");
  }
}

function requestedByteRange(rangeHeader, size) {
  const match = String(rangeHeader || "").match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const startText = match[1];
  const endText = match[2];
  if (!startText && !endText) return null;
  let start;
  let end;
  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : size - 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

function encodeRfc5987Value(value) {
  return encodeURIComponent(value).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function contentDispositionForDownload(fileName) {
  const normalized = String(fileName || "download.bin").replace(/[\r\n"]/g, "_");
  const extension = path.extname(normalized).replace(/[^\x20-\x7e]/g, "");
  let asciiFallback = normalized.normalize("NFKD").replace(/[^\x20-\x7e]/g, "_").replace(/[\\/:*?<>|]/g, "_");
  if (!asciiFallback.replace(/[_.\s-]/g, "")) asciiFallback = `download${extension || ".bin"}`;
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeRfc5987Value(normalized)}`;
}

async function serveLocalFile(req, res, filePath, threadId = "") {
  const normalized = await allowedLocalFilePath(filePath, threadId);
  if (!normalized) {
    sendText(res, 403, "Forbidden");
    return;
  }
  try {
    const stat = await fs.stat(normalized);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_LOCAL_FILE_BYTES) {
      sendText(res, stat.size > MAX_LOCAL_FILE_BYTES ? 413 : 404, stat.size > MAX_LOCAL_FILE_BYTES ? "File too large" : "Not found");
      return;
    }
    const mimeType = mimeTypeForAsset(normalized) || "application/octet-stream";
    const fileName = path.basename(normalized).replace(/[\r\n"]/g, "_");
    const rangeHeader = req.headers.range;
    const range = rangeHeader ? requestedByteRange(rangeHeader, stat.size) : null;
    if (rangeHeader && !range) {
      res.writeHead(416, {
        "content-range": `bytes */${stat.size}`,
        "accept-ranges": "bytes",
        "cache-control": "no-store, must-revalidate"
      });
      res.end();
      return;
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? stat.size - 1;
    const headers = {
      "content-type": mimeType,
      "content-length": end - start + 1,
      "content-disposition": contentDispositionForDownload(fileName),
      "accept-ranges": "bytes",
      "cache-control": "no-store, must-revalidate"
    };
    if (range) headers["content-range"] = `bytes ${start}-${end}/${stat.size}`;
    res.writeHead(range ? 206 : 200, headers);
    createReadStream(normalized, { start, end }).pipe(res);
  } catch {
    sendText(res, 404, "Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const requestStartedAt = performance.now();
  const requestMethod = req.method || "UNKNOWN";
  res.once("finish", () => {
    const durationMs = Math.round(performance.now() - requestStartedAt);
    if (res.statusCode >= 400 || durationMs >= slowRequestThresholdMs(requestMethod, url.pathname)) {
      const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "slow";
      const message = `[http:${level}] ${requestMethod} ${url.pathname} ${res.statusCode} ${durationMs}ms`;
      const logDecision = shouldLogHttpEvent({ method: requestMethod, pathname: url.pathname, statusCode: res.statusCode, level });
      if (!logDecision) return;
      const suppressed = typeof logDecision === "object" && logDecision.suppressed ? ` (suppressed ${logDecision.suppressed} similar)` : "";
      if (res.statusCode >= 500) logError(`${message}${suppressed}`);
      else logInfo(`${message}${suppressed}`);
    }
  });
  try {
    if (req.method === "GET" && url.pathname === "/api/local-image") {
      if (!requireAuthorized(req, res, url)) return;
      await serveLocalImage(res, url.searchParams.get("path"), url.searchParams.get("threadId"));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/local-file") {
      if (!requireAuthorized(req, res, url)) return;
      await serveLocalFile(req, res, url.searchParams.get("path"), url.searchParams.get("threadId"));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/health") {
      if (!requireAuthorized(req, res, url)) return;
      keepIpcWarm();
      const homeState = await refreshCodexHomeContext({ force: true, source: "health" });
      sendJson(res, 200, {
        ok: true,
        codexHome: homeState.home,
        codexHomeVersion: homeState.version,
        codexHomeSource: homeState.source,
        codexHomeFixed: homeState.fixed,
        codexHomeChangedAt: homeState.changedAt,
        codexIpcSocket: CODEX_IPC_SOCKET,
        authRequired: AUTH_REQUIRED,
        allowWrite: ALLOW_WRITE,
        models: CODEX_MODELS,
        defaultModel: DEFAULT_CODEX_MODEL,
        defaultEffort: DEFAULT_CODEX_EFFORT,
        now: new Date().toISOString()
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/debug/events") {
      if (!requireAuthorized(req, res, url)) return;
      keepIpcWarm();
      const homeState = await refreshCodexHomeContext({ force: true, source: "debug" });
      sendJson(res, 200, {
        ok: true,
        codexHome: homeState.home,
        codexHomeVersion: homeState.version,
        codexHomeSource: homeState.source,
        ipcConnected: Boolean(codexIpcClient?.socket?.writable),
        clientId: codexIpcClient?.clientId || null,
        eventCount: codexIpcClient?.events?.length || 0,
        events: codexIpcClient?.rawEvents(url.searchParams.get("limit")) || []
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/send") {
      if (!requireAuthorized(req, res, url)) return;
      const body = await readJsonBody(req, MAX_SEND_BODY_BYTES);
      const result = await runIdempotentSend(body.clientRequestId, sendRequestFingerprint(body), () =>
        sendToCodex(body.message, body.threadId, body.images, {
          newThread: Boolean(body.newThread),
          mode: body.mode,
          model: body.model,
          effort: body.effort
        })
      );
      sendJson(res, 200, result);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/queue/cancel") {
      if (!requireAuthorized(req, res, url)) return;
      const body = await readJsonBody(req);
      sendJson(res, 200, cancelQueuedSend(body.threadId, body.itemId));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/new-thread") {
      if (!requireAuthorized(req, res, url)) return;
      sendJson(res, 200, {
        ok: true,
        mode: "local-draft",
        draft: true,
        createdAt: new Date().toISOString()
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/interrupt") {
      if (!requireAuthorized(req, res, url)) return;
      const body = await readJsonBody(req);
      sendJson(res, 200, await interruptCodex(body.threadId));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/approval") {
      if (!requireAuthorized(req, res, url)) return;
      const body = await readJsonBody(req);
      sendJson(res, 200, await respondToApproval(body));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/account") {
      if (!requireAuthorized(req, res, url)) return;
      const homeState = await refreshCodexHomeContext({ source: "account" });
      sendJson(res, 200, { ...(await getAccountInfo()), codexHome: homeState.home, codexHomeVersion: homeState.version });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/plugins") {
      if (!requireAuthorized(req, res, url)) return;
      sendJson(res, 200, await getPlugins());
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/skills") {
      if (!requireAuthorized(req, res, url)) return;
      sendJson(res, 200, await getSkills());
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/threads") {
      if (!requireAuthorized(req, res, url)) return;
      const homeState = await refreshCodexHomeContext({ source: "threads" });
      sendJson(res, 200, {
        threads: await getThreads({ preserveIds: [url.searchParams.get("selectedId")] }),
        codexHome: homeState.home,
        codexHomeVersion: homeState.version
      });
      return;
    }
    const pinMatch = url.pathname.match(/^\/api\/threads\/([0-9a-fA-F-]{20,})\/pin$/);
    if (req.method === "POST" && pinMatch) {
      if (!requireAuthorized(req, res, url)) return;
      const body = await readJsonBody(req);
      sendJson(res, 200, await setThreadPinned(pinMatch[1], Boolean(body.pinned)));
      return;
    }
    const goalMatch = url.pathname.match(/^\/api\/threads\/([0-9a-fA-F-]{20,})\/goal$/);
    if (goalMatch && req.method === "GET") {
      if (!requireAuthorized(req, res, url)) return;
      sendJson(res, 200, { goal: await getThreadGoalSafe(goalMatch[1]) });
      return;
    }
    if (goalMatch && req.method === "PUT") {
      if (!requireAuthorized(req, res, url)) return;
      sendJson(res, 200, { goal: await setThreadGoal(goalMatch[1], await readJsonBody(req)) });
      return;
    }
    if (goalMatch && req.method === "DELETE") {
      if (!requireAuthorized(req, res, url)) return;
      sendJson(res, 200, await clearThreadGoal(goalMatch[1]));
      return;
    }
    const compactMatch = url.pathname.match(/^\/api\/threads\/([0-9a-fA-F-]{20,})\/compact$/);
    if (req.method === "POST" && compactMatch) {
      if (!requireAuthorized(req, res, url)) return;
      sendJson(res, 200, await compactThread(compactMatch[1]));
      return;
    }
    const match = url.pathname.match(/^\/api\/threads\/([0-9a-fA-F-]{20,})\/messages$/);
    if (req.method === "GET" && match) {
      if (!requireAuthorized(req, res, url)) return;
      sendJson(res, 200, await getMessages(match[1], {
        limit: url.searchParams.get("limit"),
        fullHistory: url.searchParams.get("history") === "full"
      }));
      return;
    }
    if (req.method !== "GET") {
      sendText(res, 405, "Method not allowed");
      return;
    }
    await serveStatic(res, decodeURIComponent(url.pathname));
  } catch (error) {
    logError(`[http:error] ${requestMethod} ${url.pathname}: ${error?.stack || error?.message || String(error)}`);
    sendJson(res, error.status || 500, { error: error.message || "Internal server error" });
  }
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logInfo(`[shutdown] Received ${signal}; closing HTTP server and IPC client.`);
  const closeServer = new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => {
      if (error) logFatalError("HTTP server close failed", error);
      resolve();
    });
  });
  const timeout = setTimeout(() => {
    logError("[shutdown] Close timeout reached; forcing exit.");
    process.exit(1);
  }, 5000);
  timeout.unref?.();
  try {
    codexIpcClient?.close?.();
  } catch (error) {
    logFatalError("IPC client close failed", error);
  }
  await closeServer;
  clearTimeout(timeout);
  logInfo("[shutdown] Complete.");
  process.exit(0);
}

server.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    logError(`[fatal] Cannot start Codex LAN Companion: ${HOST}:${PORT} is already in use.`);
    logError("Stop the existing service first, choose another --port, or run:");
    logError(`  lsof -nP -iTCP:${PORT} -sTCP:LISTEN`);
    logError("  codex-lan-companion-uninstall-service");
  } else if (error?.code === "EACCES") {
    logError(`[fatal] Cannot start Codex LAN Companion: permission denied for ${HOST}:${PORT}.`);
    logError("Choose a different --host/--port or check local firewall and permission settings.");
  } else {
    logFatalError("HTTP server failed to start", error);
  }
  process.exit(1);
});

if (IS_MAIN) process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

if (IS_MAIN) process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

if (IS_MAIN) server.listen(PORT, HOST, () => {
  const localUrl = `http://127.0.0.1:${PORT}/`;
  const lanUrls = Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => `http://${entry.address}:${PORT}/`);
  const primaryUrl = lanUrls[0] || localUrl;
  const printRuntimeUrls = () => {
    logInfo(`Local:  ${localUrl}`);
    for (const lanUrl of lanUrls) logInfo(`LAN:    ${lanUrl}`);
  };
  const printQr = () => {
    if (!IS_INTERACTIVE_TTY) return;
    console.log("");
    if (AUTH_REQUIRED) console.log("QR:     opens the LAN page and signs in automatically");
    else console.log("QR:     opens the LAN page");
    qrcode.generate(loginUrlFor(primaryUrl), { small: true });
  };

  logInfo("Codex LAN Companion is running");
  logInfo(`Boot:   ${SYSTEM_BOOT_AT_ISO} (${formatDuration(PROCESS_STARTED_AT_MS - SYSTEM_BOOT_AT_MS)} ago)`);
  logInfo(`Start:  ${PROCESS_STARTED_AT_ISO}`);
  logInfo(`Origin: ${START_SOURCE}${IS_INTERACTIVE_TTY ? " · interactive terminal" : " · background service"}`);
  printRuntimeUrls();
  if (AUTH_REQUIRED) logInfo(`Access code: ${ACCESS_TOKEN}`);
  logInfo(
    `Mode:   ${ALLOW_WRITE ? "write enabled" : "read-only"}${
      AUTH_REQUIRED ? " · access-code protected" : " · auth disabled"
    }`
  );
  logInfo(`Data:   ${codexHomeState.home}${codexHomeState.fixed ? " (fixed)" : " (dynamic)"}`);
  if (IS_INTERACTIVE_TTY) {
    logInfo("Type:   qr, url, code, no-auth, auth, or help + Enter for runtime commands");
    printQr();
  }

  if (IS_INTERACTIVE_TTY) {
    const terminal = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "" });
    terminal.on("line", (line) => {
      const command = line.trim().toLowerCase();
      if (command === "qr") printQr();
      else if (command === "no-auth") {
        AUTH_REQUIRED = false;
        console.log("Access-code auth disabled. Existing and new browser sessions can access the LAN page without a code.");
        console.log("Type auth + Enter to enable access-code auth again.");
      } else if (command === "auth") {
        AUTH_REQUIRED = true;
        console.log("Access-code auth enabled.");
        console.log(`Access code: ${ACCESS_TOKEN}`);
        printQr();
      } else if (command === "url") {
        console.log(`Local:  ${localUrl}`);
        for (const lanUrl of lanUrls) console.log(`LAN:    ${lanUrl}`);
      } else if (command === "code") {
        console.log(`Access code: ${ACCESS_TOKEN}`);
        if (!AUTH_REQUIRED) console.log("Access-code auth is currently disabled.");
      } else if (command === "help" || command === "?") {
        console.log("Commands: qr, url, code, no-auth, auth, help");
      } else if (command) {
        console.log("Unknown command. Type help for available commands.");
      }
    });
  }
});

export {
  canExposeLocalFilesForMessage,
  contentDispositionForDownload,
  createRolloutParseState,
  desktopInterruptTurnRequest,
  desktopStartTurnRequest,
  desktopSteerRestoreMessage,
  enqueueSend,
  ipcVersionForMethod,
  ipcVersionForRequest,
  interruptTurnAndConfirm,
  interruptTurnWithOwnerRecovery,
  interruptTurnWithFallback,
  isNoActiveTurnError,
  isIpcTimeoutError,
  isNoOpenOwnerError,
  limitMessagesForClient,
  localPathCandidates,
  normalizeTurnSettings,
  parseRolloutLine,
  parseRolloutTail,
  cancelQueuedSend,
  queuedSendStatus,
  queuedSendIdleDecision,
  repairInvalidCustomToolCallIdsInText,
  requestedByteRange,
  rolloutPathForCurrentHome,
  rolloutResultFromState,
  contextCompactionMessage,
  planMessage,
  getThreadGoalSafe,
  sanitizeThreadGoal,
  setThreadGoal,
  clearThreadGoal,
  compactThread,
  runSerializedThreadStart,
  sameFilePath,
  runIdempotentSend,
  refreshCodexDesktopAfterSend,
  shouldRecordDesktopRefreshNotice,
  startTurnWithOwnerRecovery,
  stripHiddenMessageLocalAssets,
  isSubagentThread,
  threadListMetadata,
  visibleThreadRows
};
