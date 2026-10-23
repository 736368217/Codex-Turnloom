"use strict";

const net = require("node:net");
const { execFile } = require("node:child_process");

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: options.timeout || 5000, ...options }, (error, stdout, stderr) => {
      resolve({ ok: !error, code: error?.code ?? 0, stdout: String(stdout || ""), stderr: String(stderr || ""), error });
    });
  });
}

async function requestJson(url, { token = "", timeoutMs = 2500 } = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { accept: "application/json" };
    if (token) headers["x-access-token"] = token;
    const response = await fetch(url, { headers, signal: controller.signal, cache: "no-store" });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    return { ok: response.ok, status: response.status, data, latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false, status: 0, data: null, latencyMs: Date.now() - started, error: error.name === "AbortError" ? "请求超时" : error.message };
  } finally {
    clearTimeout(timer);
  }
}

function apiBase(config) {
  return `http://127.0.0.1:${Number(config.port) || 8787}`;
}

async function checkHealth(config, options = {}) {
  const result = await requestJson(`${apiBase(config)}/api/health`, {
    token: config.accessCode,
    timeoutMs: options.timeoutMs || 2500
  });
  if (!result.ok || !result.data) {
    return { ...result, ok: false, error: result.error || `HTTP ${result.status}` };
  }
  return { ...result, ok: result.data.ok === true, data: result.data };
}

async function checkDebugEvents(config, options = {}) {
  return requestJson(`${apiBase(config)}/api/debug/events?limit=1`, {
    token: config.accessCode,
    timeoutMs: options.timeoutMs || 2500
  });
}

async function checkThreads(config, limit = 4) {
  return requestJson(`${apiBase(config)}/api/threads?limit=${Math.max(1, Math.min(Number(limit) || 4, 20))}`, {
    token: config.accessCode,
    timeoutMs: 5000
  });
}

async function waitForHealth(config, { timeoutMs = 15000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await checkHealth(config, { timeoutMs: 1500 });
    if (last.ok) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return last || { ok: false, error: "等待服务响应超时" };
}

function canConnect(port, host = "127.0.0.1", timeoutMs = 350) {
  return new Promise((resolve) => {
    const socket = net.connect({ port: Number(port), host });
    const finish = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function checkPortAvailable(port, host = "0.0.0.0") {
  // A process bound only to 127.0.0.1 can still receive loopback traffic even
  // when a second process binds 0.0.0.0, so probe loopback explicitly.
  if (await canConnect(port, "127.0.0.1")) {
    return { available: false, code: "EADDRINUSE", message: `端口 ${port} 已被本机其他服务占用。` };
  }
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", (error) => resolve({ available: false, code: error.code, message: error.message }));
    server.listen({ port: Number(port), host, exclusive: true }, () => {
      server.close(() => resolve({ available: true }));
    });
  });
}

async function findPortOwner(port) {
  const netstat = await execFileAsync("netstat.exe", ["-ano"], { timeout: 5000 });
  if (!netstat.ok) return null;
  const lines = netstat.stdout.split(/\r?\n/);
  const suffix = `:${port}`;
  for (const line of lines) {
    if (!line.includes("LISTENING")) continue;
    const parts = line.trim().split(/\s+/);
    const local = parts[1] || "";
    if (!local.endsWith(suffix)) continue;
    const pid = Number(parts[parts.length - 1]);
    if (!pid) continue;
    const task = await execFileAsync("tasklist.exe", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { timeout: 3000 });
    const name = task.ok ? (task.stdout.match(/^"([^"]+)"/)?.[1] || "") : "";
    return { pid, name, local };
  }
  return null;
}

async function getProcessMetrics(pid) {
  if (!pid) return null;
  const result = await execFileAsync("tasklist.exe", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { timeout: 3000 });
  if (!result.ok) return null;
  const line = result.stdout.trim().split(/\r?\n/)[0] || "";
  const match = line.match(/^"([^"]+)","([^"]+)","([^"]+)","([^"]+)","([^"]+)"/);
  if (!match) return null;
  const memoryKb = Number(String(match[5]).replace(/[^\d]/g, "")) || 0;
  return { name: match[1], pid: Number(match[2]), memoryBytes: memoryKb * 1024 };
}

module.exports = {
  requestJson,
  checkHealth,
  checkDebugEvents,
  checkThreads,
  waitForHealth,
  checkPortAvailable,
  findPortOwner,
  getProcessMetrics,
  execFileAsync
};
