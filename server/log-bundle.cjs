/**
 * Log bundle for the desktop console ("上传日志").
 *
 * What goes in: the server's own request log and the phone diagnostics the
 * server already archived. Both are JSON lines with a known record shape, so the
 * bundle is built from an **allowlist** of fields instead of trying to guess
 * which free text is a secret. Message bodies, notes and stack traces are not
 * copied at all — a marker like `QA-SECRET-…` cannot leak because the field that
 * would carry it never enters the archive.
 *
 * The zip is store-only (no compression) on purpose: no dependency, and the
 * entries are small text files.
 */

const fs = require("node:fs");
const { existsSync } = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { resolveLogDir } = require("./request-log.cjs");

const MAX_FILES = 24;
const MAX_SERVER_FILES = 2;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const SUPERVISOR_TAIL_BYTES = 512 * 1024;

/** Request-log fields that are safe: timing, route, status, codes. */
const SERVER_FIELDS = ["ts", "source", "level", "method", "path", "status", "ms", "harness", "threadId", "code"];
/** Phone diagnostics: same idea; `message`/`detail` are where user text lives. */
const PHONE_FIELDS = ["at", "kind", "phase", "path", "code", "status", "appVersion", "machine"];

function redactSecrets(text, secrets) {
  let out = String(text ?? "");
  for (const secret of secrets) {
    if (!secret || secret.length < 4) continue;
    out = out.split(secret).join("[redacted]");
  }
  return out;
}

function pickFields(record, fields, secrets) {
  const out = {};
  for (const field of fields) {
    const value = record?.[field];
    if (typeof value === "string" && value) out[field] = redactSecrets(value, secrets).slice(0, 200);
    else if (typeof value === "number" && Number.isFinite(value)) out[field] = value;
  }
  return out;
}

function scrubLine(line, fields, secrets) {
  const text = String(line || "").trim();
  if (!text) return "";
  let record;
  try {
    record = JSON.parse(text);
  } catch {
    return "";
  }
  if (!record || typeof record !== "object" || Array.isArray(record)) return "";
  const picked = pickFields(record, fields, secrets);
  return Object.keys(picked).length ? JSON.stringify(picked) : "";
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc ^= buffer[index];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: day };
}

/** Store-only zip; entries are text files, so compression would buy little. */
function zipStore(entries, now = new Date()) {
  const { time, date } = dosTime(now);
  const local = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(String(entry.path).replace(/\\/g, "/"), "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), "utf8");
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6); // UTF-8 names
    header.writeUInt16LE(0, 8); // store
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    local.push(header, name, data);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(0, 10);
    dir.writeUInt16LE(time, 12);
    dir.writeUInt16LE(date, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt16LE(0, 30);
    dir.writeUInt16LE(0, 32);
    dir.writeUInt16LE(0, 34);
    dir.writeUInt16LE(0, 36);
    dir.writeUInt32LE(0, 38);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += header.length + name.length + data.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...local, centralBuffer, end]);
}

function listByMtime(dir, filter) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && filter(entry.name))
    .map((entry) => {
      const full = path.join(dir, entry.name);
      let stat = null;
      try { stat = fs.statSync(full); } catch { stat = null; }
      return stat ? { full, name: entry.name, size: stat.size, mtimeMs: stat.mtimeMs } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function digest(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

function readScrubbed(file, fields, secrets, budget) {
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch { return { text: "", kept: 0, dropped: 0 }; }
  if (raw.length > budget) {
    raw = raw.slice(raw.length - budget);
    const cut = raw.indexOf("\n");
    raw = cut >= 0 ? raw.slice(cut + 1) : "";
  }
  const lines = raw.split(/\r?\n/);
  const kept = [];
  let dropped = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    const scrubbed = scrubLine(line, fields, secrets);
    if (scrubbed) kept.push(scrubbed);
    else dropped += 1;
  }
  return { text: kept.join("\n") + (kept.length ? "\n" : ""), kept: kept.length, dropped };
}

/**
 * Build the archive. `now`/`logDir` are injectable so tests can pin both.
 * @returns {{name: string, buffer: Buffer, files: Array<{path: string, bytes: number}>, droppedLines: number}}
 */
function buildLogBundle({ logDir = resolveLogDir(), machine = "machine", now = new Date(), secrets = [] } = {}) {
  const stamp = now.toISOString().replace(/[:.]/g, "-").replace("T", "_").replace("Z", "");
  const safeMachine = String(machine || "machine").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 40) || "machine";
  const entries = [];
  const files = [];
  let budget = MAX_TOTAL_BYTES;
  let droppedLines = 0;

  const serverFiles = listByMtime(logDir, (name) => /^server-\d{8}\.log$/.test(name)).slice(0, MAX_SERVER_FILES);
  for (const file of serverFiles) {
    const text = readScrubbed(file.full, SERVER_FIELDS, secrets, Math.min(MAX_FILE_BYTES, budget));
    if (!text.text) { droppedLines += text.dropped; continue; }
    budget -= text.text.length;
    entries.push({ path: `server/${file.name}`, data: text.text });
    files.push({ path: `server/${file.name}`, bytes: Buffer.byteLength(text.text), sha256: digest(text.text) });
    droppedLines += text.dropped;
  }

  const phoneFiles = listByMtime(path.join(logDir, "phone"), (name) => /\.jsonl$/.test(name)).slice(0, MAX_FILES);
  for (const file of phoneFiles) {
    const text = readScrubbed(file.full, PHONE_FIELDS, secrets, Math.min(MAX_FILE_BYTES, budget));
    if (!text.text) { droppedLines += text.dropped; continue; }
    budget -= text.text.length;
    entries.push({ path: `phone/${file.name}`, data: text.text });
    files.push({ path: `phone/${file.name}`, bytes: Buffer.byteLength(text.text), sha256: digest(text.text) });
    droppedLines += text.dropped;
  }

  // The console supervisor log is free text ("Starting tunnel to <host>; …") and
  // grows without bound (4.7 MB on the live box). Keep the last 512 KB, cut on a
  // line boundary, and copy only timestamp/source — the message becomes
  // "[text omitted]". Truncation is recorded as a fact in the manifest.
  const supervisor = path.join(logDir, "supervisor.log");
  if (existsSync(supervisor)) {
    let raw = "";
    let fromBytes = 0;
    let truncated = false;
    try {
      const stat = fs.statSync(supervisor);
      const start = Math.max(0, stat.size - SUPERVISOR_TAIL_BYTES);
      truncated = start > 0;
      const handle = fs.openSync(supervisor, "r");
      try {
        const length = stat.size - start;
        const buffer = Buffer.alloc(length);
        fs.readSync(handle, buffer, 0, length, start);
        raw = buffer.toString("utf8");
        fromBytes = start;
      } finally {
        fs.closeSync(handle);
      }
    } catch { raw = ""; }
    if (truncated) {
      // Never start with half a line: drop up to the first newline.
      const cut = raw.indexOf("\n");
      raw = cut >= 0 ? raw.slice(cut + 1) : "";
    }
    const kept = [];
    for (const line of raw.split(/\r?\n/)) {
      const match = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) \[([A-Za-z0-9._-]+)\] /.exec(line.trim());
      if (match) kept.push(`${match[1]} [${match[2]}] [text omitted]`);
    }
    if (kept.length) {
      const text = `${kept.join("\n")}\n`;
      entries.push({ path: "supervisor/supervisor.log", data: text });
      files.push({ path: "supervisor/supervisor.log", bytes: Buffer.byteLength(text), sha256: digest(text), truncated, fromBytes });
    }
  }

  const totalBytes = entries.reduce((sum, entry) => sum + Buffer.byteLength(entry.data), 0);
  const manifest = {
    product: "codex-turnloom",
    generatedAt: now.toISOString(),
    machine: safeMachine,
    fields: { server: SERVER_FIELDS, phone: PHONE_FIELDS },
    note: "Only allowlisted fields are copied; message text, notes and stacks are dropped. supervisor.log keeps only timestamp/source.",
    limits: { totalBytes: MAX_TOTAL_BYTES, serverFiles: MAX_SERVER_FILES, supervisorTailBytes: SUPERVISOR_TAIL_BYTES },
    totalBytes,
    files,
    droppedLines,
  };
  entries.unshift({ path: "manifest.json", data: `${JSON.stringify(manifest, null, 2)}\n` });
  const name = `logs-${safeMachine}-${stamp}.zip`;
  return { name, buffer: zipStore(entries, now), files, droppedLines };
}

module.exports = { buildLogBundle, zipStore, scrubLine, redactSecrets, crc32, SERVER_FIELDS, PHONE_FIELDS };




