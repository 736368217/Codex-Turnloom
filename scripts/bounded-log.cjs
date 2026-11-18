"use strict";

/**
 * Small synchronous rolling logger for detached Windows services.
 *
 * Windows FileSystemObject / cmd redirections keep an inherited file handle;
 * trimLargeFile only shortens the file in place, while appendWithRotation
 * protects logs that this process opens for every line. The retained size is
 * bounded by maxBytes * (retain + 1).
 */
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_RETAIN = 3;
const DEFAULT_TAIL_BYTES = 512 * 1024;

function positiveInteger(value, fallback) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

function trimLargeFile(filePath, options = {}) {
  const maxBytes = positiveInteger(options.maxBytes, DEFAULT_MAX_BYTES);
  const tailBytes = positiveInteger(options.tailBytes, DEFAULT_TAIL_BYTES);
  let size;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    return false;
  }
  if (size <= maxBytes) return false;

  // Keep the newest bytes for inherited stdout/stderr handles. A truncated
  // name is less surprising than a file that silently keeps growing forever.
  const keep = Math.min(tailBytes, Math.floor(maxBytes / 2), size);
  const fd = fs.openSync(filePath, "r+");
  let read = 0;
  try {
    if (keep > 0) {
      const buffer = Buffer.allocUnsafe(keep);
      while (read < keep) {
        const n = fs.readSync(fd, buffer, read, keep - read, size - keep + read);
        if (!n) break;
        read += n;
      }
      let written = 0;
      while (written < read) {
        const n = fs.writeSync(fd, buffer, written, read - written, written);
        if (!n) break;
        written += n;
      }
    }
    fs.ftruncateSync(fd, read);
  } finally {
    fs.closeSync(fd);
  }
  return true;
}

function trimGenerations(filePath, maxBytes, retain) {
  const tailBytes = Math.min(DEFAULT_TAIL_BYTES, Math.floor(maxBytes / 2));
  for (let index = 1; index <= retain; index += 1) {
    try {
      trimLargeFile(`${filePath}.${index}`, { maxBytes, tailBytes });
    } catch {}
  }
}

function appendWithRotation(filePath, text, options = {}) {
  const maxBytes = positiveInteger(options.maxBytes, DEFAULT_MAX_BYTES);
  const retain = positiveInteger(options.retain, DEFAULT_RETAIN);
  const raw = Buffer.isBuffer(text) ? text : Buffer.from(String(text), "utf8");
  const bytes = raw.length > maxBytes ? raw.subarray(raw.length - maxBytes) : raw;
  const tailBytes = Math.min(DEFAULT_TAIL_BYTES, Math.floor(maxBytes / 2));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  let size = 0;
  try {
    size = fs.statSync(filePath).size;
  } catch {}
  if (size + bytes.length > maxBytes) {
    // An unbounded file from an older release must never become an unbounded
    // .1 generation. Shorten it before rotating, and bound all generations.
    try {
      trimLargeFile(filePath, { maxBytes, tailBytes });
    } catch {}
    for (let index = retain; index >= 1; index -= 1) {
      const source = index === 1 ? filePath : `${filePath}.${index - 1}`;
      const target = `${filePath}.${index}`;
      try {
        fs.rmSync(target, { force: true });
        fs.renameSync(source, target);
      } catch {}
    }
    try {
      fs.rmSync(filePath, { force: true });
    } catch {}
    // A Windows inherited handle can prevent the rename above. Truncating in
    // place is safe for append-mode handles and still enforces the hard bound.
    try {
      trimLargeFile(filePath, { maxBytes, tailBytes });
    } catch {}
    trimGenerations(filePath, maxBytes, retain);
  }
  fs.appendFileSync(filePath, bytes);
  return filePath;
}

function cliNumber(args, name, fallback) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === name) return positiveInteger(args[index + 1], fallback);
    if (arg.startsWith(`${name}=`)) return positiveInteger(arg.slice(name.length + 1), fallback);
  }
  return fallback;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const action = args[0];
  const file = args[1];
  if (action === "--trim" && file) {
    const maxBytes = cliNumber(args, "--max-bytes", DEFAULT_MAX_BYTES);
    const tailBytes = cliNumber(args, "--tail-bytes", DEFAULT_TAIL_BYTES);
    const changed = trimLargeFile(file, { maxBytes, tailBytes });
    process.stdout.write(`${changed ? "trimmed" : "unchanged"} ${file} max=${maxBytes} tail=${tailBytes}\n`);
  } else {
    process.stderr.write("usage: node bounded-log.cjs --trim <file> [--max-bytes N] [--tail-bytes N]\n");
    process.exit(1);
  }
}

module.exports = {
  DEFAULT_MAX_BYTES,
  DEFAULT_RETAIN,
  DEFAULT_TAIL_BYTES,
  appendWithRotation,
  trimLargeFile,
};
