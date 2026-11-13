"use strict";

/**
 * Desktop-side one-machine / many-harness integration.
 *
 * This module is intentionally independent of server/machine-gateway.cjs: the
 * Windows console must be able to validate its machine.json, build the ONE v2
 * QR and decide whether an already-listening service is really *our* gateway
 * even when the gateway itself is not running yet. The protocol codec lives in
 * shared/machine-pairing.cjs; the machine.json shape matches the server-side
 * loader (test/desktop-machine-gateway.test.cjs asserts that compatibility).
 *
 * Secrets never appear in the returned summaries: machine.json is a per-user
 * runtime file, and only the QR generator / authenticated HTTP probes see the
 * actual tokens.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const shared = require(path.join(__dirname, "..", "..", "shared", "machine-pairing.cjs"));
const { explicitTransport } = require("./transport.cjs");

const APP_DIR = path.resolve(__dirname, "..", "..");
const LOCAL_APP_DATA = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
const CONFIG_DIR = path.join(LOCAL_APP_DATA, "CodexPocket");
const DEFAULT_CONSOLE_CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const DEFAULT_MACHINE_CONFIG_PATH = path.join(CONFIG_DIR, "machine.json");
const GATEWAY_ENTRY = path.join(APP_DIR, "server", "machine-gateway.cjs");
const HEALTH_MARKER_PATH = "/__turnloom/health";
const MAX_EXTRA_ARGS = 64;

function consoleConfigPath() {
  const explicit = String(process.env.TURNLOOM_CONFIG_PATH || "").trim();
  return explicit ? path.resolve(explicit) : DEFAULT_CONSOLE_CONFIG_PATH;
}

function machineConfigPath(config = {}) {
  const explicit = String(config?.machineGateway?.machineConfigPath || process.env.TURNLOOM_MACHINE_CONFIG_PATH || "").trim();
  return explicit ? path.resolve(explicit) : DEFAULT_MACHINE_CONFIG_PATH;
}

/** Explicit switch only: a stray machine.json must NEVER silently change the runtime. */
function gatewayMode(config) {
  return Boolean(config?.machineGateway?.enabled);
}

function clean(value) {
  return shared.cleanString(value);
}

function safeId(value, fallback) {
  const slug = clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || fallback;
}

function maskToken(value) {
  return value ? "•".repeat(Math.max(6, Math.min(10, String(value).length))) : "";
}

function randomToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function readJson(file, { required = true } = {}) {
  if (!fs.existsSync(file)) {
    if (required) throw new Error(`配置文件不存在：${file}`);
    return null;
  }
  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`配置文件解析失败：${file}（${error.message}）`);
  }
}

function normalizeMachineId(value) {
  const slug = clean(value)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, shared.MAX_NAME_LENGTH);
  return slug || shared.machineIdentity({ machineId: os.hostname() });
}

/**
 * Validate a machine.json row set. Mirrors server/machine-gateway.cjs's rules
 * without importing server code, so a partially deployed server tree cannot
 * make the console silently fall back to the legacy single-harness launcher.
 */
function normalizeMachineConfig(raw, { configPath = "" } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("machine.json 必须是对象");
  const machineId = clean(raw.machineId || raw.machine_id) || "machine";
  const machineName = clean(raw.machineName || raw.machine_name) || machineId;
  const machineToken = clean(raw.machineToken || raw.machine_token);
  const rows = Array.isArray(raw.harnesses) ? raw.harnesses : [];
  if (!machineToken) throw new Error("machine.json: machineToken 不能为空");
  if (!rows.length) throw new Error("machine.json: 至少配置一个 harness");
  if (rows.length > shared.MAX_HARNESSES) throw new Error(`machine.json: 最多 ${shared.MAX_HARNESSES} 个 harness`);
  if (/[\u0000-\u001f\u007f]/.test(machineToken) || machineToken.length > shared.MAX_TOKEN_LENGTH) {
    throw new Error("machine.json: machineToken 无效");
  }

  const legacyMachineTokens = Array.isArray(raw.legacyMachineTokens) ? [...new Set(raw.legacyMachineTokens.map(clean))] : [];
  if (legacyMachineTokens.length > 4 || legacyMachineTokens.some((token) => !token || token.length > shared.MAX_TOKEN_LENGTH || /[\u0000-\u001f\u007f]/.test(token))) {
    throw new Error("machine.json: legacyMachineTokens 无效");
  }
  const requestedDefault = clean(raw.defaultHarness || raw.defaultHarnessId || raw.defaultDevice);
  const publicRows = shared.normalizeHarnesses(rows.map((row, index) => ({
    id: row?.id || row?.key || row?.name || `harness-${index + 1}`,
    name: row?.name || row?.label || row?.key || row?.id,
    token: row?.token || row?.accessCode,
    kind: row?.kind || row?.backend || "codex",
    defaultHarness: requestedDefault ? (row?.id || row?.key || row?.name) === requestedDefault : index === 0,
    online: null,
  })), safeId(requestedDefault, "") || null);

  const harnesses = publicRows.map((publicRow, index) => {
    const row = rows[index] || {};
    const port = Number(row.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`machine.json: harness ${publicRow.id} 的 port 无效`);
    }
    const spawn = row.spawn !== false;
    const entry = clean(row.entry);
    if (spawn && !entry) throw new Error(`machine.json: harness ${publicRow.id} 需要 entry 路径`);
    return {
      id: publicRow.id,
      name: publicRow.name,
      token: publicRow.token,
      kind: publicRow.kind,
      port,
      entry,
      codexHome: clean(row.codexHome || row.codex_home),
      spawn,
      extraArgs: Array.isArray(row.extraArgs) ? row.extraArgs.slice(0, MAX_EXTRA_ARGS).map(String) : [],
      defaultHarness: publicRow.defaultHarness,
      online: null,
    };
  });

  if (harnesses.length > 1 && harnesses.some((item) => item.token === machineToken)) {
    throw new Error("machine.json: 多 harness 模式下 machineToken 不得等于任何 harness token");
  }
  const selected = harnesses.find((item) => item.defaultHarness) || harnesses[0];
  return {
    configPath: configPath ? path.resolve(configPath) : "",
    machineId,
    machineName,
    machineToken,
    legacyMachineTokens,
    defaultHarnessId: selected.id,
    harnesses,
    publicUrl: shared.normalizeBaseUrl(raw.publicUrl || ""),
  };
}

function loadMachineConfig(config) {
  const file = machineConfigPath(config);
  return normalizeMachineConfig(readJson(file), { configPath: file });
}

/** The exact discovery body the real gateway would return (public fields only). */
function discoveryFor(machine) {
  const harnesses = shared.normalizeHarnesses(
    machine.harnesses.map((item) => ({
      id: item.id,
      name: item.name,
      token: item.token,
      kind: item.kind,
      defaultHarness: item.id === machine.defaultHarnessId,
      online: null,
    })),
    machine.defaultHarnessId,
  );
  return {
    ok: true,
    protocol: shared.PROTOCOL,
    version: shared.VERSION,
    machineId: machine.machineId,
    machineName: machine.machineName,
    defaultHarnessId: machine.defaultHarnessId,
    harnesses,
  };
}

/**
 * Derive machine.json from a legacy dual-dispatcher config.json. Ports, entry,
 * Codex homes and --most importantly-- the *real* upstream tokens come from the
 * source file; nothing is invented. `spawnBackends:false` is the safe default
 * because those backends already belong to an external watchdog.
 */
function deriveMachineConfig({
  legacy,
  consoleConfig = {},
  existingMachine = null,
  machineId = "",
  machineName = "",
  origin = "",
  spawnBackends = false,
  rotateMachineToken = false,
  random = randomToken,
} = {}) {
  if (!legacy || !Array.isArray(legacy.devices) || legacy.devices.length === 0) {
    throw new Error("旧版配置缺少 devices 数组，无法导入真实 harness。");
  }
  if (legacy.devices.length > shared.MAX_HARNESSES) {
    throw new Error(`旧版配置最多支持 ${shared.MAX_HARNESSES} 个 harness。`);
  }
  const requestedDefault = clean(legacy.defaultDevice || legacy.defaultHarness || legacy.devices[0]?.key);
  const defaultId = safeId(requestedDefault, safeId(legacy.devices[0]?.key, "harness-1"));
  const publicRows = shared.normalizeHarnesses(legacy.devices.map((device, index) => ({
    id: device?.key || device?.id || device?.name || `harness-${index + 1}`,
    name: device?.label || device?.name || device?.key,
    token: device?.token || device?.accessCode,
    kind: device?.backend || device?.kind || (device?.key === "pidesk" ? "pi" : "codex"),
    defaultHarness: safeId(device?.key || device?.id || device?.name, "") === defaultId,
    online: null,
  })), defaultId);

  const harnesses = publicRows.map((publicRow, index) => {
    const device = legacy.devices[index] || {};
    const port = Number(device.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`旧版配置 harness ${publicRow.id} 的 port 无效`);
    }
    const spawn = spawnBackends && device.spawn !== false;
    const entry = clean(device.entry);
    if (spawn && !entry) throw new Error(`旧版配置 harness ${publicRow.id} 缺少 entry 路径`);
    return {
      id: publicRow.id,
      name: publicRow.name,
      token: publicRow.token,
      kind: publicRow.kind,
      port,
      entry,
      codexHome: clean(device.codexHome || device.codex_home),
      spawn,
      extraArgs: Array.isArray(device.extraArgs) ? device.extraArgs.slice(0, MAX_EXTRA_ARGS).map(String) : [],
    };
  });

  let stableToken = clean(existingMachine?.machineToken);
  if (rotateMachineToken || !stableToken || harnesses.some((item) => item.token === stableToken)) {
    stableToken = random();
    while (harnesses.some((item) => item.token === stableToken)) stableToken = random();
  }
  const stableId = clean(machineId)
    || clean(existingMachine?.machineId)
    || normalizeMachineId(consoleConfig.machineId || consoleConfig.machineName || os.hostname());
  const stableName = clean(machineName)
    || clean(consoleConfig.machineName)
    || clean(existingMachine?.machineName)
    || stableId;
  const publicUrl = shared.normalizeBaseUrl(origin || existingMachine?.publicUrl || "");
  const selected = publicRows.find((item) => item.defaultHarness) || publicRows[0];
  const result = {
    machineId: stableId,
    machineName: stableName,
    machineToken: stableToken,
    ...(existingMachine?.legacyMachineTokens?.length ? { legacyMachineTokens: existingMachine.legacyMachineTokens.slice() } : {}),
    defaultHarness: selected.id,
    harnesses,
  };
  if (publicUrl) result.publicUrl = publicUrl;
  return result;
}

/** Identity used by BOTH the QR and discovery verification. */
function pairingIdentity(config = {}, urls = {}) {
  const url = shared.firstValidUrl({
    url: explicitTransport(config) ? urls.publicUrl || urls.lan : config?.machineGateway?.origin,
    publicUrl: urls.publicUrl,
    lanUrl: urls.lan,
  });
  if (!gatewayMode(config)) {
    return {
      gatewayMode: false,
      machineId: shared.machineIdentity({ machineId: config.machineId, mid: config.mid, machineName: config.machineName }),
      machineName: shared.machineDisplayName({ machineName: config.machineName, machineId: config.machineId }),
      machineToken: clean(config.machineToken || config.accessCode),
      accessCode: clean(config.accessCode),
      url,
      machine: null,
    };
  }
  const machine = loadMachineConfig(config);
  return {
    gatewayMode: true,
    machineId: machine.machineId,
    machineName: machine.machineName,
    machineToken: machine.machineToken,
    accessCode: machine.machineToken,
    url: shared.firstValidUrl({
      url: explicitTransport(config) ? urls.publicUrl || urls.lan : config.machineGateway?.origin || machine.publicUrl,
      publicUrl: urls.publicUrl,
      lanUrl: urls.lan,
    }),
    machine,
  };
}

/** Offline proof that a QR built from this machine.json can pair to it. */
function validatePairingConsistency(machine, origin) {
  const payload = shared.machinePairingPayload({
    machineId: machine.machineId,
    machineName: machine.machineName,
    machineToken: machine.machineToken,
    url: origin,
  });
  const parsed = shared.parseMachinePairingPayload(payload);
  if (!parsed.ok) return { ok: false, code: parsed.code, error: parsed.error };
  const checked = shared.normalizeDiscovery(discoveryFor(machine), parsed.pairing);
  if (!checked.ok) return { ok: false, code: checked.code, error: checked.error };
  const expected = machine.harnesses.map((item) => `${item.id}:${item.token}`).sort().join("|");
  const actual = checked.machine.harnesses.map((item) => `${item.id}:${item.token}`).sort().join("|");
  if (expected !== actual) return { ok: false, code: "harness-mismatch", error: "发现结果与 machine.json 不一致" };
  if (checked.machine.defaultHarnessId !== machine.defaultHarnessId) {
    return { ok: false, code: "default-mismatch", error: "默认 harness 与 machine.json 不一致" };
  }
  return { ok: true, payload, pairing: parsed.pairing, machine: checked.machine };
}

async function requestJson(url, { token = "", fetchImpl = globalThis.fetch, timeoutMs = 2500 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { accept: "application/json" };
    if (token) headers["x-access-token"] = token; // header only; never in URL/logs
    const response = await fetchImpl(url, { headers, signal: controller.signal, cache: "no-store" });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    return { ok: false, status: 0, data: null, error: error?.name === "AbortError" ? "请求超时" : String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Decide whether a listener on the configured port is OUR v2 machine gateway.
 * A healthy /api/health alone is NOT enough: the legacy dual dispatcher can
 * answer it with the default harness token. We require both the gateway marker
 * and an authenticated /api/harnesses discovery that matches machine.json.
 */
async function checkGatewayDiscovery({
  origin,
  machine,
  fetchImpl = globalThis.fetch,
  timeoutMs = 2500,
} = {}) {
  const base = shared.normalizeBaseUrl(origin);
  if (!base) return { ok: false, code: "invalid-origin", error: "网关地址无效" };
  if (!machine?.machineId || !machine?.machineToken || !Array.isArray(machine?.harnesses)) {
    return { ok: false, code: "invalid-machine-config", error: "机器配置无效" };
  }
  const marker = await requestJson(`${base}${HEALTH_MARKER_PATH}`, { fetchImpl, timeoutMs });
  if (!marker.ok || marker.status !== 200 || marker.data?.ok !== true
    || marker.data?.protocol !== shared.PROTOCOL || marker.data?.version !== shared.VERSION
    || clean(marker.data?.machineId) !== machine.machineId
    || Number(marker.data?.harnessCount) !== machine.harnesses.length) {
    return { ok: false, code: "not-machine-gateway", error: "端口上的服务不是这台电脑的一机一码网关" };
  }
  const discovery = await requestJson(`${base}${shared.HARNESS_PATH}`, {
    token: machine.machineToken,
    fetchImpl,
    timeoutMs,
  });
  if (!discovery.ok || discovery.status !== 200) {
    return { ok: false, code: "discovery-unavailable", error: "机器访问码未通过发现接口校验" };
  }
  const pairing = {
    machineId: machine.machineId,
    machineName: machine.machineName,
    serverUrl: base,
    machineToken: machine.machineToken,
    discoverPath: shared.HARNESS_PATH,
  };
  const checked = shared.normalizeDiscovery(discovery.data, pairing);
  if (!checked.ok) return { ok: false, code: checked.code, error: checked.error };
  const expected = machine.harnesses.map((item) => `${item.id}:${item.token}`).sort().join("|");
  const actual = checked.machine.harnesses.map((item) => `${item.id}:${item.token}`).sort().join("|");
  if (expected !== actual || checked.machine.defaultHarnessId !== machine.defaultHarnessId) {
    return { ok: false, code: "discovery-mismatch", error: "运行中的网关与 machine.json 不一致，请重启网关" };
  }
  return {
    ok: true,
    machineId: machine.machineId,
    harnessCount: machine.harnesses.length,
    defaultHarnessId: machine.defaultHarnessId,
    harnesses: checked.machine.harnesses.map((item) => ({ id: item.id, name: item.name, kind: item.kind, online: item.online, defaultHarness: item.defaultHarness })),
  };
}

/** Spawn descriptor used by ServiceController when gateway mode is enabled. */
function gatewaySpawn(config) {
  const machinePath = machineConfigPath(config);
  const entry = clean(config?.machineGateway?.entryPath) || GATEWAY_ENTRY;
  const args = [
    entry,
    "--host", String(config?.host || "0.0.0.0"),
    "--port", String(Number(config?.port) || 8787),
    "--config", machinePath,
  ];
  if (config?.machineGateway?.spawnBackends !== true) args.push("--no-spawn");
  let machinePublicUrl = "";
  try { machinePublicUrl = loadMachineConfig(config).publicUrl; } catch {}
  const origin = shared.firstValidUrl({ url: config?.machineGateway?.origin, publicUrl: config?.publicUrl, lanUrl: machinePublicUrl });
  if (origin) args.push("--public-url", origin);
  return {
    nodePath: config?.nodePath || process.execPath,
    entry,
    args,
    cwd: config?.repoRoot || APP_DIR,
    machineConfigPath: machinePath,
  };
}

function validateGatewayRuntime(config) {
  const errors = [];
  try {
    const machine = loadMachineConfig(config);
    if (machine.harnesses.length > 1 && machine.harnesses.some((item) => item.token === machine.machineToken)) {
      errors.push("machine.json: 多 harness 模式下机器访问码不能与 harness 访问码相同");
    }
    const origin = shared.firstValidUrl({ url: config?.machineGateway?.origin, publicUrl: config?.publicUrl, lanUrl: `http://127.0.0.1:${Number(config?.port) || 8787}` });
    const consistency = validatePairingConsistency(machine, origin);
    if (!consistency.ok) errors.push(`二维码与发现结果不一致：${consistency.error || consistency.code}`);
  } catch (error) {
    errors.push(error.message);
    return errors;
  }
  const spawn = gatewaySpawn(config);
  if (!fs.existsSync(spawn.entry)) errors.push(`找不到机器网关入口：${spawn.entry}`);
  return errors;
}

/** Token used for /api/health, /api/threads, /api/debug/events (routed by gateway). */
function effectiveAccessToken(config) {
  if (!gatewayMode(config)) return clean(config?.accessCode);
  try {
    const machine = loadMachineConfig(config);
    const selected = machine.harnesses.find((item) => item.id === machine.defaultHarnessId) || machine.harnesses[0];
    return selected?.token || "";
  } catch {
    return "";
  }
}

/** Non-secret summary for publicConfig / renderer. */
function gatewaySummary(config) {
  const enabled = gatewayMode(config);
  const summary = {
    enabled,
    machineId: clean(config?.machineGateway?.machineId),
    machineName: clean(config?.machineGateway?.machineName),
    harnessCount: 0,
    defaultHarnessId: "",
    machineConfigPath: machineConfigPath(config),
    hasMachineToken: false,
    machineTokenMasked: "",
    origin: clean(config?.machineGateway?.origin),
    spawnBackends: Boolean(config?.machineGateway?.spawnBackends),
  };
  try {
    const machine = loadMachineConfig(config);
    summary.machineId = machine.machineId;
    summary.machineName = machine.machineName;
    summary.harnessCount = machine.harnesses.length;
    summary.defaultHarnessId = machine.defaultHarnessId;
    summary.hasMachineToken = Boolean(machine.machineToken);
    summary.machineTokenMasked = maskToken(machine.machineToken);
    if (!summary.origin && machine.publicUrl) summary.origin = machine.publicUrl;
  } catch {
    // A missing/invalid machine.json is surfaced by validateConfig / runtime,
    // not by silently downgrading to the legacy launcher.
  }
  return summary;
}

/** Token list for the logger redactor (no secrets are returned to callers). */
function machineSecrets(config) {
  if (!gatewayMode(config)) return [];
  try {
    const machine = loadMachineConfig(config);
    return [machine.machineToken, ...machine.harnesses.map((item) => item.token)].filter(Boolean);
  } catch {
    return [];
  }
}

function redactedPlan(machine) {
  return {
    machineId: machine.machineId,
    machineName: machine.machineName,
    defaultHarness: machine.defaultHarnessId,
    publicUrl: machine.publicUrl || "",
    machineTokenPresent: Boolean(machine.machineToken),
    machineTokenDistinctFromHarnesses: machine.harnesses.every((item) => item.token !== machine.machineToken),
    harnesses: machine.harnesses.map((item) => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
      port: item.port,
      tokenPresent: Boolean(item.token),
      spawn: item.spawn,
      hasEntry: Boolean(item.entry),
      hasCodexHome: Boolean(item.codexHome),
      extraArgCount: item.extraArgs.length,
    })),
  };
}

module.exports = {
  APP_DIR,
  CONFIG_DIR,
  DEFAULT_CONSOLE_CONFIG_PATH,
  DEFAULT_MACHINE_CONFIG_PATH,
  GATEWAY_ENTRY,
  HEALTH_MARKER_PATH,
  consoleConfigPath,
  machineConfigPath,
  gatewayMode,
  readJson,
  normalizeMachineId,
  normalizeMachineConfig,
  loadMachineConfig,
  discoveryFor,
  deriveMachineConfig,
  pairingIdentity,
  validatePairingConsistency,
  requestJson,
  checkGatewayDiscovery,
  gatewaySpawn,
  validateGatewayRuntime,
  effectiveAccessToken,
  gatewaySummary,
  machineSecrets,
  randomToken,
  maskToken,
  redactedPlan,
};
