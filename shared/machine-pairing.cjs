"use strict";

/**
 * Codex-Turnloom machine-level pairing protocol (v2).
 *
 * One machine exposes ONE pairing QR. After the phone verifies the machine
 * token, GET /api/harnesses returns every harness on that machine. Each
 * harness carries its own opaque routing token; the phone stores them as
 * connections under the same machine identity and never asks for a second QR.
 *
 * This module is the single Node-side codec. Windows console, machine gateway,
 * CLI and tests all use it. The Flutter client mirrors the exact field rules
 * in lib/turnloom/turnloom_hosts.dart; keep both in sync.
 *
 * Security properties:
 *  - canonical QR form only (no userinfo, no fragment, no duplicate/unknown
 *    parameters, no dot-segments);
 *  - server URL is an http(s) ORIGIN only (no path/query/fragment/userinfo);
 *  - strict scalar types, bounded lengths, no control characters;
 *  - machine token and harness tokens are distinct in multi-harness setups;
 *  - discovery response must echo the QR's machineId;
 *  - exactly one default harness, honoring defaultHarnessId;
 *  - errors are machine-readable codes with fixed text (never echo tokens).
 */

const PROTOCOL = "codex-turnloom";
const VERSION = 2;
const QR_HOST = "pair";
const QR_ACTION = "add";
const MACHINE_QR_PREFIX = `${PROTOCOL}://${QR_HOST}/${QR_ACTION}`;
const HARNESS_PATH = "/api/harnesses";
const MAX_HARNESSES = 24;
const MAX_TOKEN_LENGTH = 256;
const MAX_NAME_LENGTH = 120;
const LEGACY_QR_PREFIX = "codexpocket://add";

const REQUIRED_QR_PARAMS = ["v", "protocol", "machine", "url", "token", "discover"];
const OPTIONAL_QR_PARAMS = ["mid", "name"];
const QR_PARAMS = new Set([...REQUIRED_QR_PARAMS, ...OPTIONAL_QR_PARAMS]);
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function cleanString(value) {
  return String(value ?? "").trim();
}

function isPlainString(value) {
  return typeof value === "string";
}

function hasControlChars(value) {
  return CONTROL_CHARS.test(String(value ?? ""));
}

/** Reject malformed QR payloads with a stable code; never include raw input. */
function fail(code, error) {
  return { ok: false, code, error };
}

/**
 * Normalize a server URL to an http(s) origin.
 * Explicit schemes other than http/https are rejected. Bare host[:port] is
 * accepted for LAN convenience. Path, query, fragment and userinfo are
 * rejected: /api/* paths are appended by clients and a query could smuggle a
 * token into logs and Referer headers.
 */
function normalizeBaseUrl(raw) {
  const trimmed = cleanString(raw).replace(/\/+$/, "");
  if (!trimmed) return "";
  if (hasControlChars(trimmed)) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) return "";
  // Bare host or host:port only (IPv4 / hostname / localhost). No slashes.
  const bare = /^[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(trimmed);
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : bare ? `http://${trimmed}` : "";
  if (!withScheme) return "";
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (url.username || url.password) return "";
    if (url.search || url.hash) return "";
    if (url.pathname !== "/" && url.pathname !== "") return "";
    return url.origin.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function safeHarnessId(raw, fallback) {
  const value = cleanString(raw)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return value || fallback;
}

function uniqueHarnessId(candidate, used, index) {
  let id = candidate;
  let suffix = index + 1;
  while (used.has(id)) {
    id = `${candidate}-${suffix}`;
    suffix += 1;
  }
  return id;
}

function strictBoolean(value) {
  return value === true;
}

/**
 * Normalize a harness list. Returns a new array containing only public
 * routing fields. Throws on invalid input so a malformed discovery response
 * can never be partially saved.
 *
 * @param {Array} list raw harness rows
 * @param {string|null} defaultHarnessId explicit default id from the response
 */
function normalizeHarnesses(list, defaultHarnessId = null) {
  if (!Array.isArray(list)) throw new Error("harnesses 必须是数组");
  if (list.length === 0) throw new Error("harnesses 不能为空");
  if (list.length > MAX_HARNESSES) throw new Error(`harnesses 最多 ${MAX_HARNESSES} 项`);

  const ids = new Set();
  const tokens = new Set();
  const result = [];
  for (const [index, row] of list.entries()) {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("harness 条目无效");
    if (!isPlainString(row.token) || !row.token.trim()) throw new Error("harness token 缺失");
    const token = row.token.trim();
    if (token.length > MAX_TOKEN_LENGTH || hasControlChars(token)) throw new Error("harness token 无效");
    if (tokens.has(token)) throw new Error("harness token 重复");
    tokens.add(token);

    const candidate = safeHarnessId(row.id || row.key || row.name, `harness-${index + 1}`);
    const id = uniqueHarnessId(candidate, ids, index);
    ids.add(id);

    const name = isPlainString(row.name) ? row.name.trim() : cleanString(row.label || row.key || id);
    const kind = isPlainString(row.kind) ? row.kind.trim() : cleanString(row.backend || "codex");
    if (hasControlChars(name) || hasControlChars(kind)) throw new Error("harness 字段包含控制字符");
    const online = row.online === undefined || row.online === null
      ? null
      : row.online === true || row.online === false
        ? row.online
        : (() => { throw new Error("harness online 必须是布尔值"); })();

    result.push({
      id,
      name: name.slice(0, 80) || id,
      token,
      kind: kind.slice(0, 40) || "codex",
      defaultHarness: strictBoolean(row.defaultHarness),
      online,
    });
  }

  let selected;
  if (defaultHarnessId !== null && defaultHarnessId !== undefined) {
    if (!isPlainString(defaultHarnessId) || !defaultHarnessId.trim()) throw new Error("defaultHarnessId 无效");
    selected = result.find((item) => item.id === defaultHarnessId.trim());
    if (!selected) throw new Error("defaultHarnessId 未指向任何 harness");
  } else {
    selected = result.find((item) => item.defaultHarness) || result[0];
  }
  for (const item of result) item.defaultHarness = item === selected;
  return result;
}

function machineIdentity(config = {}) {
  const value = cleanString(config.machineId || config.mid || config.machineName || config.hostname || "machine");
  if (!value || value.length > MAX_NAME_LENGTH || hasControlChars(value)) return "machine";
  return value;
}

function machineDisplayName(config = {}) {
  const value = cleanString(config.machineName || config.name || config.machineId || config.hostname || "Codex-Turnloom");
  if (!value || value.length > MAX_NAME_LENGTH || hasControlChars(value)) return "Codex-Turnloom";
  return value;
}

function firstValidUrl(config = {}) {
  for (const candidate of [config.url, config.publicUrl, config.lanUrl]) {
    const normalized = normalizeBaseUrl(candidate);
    if (normalized) return normalized;
  }
  return "";
}

/**
 * Build the ONE machine QR. `mid` is the stable machineId; `machine` is the
 * human-readable name. Legacy clients that only understand `machine` still
 * derive a usable id from it.
 */
function machinePairingPayload(config = {}) {
  const url = firstValidUrl(config);
  const token = cleanString(config.machineToken || config.accessCode);
  const machineId = machineIdentity(config);
  const machineName = machineDisplayName(config);
  if (!url) throw new Error("机器配对二维码需要有效的服务地址");
  if (!isPlainString(token) || !token.trim() || token.trim().length > MAX_TOKEN_LENGTH || hasControlChars(token)) {
    throw new Error("机器配对二维码需要有效的机器访问码");
  }
  const target = new URL(MACHINE_QR_PREFIX);
  target.searchParams.set("v", String(VERSION));
  target.searchParams.set("protocol", PROTOCOL);
  target.searchParams.set("machine", machineName);
  target.searchParams.set("mid", machineId);
  target.searchParams.set("url", url);
  target.searchParams.set("token", token.trim());
  target.searchParams.set("discover", HARNESS_PATH);
  return target.toString();
}

function canonicalQrPrefix(value) {
  const normalized = value.replace(/^([A-Za-z][A-Za-z0-9+.-]*):/, (match) => match.toLowerCase());
  return normalized.startsWith(`${MACHINE_QR_PREFIX}?`);
}

/** True for v1 payloads that callers should route to the legacy parser. */
function isLegacyPayload(raw) {
  const value = cleanString(raw);
  if (!value) return false;
  if (value.toLowerCase().startsWith(LEGACY_QR_PREFIX)) return true;
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
    return url.pathname === "/login" || hash.has("login") || url.searchParams.has("token");
  } catch {
    return false;
  }
}

/** Parse v2 machine QR. Legacy QRs are intentionally NOT parsed here. */
function parseMachinePairingPayload(raw) {
  const value = cleanString(raw);
  if (!value) return fail("empty", "二维码内容为空");
  if (value.length > 2048 || hasControlChars(value)) return fail("invalid-qr", "配对二维码格式无效");
  if (isLegacyPayload(value)) return fail("legacy-qr", "这是旧版单设备配对码，请使用旧版连接流程");
  if (!canonicalQrPrefix(value)) return fail("invalid-qr", "不是规范的 Codex-Turnloom 机器配对码");

  let url;
  try {
    url = new URL(value);
  } catch {
    return fail("invalid-qr", "不是有效的配对二维码");
  }
  if (url.protocol !== `${PROTOCOL}:`) return fail("invalid-scheme", "配对码协议无效");
  if (url.host !== QR_HOST) return fail("invalid-scheme", "配对码主机无效");
  if (url.pathname !== `/${QR_ACTION}`) return fail("invalid-action", "配对码操作类型无效");
  if (url.username || url.password || url.hash) return fail("invalid-qr", "配对码包含不允许的身份信息或片段");

  for (const key of url.searchParams.keys()) {
    if (!QR_PARAMS.has(key)) return fail("unknown-parameter", "配对码包含未知参数");
    if (url.searchParams.getAll(key).length !== 1) return fail("duplicate-parameter", "配对码参数重复");
  }
  for (const key of REQUIRED_QR_PARAMS) {
    if (!url.searchParams.has(key)) return fail("missing-parameter", "配对码缺少必要参数");
  }
  if (url.searchParams.get("v") !== String(VERSION)) return fail("unsupported-version", `仅支持 v${VERSION} 一机一码协议`);
  if (url.searchParams.get("protocol") !== PROTOCOL) return fail("invalid-protocol", "配对协议标识无效");
  if (url.searchParams.get("discover") !== HARNESS_PATH) return fail("invalid-discover", "配对二维码的发现接口无效");

  const serverUrl = normalizeBaseUrl(url.searchParams.get("url"));
  if (!serverUrl) return fail("invalid-server-url", "配对二维码缺少有效的服务根地址");

  const token = url.searchParams.get("token");
  if (!token || !token.trim() || token.trim().length > MAX_TOKEN_LENGTH || hasControlChars(token)) {
    return fail("invalid-token", "配对二维码缺少有效的机器访问码");
  }
  const machine = url.searchParams.get("machine");
  const mid = url.searchParams.get("mid");
  if (!machine || machine.length > MAX_NAME_LENGTH || hasControlChars(machine)) return fail("invalid-machine", "机器名称无效");
  if (mid !== null && (mid.length > MAX_NAME_LENGTH || hasControlChars(mid))) return fail("invalid-machine", "机器标识无效");

  return {
    ok: true,
    pairing: {
      protocol: PROTOCOL,
      version: VERSION,
      machineId: cleanString(mid) || cleanString(machine),
      machineName: cleanString(machine),
      serverUrl,
      machineToken: token.trim(),
      discoverPath: HARNESS_PATH,
    },
  };
}

/** Validate a discovery response before any credential is saved. */
function normalizeDiscovery(payload, pairing) {
  const body = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  if (!pairing || typeof pairing !== "object" || !pairing.machineId || !pairing.serverUrl || !pairing.machineToken) {
    return fail("missing-pairing", "缺少配对上下文，无法校验发现结果");
  }
  if (body.ok !== true) return fail("invalid-response", "发现接口返回失败");
  if (body.protocol !== PROTOCOL) return fail("invalid-protocol", "服务端不支持一机一码协议 v2");
  if (body.version !== VERSION) return fail("unsupported-version", `仅支持 v${VERSION} 一机一码协议`);
  if (!isPlainString(body.machineId) || !body.machineId.trim()) return fail("invalid-machine", "服务端未返回机器标识");
  if (body.machineId.trim() !== cleanString(pairing.machineId)) {
    return fail("machine-mismatch", "服务端返回的机器身份与二维码不一致");
  }
  if (body.machineName !== undefined && (!isPlainString(body.machineName) || hasControlChars(body.machineName))) {
    return fail("invalid-machine", "服务端返回的机器名称无效");
  }
  if (body.defaultHarnessId !== undefined && body.defaultHarnessId !== null && !isPlainString(body.defaultHarnessId)) {
    return fail("invalid-default", "服务端返回的默认 harness 无效");
  }
  let harnesses;
  try {
    harnesses = normalizeHarnesses(body.harnesses, body.defaultHarnessId || null);
  } catch (error) {
    return fail("invalid-harnesses", error?.message || "harness 列表无效");
  }
  if (harnesses.length > 1 && harnesses.some((item) => item.token === cleanString(pairing.machineToken))) {
    return fail("machine-token-reuse", "多 harness 模式下机器访问码不能同时作为 harness 访问码");
  }
  const selected = harnesses.find((item) => item.defaultHarness) || harnesses[0];
  return {
    ok: true,
    machine: {
      machineId: body.machineId.trim(),
      machineName: cleanString(body.machineName) || pairing.machineName || body.machineId.trim(),
      harnesses,
      defaultHarnessId: selected.id,
    },
  };
}

/** Produce a log-safe copy of any pairing/discovery result. */
function redactPairing(value) {
  const seen = new Set();
  function walk(node) {
    if (node === null || typeof node !== "object") return node;
    if (seen.has(node)) return "[circular]";
    seen.add(node);
    if (Array.isArray(node)) return node.map(walk);
    const out = {};
    for (const [key, child] of Object.entries(node)) {
      if (/^(token|machineToken|accessCode|payload|dataUrl)$/i.test(key)) out[key] = "***";
      else if (/^(url|serverUrl|publicUrl|lanUrl)$/i.test(key) && typeof child === "string" && /token|login|accessCode/i.test(child)) out[key] = "***";
      else out[key] = walk(child);
    }
    return out;
  }
  return walk(value);
}

module.exports = {
  PROTOCOL,
  VERSION,
  QR_HOST,
  QR_ACTION,
  MACHINE_QR_PREFIX,
  LEGACY_QR_PREFIX,
  HARNESS_PATH,
  MAX_HARNESSES,
  MAX_TOKEN_LENGTH,
  MAX_NAME_LENGTH,
  QR_PARAMS,
  REQUIRED_QR_PARAMS,
  cleanString,
  normalizeBaseUrl,
  normalizeHarnesses,
  machineIdentity,
  machineDisplayName,
  firstValidUrl,
  machinePairingPayload,
  parseMachinePairingPayload,
  normalizeDiscovery,
  isLegacyPayload,
  redactPairing,
};
