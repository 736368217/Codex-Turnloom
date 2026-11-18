"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const MAX_LINES = 2000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

function stripAnsi(value) {
  return String(value || "").replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

function timestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function timeOnly(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

class LogBuffer extends EventEmitter {
  constructor({ logDir, secrets = [], maxLines = MAX_LINES } = {}) {
    super();
    this.logDir = logDir;
    this.maxLines = maxLines;
    this.lines = [];
    this.secrets = new Set(secrets.filter(Boolean));
    this.streams = new Map();
    this.seq = 0;
    this.ensureDir();
    this.rotateIfNeeded();
  }

  setSecrets(secrets = []) {
    this.secrets = new Set(secrets.filter(Boolean));
  }

  ensureDir() {
    try {
      fs.mkdirSync(this.logDir, { recursive: true });
    } catch {
      // The app can still run with an in-memory log if the directory is unavailable.
    }
  }

  rotateIfNeeded() {
    const names = ["console.log", "server-out.log", "server-error.log", "tunnel-out.log", "tunnel-error.log"];
    for (const name of names) {
      const file = path.join(this.logDir, name);
      try {
        if (fs.existsSync(file) && fs.statSync(file).size > MAX_FILE_BYTES) {
          fs.renameSync(file, `${file}.1`);
        }
      } catch {}
    }
  }

  redact(value) {
    let text = String(value ?? "");
    for (const secret of this.secrets) {
      if (secret) text = text.split(secret).join("[已隐藏]");
    }
    text = text.replace(/(access code|password|token|访问码)\s*[:=]\s*\S+/gi, "$1: [已隐藏]");
    return text;
  }

  streamFor(file) {
    if (!file) return null;
    let stream = this.streams.get(file);
    if (!stream) {
      try {
        stream = fs.createWriteStream(path.join(this.logDir, file), { flags: "a", encoding: "utf8" });
      } catch {
        stream = null;
      }
      this.streams.set(file, stream);
    }
    return stream;
  }

  append(source, level, message, file = "console.log") {
    const text = stripAnsi(this.redact(message)).replace(/\r?\n$/, "");
    if (!text) return null;
    const now = new Date();
    const entry = {
      id: ++this.seq,
      ts: now.getTime(),
      time: timeOnly(now),
      date: timestamp(now),
      source: source || "app",
      level: String(level || "info").toLowerCase(),
      message: text
    };
    this.lines.push(entry);
    if (this.lines.length > this.maxLines) this.lines.splice(0, this.lines.length - this.maxLines);
    const stream = this.streamFor(file);
    if (stream) {
      try { stream.write(`[${entry.date}] [${entry.level}] [${entry.source}] ${text}\n`); } catch {}
    }
    this.emit("line", entry);
    return entry;
  }

  info(source, message, file) { return this.append(source, "info", message, file); }
  warn(source, message, file) { return this.append(source, "warn", message, file); }
  error(source, message, file) { return this.append(source, "error", message, file); }

  getLines(limit = 500) {
    const count = Math.max(1, Math.min(Number(limit) || 500, this.maxLines));
    return this.lines.slice(-count);
  }

  exportText(limit = 2000) {
    return this.getLines(limit).map((line) => `[${line.date}] [${line.level.toUpperCase()}] [${line.source}] ${line.message}`).join("\r\n");
  }

  close() {
    for (const stream of this.streams.values()) {
      try { stream.end(); } catch {}
    }
    this.streams.clear();
  }
}

function splitLines(buffer, chunk, onLine) {
  const next = buffer + String(chunk || "");
  const parts = next.split(/\r?\n/);
  const rest = parts.pop() ?? "";
  for (const line of parts) {
    if (line.trim()) onLine(line);
  }
  return rest;
}

module.exports = { LogBuffer, splitLines, timestamp, timeOnly };
