"use strict";

/**
 * Codex-Turnloom machine gateway.
 *
 * ONE public port, ONE machine pairing QR, many local harness backends.
 * The machine token is accepted only by GET /api/harnesses. Every other
 * request is routed by an individual harness token to that harness's private
 * loopback backend. Private fields from machine.json (ports, executable paths,
 * Codex homes) are never returned by discovery.
 *
 * This is a transport gateway, not an authentication replacement: each
 * upstream server.js still enforces its own access code. The gateway adds
 * constant-time machine-token comparison, bounded failure backoff, token
 * redaction, and process supervision for the local harnesses.
 */

const http = require("node:http");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const {
  PROTOCOL,
  VERSION,
  HARNESS_PATH,
  cleanString,
  normalizeBaseUrl,
  normalizeHarnesses,
} = require("../shared/machine-pairing.cjs");

const HERE = __dirname;
const PROJECT_ROOT = path.resolve(HERE, "..");
const DEFAULT_CONFIG = path.join(PROJECT_ROOT, "deploy", "machine.example.json");
const ROUTING_COOKIE = "turnloom_harness";
const FAILURE_WINDOW_MS = 10 * 60 * 1000;
const FAILURE_LIMIT = 10;
const FAILURE_MAX_SOURCES = 2048;
const HARNESS_TIMEOUT_MS = 8_000;

function parseArgs(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index]);
    if (!arg.startsWith("--")) continue;
    const next = argv[index + 1];
    if (next === undefined || String(next).startsWith("--")) flags[arg.slice(2)] = true;
    else {
      flags[arg.slice(2)] = String(next);
      index += 1;
    }
  }
  return flags;
}

function tokensEqual(candidate, expected) {
  const left = crypto.createHash("sha256").update(String(candidate ?? "")).digest();
  const right = crypto.createHash("sha256").update(String(expected ?? "")).digest();
  return crypto.timingSafeEqual(left, right);
}

function safeId(raw, fallback) {
  const value = cleanString(raw)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return value || fallback;
}

/**
 * Normalize and validate machine.json. Throws before any socket is opened.
 * In single-harness mode machineToken may equal the harness token for legacy
 * compatibility; with multiple harnesses it must be distinct from all of them.
 */
function loadMachineConfig(configPath = DEFAULT_CONFIG) {
  const resolved = path.resolve(String(configPath || DEFAULT_CONFIG));
  const raw = JSON.parse(fs.readFileSync(resolved, "utf8").replace(/^\uFEFF/, ""));
  const machineId = cleanString(raw.machineId || raw.machine_id || "machine").slice(0, 120) || "machine";
  const machineName = cleanString(raw.machineName || raw.machine_name || machineId).slice(0, 120) || machineId;
  const machineToken = cleanString(raw.machineToken || raw.machine_token);
  const rows = Array.isArray(raw.harnesses) ? raw.harnesses : [];
  if (!machineToken) throw new Error("machine.json: machineToken 不能为空");
  if (!rows.length) throw new Error("machine.json: 至少配置一个 harness");
  if (rows.length > 24) throw new Error("machine.json: 最多配置 24 个 harness");

  const ids = new Set();
  const tokens = new Set();
  const harnesses = [];
  for (const [index, row] of rows.entries()) {
    if (!row || typeof row !== "object") throw new Error(`machine.json: harnesses[${index}] 必须是对象`);
    let id = safeId(row.id || row.key || row.name, `harness-${index + 1}`);
    if (ids.has(id)) id = `${id}-${index + 1}`;
    if (ids.has(id)) throw new Error(`machine.json: harness id 重复：${id}`);
    ids.add(id);
    const token = cleanString(row.token || row.accessCode);
    if (!token || token.length > 256 || /[\u0000-\u001f\u007f]/.test(token)) {
      throw new Error(`machine.json: harness ${id} 的 token 无效`);
    }
    if (tokens.has(token)) throw new Error(`machine.json: harness ${id} 的 token 与其他 harness 重复`);
    tokens.add(token);
    const port = Number(row.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`machine.json: harness ${id} 的 port 无效`);
    }
    const entry = cleanString(row.entry);
    const spawnBackend = row.spawn !== false;
    if (spawnBackend && (!entry || !fs.existsSync(entry))) {
      throw new Error(`machine.json: harness ${id} 需要可执行的 entry 路径`);
    }
    harnesses.push({
      id,
      name: cleanString(row.name || row.label || id).slice(0, 80) || id,
      token,
      kind: cleanString(row.kind || "codex").slice(0, 40) || "codex",
      port,
      entry,
      codexHome: cleanString(row.codexHome || row.codex_home),
      spawn: spawnBackend,
      extraArgs: Array.isArray(row.extraArgs) ? row.extraArgs.map(String) : [],
      defaultHarness: false,
    });
  }
  if (harnesses.length > 1 && tokens.has(machineToken)) {
    throw new Error("machine.json: 多 harness 模式下 machineToken 不得等于任何 harness token");
  }
  const requestedDefault = cleanString(raw.defaultHarness || raw.defaultHarnessId || raw.defaultDevice);
  const selected = harnesses.find((item) => item.id === requestedDefault) || harnesses[0];
  selected.defaultHarness = true;

  // Explicit aliases preserve previously issued machine pairing codes only.
  // Harness tokens never gain discovery access unless listed by the operator.
  const legacyMachineTokens = Array.isArray(raw.legacyMachineTokens) ? [...new Set(raw.legacyMachineTokens.map(cleanString))] : [];
  if (legacyMachineTokens.length > 4 || legacyMachineTokens.some((token) => !token || token.length > 256 || /[\u0000-\u001f\u007f]/.test(token))) {
    throw new Error("machine.json: legacyMachineTokens 无效");
  }
  return {
    configPath: resolved,
    machineId,
    machineName,
    machineToken,
    legacyMachineTokens,
    defaultHarnessId: selected.id,
    harnesses,
    byToken: new Map(harnesses.map((item) => [item.token, item])),
    publicUrl: normalizeBaseUrl(raw.publicUrl || ""),
  };
}

/** The discovery body: public routing fields only, never ports/paths/homes. */
function publicDiscovery(config, onlineById = null) {
  const harnesses = config.harnesses.map((item) => ({
    id: item.id,
    name: item.name,
    token: item.token,
    kind: item.kind,
    defaultHarness: item.defaultHarness,
    online: onlineById ? Boolean(onlineById[item.id]) : null,
  }));
  const selected = harnesses.find((item) => item.defaultHarness) || harnesses[0];
  return {
    ok: true,
    protocol: PROTOCOL,
    version: VERSION,
    machineId: config.machineId,
    machineName: config.machineName,
    defaultHarnessId: selected?.id || "",
    harnesses: normalizeHarnesses(harnesses, selected?.id || null),
  };
}

function tokenFromQuery(rawUrl) {
  const query = String(rawUrl || "").split("?")[1] || "";
  return new URLSearchParams(query.split("#")[0]).get("token") || "";
}

function tokenFromCookie(header, name) {
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return "";
      }
    }
  }
  return "";
}

function headerToken(req) {
  const direct = req.headers["x-access-token"];
  if (Array.isArray(direct)) return cleanString(direct[0]);
  if (typeof direct === "string" && direct) return cleanString(direct);
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth) return cleanString(auth.replace(/^Bearer\s+/i, ""));
  return "";
}

function authorizationFromRequest(req) {
  const rawUrl = req.url || "/";
  const pathname = rawUrl.split("?")[0].split("#")[0];
  const viaQuery = tokenFromQuery(rawUrl);
  if (viaQuery) return { token: viaQuery, via: "query", pathname };
  const viaHeader = headerToken(req);
  if (viaHeader) return { token: viaHeader, via: "header", pathname };
  const referer = String(req.headers.referer || "");
  if (referer) {
    const viaReferer = tokenFromQuery(referer);
    if (viaReferer) return { token: viaReferer, via: "referer", pathname };
  }
  const viaCookie = tokenFromCookie(req.headers.cookie, ROUTING_COOKIE);
  if (viaCookie) return { token: viaCookie, via: "cookie", pathname };
  return { token: "", via: "none", pathname };
}

const failureState = new Map();

function sourceKey(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket?.remoteAddress || "unknown";
}

function blockedRemainingMs(req) {
  const key = sourceKey(req);
  const state = failureState.get(key);
  if (!state?.blockedUntilMs) return 0;
  const remaining = state.blockedUntilMs - Date.now();
  if (remaining <= 0) {
    failureState.delete(key);
    return 0;
  }
  return remaining;
}

function noteFailure(req) {
  const key = sourceKey(req);
  const now = Date.now();
  const state = failureState.get(key);
  if (!state || now - state.firstAtMs > FAILURE_WINDOW_MS) {
    if (failureState.size >= FAILURE_MAX_SOURCES) failureState.delete(failureState.keys().next().value);
    failureState.set(key, { failures: 1, firstAtMs: now, blockedUntilMs: 0 });
    return;
  }
  state.failures += 1;
  if (state.failures >= FAILURE_LIMIT) {
    state.blockedUntilMs = now + Math.min(30 * 60 * 1000, 30_000 * 2 ** (state.failures - FAILURE_LIMIT));
  }
}

function clearFailures(req) {
  failureState.delete(sourceKey(req));
}

function redactTokens(text, config) {
  let value = String(text ?? "");
  const secrets = [config.machineToken, ...(config.legacyMachineTokens || []), ...config.harnesses.map((item) => item.token)]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const secret of secrets) value = value.split(secret).join("***");
  return value
    .replace(/([?&](?:token|login|accessCode)=)[^&#\s]+/gi, "$1***")
    .replace(/(Bearer\s+)\S+/gi, "$1***");
}

/** Preserve the exact incoming URL; the harness token is already in headers/cookie. */
function withToken(rawUrl, token) {
  if (!token) return rawUrl;
  return rawUrl;
}

function routingCookie(token, req) {
  const secure = Boolean(req.socket?.encrypted) || String(req.headers["x-forwarded-proto"] || "").toLowerCase() === "https";
  return `${ROUTING_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

function isListening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(700);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function buildBackendArgs(harness, options) {
  const args = [
    harness.entry,
    "--host", "127.0.0.1",
    "--port", String(harness.port),
    "--password", harness.token,
  ];
  if (harness.codexHome) args.push("--codex-home", harness.codexHome);
  if (options.publicUrl) args.push("--public-url", options.publicUrl);
  if (options.readonly) args.push("--readonly");
  args.push(...harness.extraArgs);
  return args;
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function proxyTo(harness, req, res, token, cookie) {
  const upstreamUrl = withToken(req.url || "/", token);
  const headers = { ...req.headers, host: `127.0.0.1:${harness.port}` };
  delete headers["accept-encoding"];
  delete headers.referer;
  headers["x-access-token"] = token;
  const upstream = http.request(
    { host: "127.0.0.1", port: harness.port, method: req.method, path: upstreamUrl, headers },
    (upRes) => {
      const outHeaders = { ...upRes.headers };
      if (cookie) {
        const existing = outHeaders["set-cookie"];
        outHeaders["set-cookie"] = Array.isArray(existing)
          ? [...existing, cookie]
          : existing ? [existing, cookie] : [cookie];
      }
      res.writeHead(upRes.statusCode || 502, outHeaders);
      upRes.on("error", () => {});
      res.on("error", () => {});
      req.on("error", () => {});
      upRes.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) sendJson(res, 502, { error: "backend-unavailable", harness: harness.id });
    else res.end();
  });
  req.pipe(upstream);
}

function createGateway(config, options = {}) {
  const log = options.log || (() => {});
  const children = new Map();
  const logDir = options.logDir || path.join(path.dirname(config.configPath), "logs");
  fs.mkdirSync(logDir, { recursive: true });

  function startBackend(harness) {
    if (!harness.spawn) return;
    const out = fs.openSync(path.join(logDir, `harness-${harness.id}.out.log`), "a");
    const err = fs.openSync(path.join(logDir, `harness-${harness.id}.err.log`), "a");
    const args = buildBackendArgs(harness, options);
    const child = spawn(process.execPath, args, {
      cwd: path.dirname(harness.entry),
      detached: true,
      windowsHide: true,
      stdio: ["ignore", out, err],
    });
    child.unref();
    children.set(harness.id, child.pid);
    log(`spawned harness ${harness.id} pid=${child.pid} port=${harness.port}`);
  }

  async function keepBackendsAlive() {
    for (const harness of config.harnesses) {
      if (!harness.spawn) continue;
      if (await isListening(harness.port)) continue;
      log(`harness ${harness.id} not listening on ${harness.port}, starting`);
      try {
        startBackend(harness);
      } catch (error) {
        log(`harness ${harness.id} spawn failed: ${redactTokens(error?.message, config)}`);
      }
    }
  }

  const server = http.createServer(async (req, res) => {
    const blocked = blockedRemainingMs(req);
    if (blocked > 0) {
      sendJson(res, 429, { error: "Too many failed access-code attempts", retryAfterMs: blocked }, {
        "retry-after": String(Math.max(1, Math.ceil(blocked / 1000))),
      });
      return;
    }
    const auth = authorizationFromRequest(req);

    if (req.method === "GET" && auth.pathname === HARNESS_PATH) {
      const discoveryTokens = [config.machineToken, ...(config.legacyMachineTokens || [])];
      if (!discoveryTokens.some((token) => tokensEqual(auth.token, token))) {
        if (auth.token) noteFailure(req);
        sendJson(res, 401, { error: "invalid-machine-token", protocol: PROTOCOL, version: VERSION });
        return;
      }
      clearFailures(req);
      const onlineById = {};
      await Promise.all(config.harnesses.map(async (harness) => {
        onlineById[harness.id] = await isListening(harness.port);
      }));
      sendJson(res, 200, publicDiscovery(config, onlineById));
      return;
    }

    if (req.method === "GET" && auth.pathname === "/__turnloom/health") {
      sendJson(res, 200, {
        ok: true,
        protocol: PROTOCOL,
        version: VERSION,
        machineId: config.machineId,
        harnessCount: config.harnesses.length,
      });
      return;
    }

    const harness = config.byToken.get(auth.token);
    if (!harness) {
      if (auth.token) noteFailure(req);
      const isMachineToken = tokensEqual(auth.token, config.machineToken);
      sendJson(res, 401, {
        error: isMachineToken ? "machine-token-requires-discovery" : "invalid-harness-token",
        protocol: PROTOCOL,
        version: VERSION,
      });
      return;
    }
    clearFailures(req);
    const routine = /^\/api\/(?:health|auth\/session)(?:\?|$)/i.test(req.url || "");
    if (!routine && !/\.(?:css|js|svg|png|ico|webp|woff2?|map)$/i.test(req.url || "")) {
      log(`${req.method} ${redactTokens(req.url, config)} -> ${harness.id} (${auth.via})`);
    }
    const cookie = auth.via === "cookie" ? "" : routingCookie(harness.token, req);
    proxyTo(harness, req, res, harness.token, cookie);
  });

  const watchdog = setInterval(() => {
    keepBackendsAlive().catch((error) => log(`watchdog error: ${redactTokens(error?.message, config)}`));
  }, 5000);
  watchdog.unref?.();

  server.on("error", (error) => {
    log(`gateway listen failed: ${redactTokens(error?.message, config)}`);
  });

  return {
    server,
    async listen(host = "0.0.0.0", port = 8787) {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.removeListener("error", reject);
          log(`listening on ${host}:${port}`);
          log(`machine ${config.machineId} · ${config.harnesses.length} harnesses`);
          resolve();
        });
      });
      await keepBackendsAlive();
    },
    async close() {
      clearInterval(watchdog);
      await new Promise((resolve) => server.close(resolve));
    },
    keepBackendsAlive,
    children,
  };
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help || flags.h) {
    console.log(`Codex-Turnloom Machine Gateway

  node server/machine-gateway.cjs --config <machine.json> [options]

  --host <addr>         Listen address (default 0.0.0.0)
  --port <number>       Listen port (default 8787)
  --config <path>       Machine/harness table (default deploy/machine.example.json)
  --public-url <url>    Public URL passed to spawned backends
  --readonly            Start spawned backends read-only
  --no-spawn            Do not supervise local backend processes`);
    return;
  }
  const config = loadMachineConfig(flags.config);
  if (flags["no-spawn"]) {
    for (const harness of config.harnesses) harness.spawn = false;
  }
  const options = {
    publicUrl: normalizeBaseUrl(flags["public-url"] || config.publicUrl),
    readonly: Boolean(flags.readonly),
  };
  const gateway = createGateway(config, {
    ...options,
    log: (line) => process.stdout.write(`[machine-gateway] ${redactTokens(line, config)}\n`),
  });
  gateway.listen(String(flags.host || "0.0.0.0"), Number(flags.port || 8787)).catch((error) => {
    console.error(`[machine-gateway] fatal: ${redactTokens(error?.message, config)}`);
    process.exitCode = 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      gateway.close().finally(() => process.exit(0));
      setTimeout(() => process.exit(0), 1500).unref();
    });
  }
}

if (require.main === module) main();

module.exports = {
  parseArgs,
  tokensEqual,
  loadMachineConfig,
  publicDiscovery,
  authorizationFromRequest,
  blockedRemainingMs,
  noteFailure,
  clearFailures,
  redactTokens,
  withToken,
  routingCookie,
  isListening,
  buildBackendArgs,
  createGateway,
  HARNESS_TIMEOUT_MS,
};
