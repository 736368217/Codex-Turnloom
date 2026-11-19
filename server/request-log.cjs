"use strict";

/**
 * Structured, bounded logging for the Turnloom host.
 *
 * Two streams share one directory (`%LOCALAPPDATA%\CodexPocket\logs` by
 * default, overridable with TURNLOOM_LOG_DIR):
 *
 *   server-YYYYMMDD.log          one JSON line per /api/* request
 *   phone/<machine>-<date>.jsonl diagnostics uploaded by the phone
 *
 * Both streams are written through scripts/bounded-log.cjs so a stuck client
 * cannot fill the disk: the day file rotates at 8 MiB with three generations,
 * the phone file keeps only its newest DIAGNOSTICS_MAX_FILE_LINES records.
 *
 * Everything here is pure except the two writers, so `test/server-logging.test.js`
 * can pin the redaction and bound rules without touching a real log directory.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { appendWithRotation } = require("../scripts/bounded-log.cjs");

const DAILY_LOG_MAX_BYTES = 8 * 1024 * 1024;
const DAILY_LOG_RETAIN = 3;
const DIAGNOSTICS_MAX_BYTES = 256 * 1024;
const DIAGNOSTICS_MAX_RECORDS = 200;
const DIAGNOSTICS_MAX_FIELD = 300;
const DIAGNOSTICS_MAX_RECORD_BYTES = 2 * 1024;
const DIAGNOSTICS_MAX_FILE_LINES = 1000;
const REQUEST_LOG_MAX_FIELD = 240;
const STACK_MAX_CHARS = 4000;

const LOG_LEVELS = new Set(["debug", "info", "warn", "error", "slow"]);

/**
 * Credentials leak into logs through query strings, bearer headers echoed
 * back in an error, and JSON bodies quoted inside an error message. Strip all
 * three shapes; never try to be clever about which field is "safe".
 */
const REDACTIONS = [
  [/([?&](?:token|accessCode|access_code|accesscode|login|password|code)=)[^&#\s"']+/gi, "$1***"],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1***"],
  [/("(?:accessToken|access_token|token|password|clientSecret|client_secret|authorization)"\s*:\s*")[^"]*(")/gi, "$1***$2"],
  [/((?:x-access-token|authorization)\s*[:=]\s*)[^\s,;]+/gi, "$1***"],
];

function localAppDataDir(env = process.env) {
  const explicit = String(env.LOCALAPPDATA || "").trim();
  if (explicit) return explicit;
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support");
  if (process.platform === "win32") return path.join(os.homedir(), "AppData", "Local");
  return path.join(os.homedir(), ".local", "share");
}

/** `%LOCALAPPDATA%\CodexPocket\logs`, or TURNLOOM_LOG_DIR when a test/operator overrides it. */
function resolveLogDir(env = process.env) {
  const explicit = String(env.TURNLOOM_LOG_DIR || env.CODEX_LAN_LOG_DIR || "").trim();
  if (explicit) return path.resolve(explicit);
  // `node --test` marks every test process (and everything it spawns) with
  // NODE_TEST_CONTEXT. A test that boots server.js must not append to the
  // machine's real log: those lines end up in the operator's "upload logs"
  // bundle and read like production 4xx/5xx that never happened.
  if (env.NODE_TEST_CONTEXT) return path.join(os.tmpdir(), "turnloom-test-logs");
  return path.join(localAppDataDir(env), "CodexPocket", "logs");
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

/** Local calendar day: a working session must not split across a UTC midnight. */
function dayStamp(date = new Date()) {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

function dailyLogPath(logDir, prefix, date = new Date()) {
  const safePrefix = String(prefix || "server").replace(/[^A-Za-z0-9._-]+/g, "-");
  return path.join(logDir, `${safePrefix}-${dayStamp(date)}.log`);
}

function redactText(value) {
  let text = String(value ?? "");
  for (const [pattern, replacement] of REDACTIONS) text = text.replace(pattern, replacement);
  return text;
}

/** Collapse control characters/whitespace so one record can never forge a second log line. */
function cleanString(value, max = REQUEST_LOG_MAX_FIELD) {
  const text = redactText(value)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

function statusNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.min(599, Math.round(number));
}

/**
 * One JSON-serializable record for a single request.
 *
 * `path` is the pathname only: access codes travel in the query string and the
 * query is never part of the record. Body text is never passed in here at all;
 * callers may add a `note` such as `images=2`, never content.
 */
function requestLogRecord(input = {}) {
  const at = input.at instanceof Date ? input.at : new Date(input.at || Date.now());
  const status = statusNumber(input.status);
  // A caller that forgets `level` still gets the correct severity; the status
  // code is the authority, not a separate field someone can mistype.
  const providedLevel = String(input.level || "").toLowerCase();
  const level = LOG_LEVELS.has(providedLevel) ? providedLevel : status >= 500 ? "error" : status >= 400 ? "warn" : "info";
  const record = {
    ts: at.toISOString(),
    source: cleanString(input.source || "server", 24) || "server",
    level,
    method: (cleanString(input.method, 10) || "GET").toUpperCase(),
    path: cleanString(String(input.path || input.pathname || "/").split("?")[0], 160) || "/",
    status,
    ms: Math.max(0, Math.round(Number(input.durationMs ?? input.ms) || 0)),
  };
  const harness = cleanString(input.harness, 40);
  const threadId = cleanString(input.threadId, 64);
  const code = cleanString(input.code, 40);
  const note = cleanString(input.note, 240);
  if (harness) record.harness = harness;
  if (threadId) record.threadId = threadId;
  if (code) record.code = code;
  if (note) record.note = note;
  // Only failures carry a stack; a successful request has nothing to diagnose
  // and the field would double the log size for no reason.
  if (record.level === "error" || record.status >= 500) {
    const stack = cleanString(input.stack, STACK_MAX_CHARS);
    if (stack) record.stack = stack;
  }
  return record;
}

function formatRequestLogLine(record) {
  return `${JSON.stringify(record)}\n`;
}

/**
 * Which conversation is this request about? Read it from the URL only, so the
 * log line can be written even when the request fails before the body parses.
 */
function threadIdFromRequestPath(pathname, searchParams = null) {
  const match = /^\/api\/threads\/([^/?#]+)/.exec(String(pathname || ""));
  const candidate = match ? decodeURIComponent(match[1]) : "";
  const fromQuery = String(searchParams?.get?.("threadId") || "").trim();
  for (const value of [candidate, fromQuery]) {
    if (/^[A-Za-z0-9._:-]{6,80}$/.test(value)) return value.slice(0, 64);
  }
  return "";
}

/**
 * Append one record to the day file. Never throws: a logging failure must not
 * turn a served request into a 500.
 */
function writeRequestLog(logDir, record, { date = new Date(), maxBytes = DAILY_LOG_MAX_BYTES, retain = DAILY_LOG_RETAIN } = {}) {
  const file = dailyLogPath(logDir, "server", date);
  try {
    appendWithRotation(file, formatRequestLogLine(record), { maxBytes, retain });
    return file;
  } catch {
    return "";
  }
}

function safeMachineName(value, fallback = "unknown") {
  // Unicode letters are kept: a Chinese machine name must stay recognisable in
  // the archive name, while path separators and control characters never are.
  const slug = cleanString(value, 64)
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[-.]+|-+$/g, "")
    .slice(0, 40);
  return slug || fallback;
}

const DIAGNOSTIC_STRING_FIELDS = ["at", "kind", "code", "path", "method", "message", "threadId", "appVersion", "device"];
const DIAGNOSTIC_KINDS = new Set(["send", "timeout", "auth", "compress", "transport", "other"]);

function sanitizeDetail(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return cleanString(value, DIAGNOSTICS_MAX_FIELD);
  if (typeof value === "object" && !Array.isArray(value)) {
    const output = {};
    let count = 0;
    for (const [key, item] of Object.entries(value)) {
      if (count >= 12) break;
      const name = cleanString(key, 40);
      if (!name) continue;
      if (typeof item === "number" && Number.isFinite(item)) output[name] = item;
      else if (typeof item === "boolean") output[name] = item;
      else if (typeof item === "string") output[name] = cleanString(item, DIAGNOSTICS_MAX_FIELD);
      count += 1;
    }
    return output;
  }
  return null;
}

/** Keep one phone record to the whitelisted shape; drop everything else. */
function sanitizeDiagnosticRecord(raw, { at = new Date() } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = {};
  for (const field of DIAGNOSTIC_STRING_FIELDS) {
    const value = cleanString(raw[field], field === "at" ? 40 : DIAGNOSTICS_MAX_FIELD);
    if (value) record[field] = value;
  }
  if (raw.status !== undefined) {
    const status = Number(raw.status);
    if (Number.isFinite(status) && status >= 0 && status <= 599) record.status = Math.round(status);
  }
  const detail = sanitizeDetail(raw.detail);
  if (detail && typeof detail === "object" && Object.keys(detail).length) record.detail = detail;
  // The phone sends its own request path; drop the query so an access code in
  // `?token=` is never archived.
  if (record.path) record.path = cleanString(record.path.split("?")[0], DIAGNOSTICS_MAX_FIELD);
  if (!record.at) record.at = at.toISOString();
  const kind = String(record.kind || "other").toLowerCase();
  record.kind = DIAGNOSTIC_KINDS.has(kind) ? kind : "other";
  if (!record.message && !record.code && !record.status && !record.detail) return null;
  if (Buffer.byteLength(JSON.stringify(record), "utf8") > DIAGNOSTICS_MAX_RECORD_BYTES) {
    // A single oversized record is trimmed rather than allowed to grow the
    // per-machine file without bound.
    if (record.message) record.message = record.message.slice(0, 240);
    delete record.detail;
    if (Buffer.byteLength(JSON.stringify(record), "utf8") > DIAGNOSTICS_MAX_RECORD_BYTES) return null;
  }
  return record;
}

/**
 * Validate a `POST /api/diagnostics` body.
 *
 * Returns the newest records that fit the per-request bound, plus how many
 * were dropped, so the phone can report what the host accepted.
 */
function sanitizeDiagnosticsRequest(payload, { now = new Date(), fallbackMachine = "", maxBytes = DIAGNOSTICS_MAX_BYTES } = {}) {
  const body = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const machine = safeMachineName(body.machine || body.machineName || body.device || fallbackMachine || "unknown");
  const incoming = Array.isArray(body.records) ? body.records : [];
  const candidates = incoming
    .slice(-DIAGNOSTICS_MAX_RECORDS)
    .map((record) => sanitizeDiagnosticRecord(record, { at: now }))
    .filter(Boolean);
  // `candidates` already holds only the newest records that survived both the
  // count bound and the whitelist, so one subtraction reports everything lost.
  let dropped = incoming.length - candidates.length;
  const kept = [];
  let bytes = 0;
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const line = `${JSON.stringify(candidates[index])}\n`;
    const size = Buffer.byteLength(line, "utf8");
    if (bytes + size > maxBytes) {
      dropped += index + 1;
      break;
    }
    bytes += size;
    kept.unshift(candidates[index]);
  }
  return {
    machine,
    appVersion: cleanString(body.appVersion, 40),
    device: cleanString(body.device, 60),
    records: kept,
    dropped,
  };
}

function phoneDiagnosticsPath(logDir, machine, date = new Date()) {
  return path.join(logDir, "phone", `${safeMachineName(machine)}-${dayStamp(date)}.jsonl`);
}

/** Keep the newest `maxLines` records; rewrite only once the file grows past a bound. */
function trimJsonlFile(file, { maxLines = DIAGNOSTICS_MAX_FILE_LINES } = {}) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return false;
  }
  const lines = raw.split("\n").filter((line) => line.trim());
  if (lines.length <= maxLines) return false;
  const kept = `${lines.slice(-maxLines).join("\n")}\n`;
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temp, kept, "utf8");
    fs.renameSync(temp, file);
    return true;
  } catch {
    try { fs.rmSync(temp, { force: true }); } catch {}
    return false;
  }
}

function countFileLines(file) {
  try {
    return fs.readFileSync(file, "utf8").split("\n").filter((line) => line.trim()).length;
  } catch {
    return 0;
  }
}

/**
 * Line counts are cached per file: counting every append would re-read the
 * whole archive, and the file is only trimmed when the count crosses the bound.
 */
const fileLineCounts = new Map();

/**
 * Append already-sanitized records to the per-machine phone log.
 * Returns `{ stored, dropped, file }`; never throws.
 */
function writePhoneDiagnostics(logDir, sanitized, { date = new Date(), maxLines = DIAGNOSTICS_MAX_FILE_LINES } = {}) {
  const records = Array.isArray(sanitized?.records) ? sanitized.records : [];
  const machine = safeMachineName(sanitized?.machine);
  const file = phoneDiagnosticsPath(logDir, machine, date);
  if (!records.length) return { stored: 0, dropped: Number(sanitized?.dropped) || 0, file: path.basename(file) };
  const payload = records.map((record) => JSON.stringify(record)).join("\n") + "\n";
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, payload, "utf8");
  } catch {
    return { stored: 0, dropped: records.length + (Number(sanitized?.dropped) || 0), file: path.basename(file) };
  }
  let count = fileLineCounts.get(file);
  if (count === undefined) count = countFileLines(file) - records.length;
  count += records.length;
  if (count > maxLines) {
    trimJsonlFile(file, { maxLines });
    count = Math.min(count, maxLines);
  }
  fileLineCounts.set(file, count);
  return { stored: records.length, dropped: Number(sanitized?.dropped) || 0, file: path.basename(file) };
}

module.exports = {
  DAILY_LOG_MAX_BYTES,
  DAILY_LOG_RETAIN,
  DIAGNOSTICS_MAX_BYTES,
  DIAGNOSTICS_MAX_RECORDS,
  DIAGNOSTICS_MAX_FILE_LINES,
  REQUEST_LOG_MAX_FIELD,
  localAppDataDir,
  resolveLogDir,
  dayStamp,
  dailyLogPath,
  redactText,
  cleanString,
  requestLogRecord,
  formatRequestLogLine,
  threadIdFromRequestPath,
  writeRequestLog,
  safeMachineName,
  sanitizeDiagnosticRecord,
  sanitizeDiagnosticsRequest,
  phoneDiagnosticsPath,
  trimJsonlFile,
  writePhoneDiagnostics,
};
