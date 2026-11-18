"use strict";

/**
 * Server-side logging and error-contract evidence for 2.2.1.
 *
 * Two layers, deliberately separated:
 *   1. `server/request-log.cjs` unit tests — redaction and hard bounds are the
 *      properties that must never regress, and they need no sockets.
 *   2. a real `node server.js` process — the request line must actually land in
 *      `logs\server-YYYYMMDD.log`, and `/api/diagnostics` must actually write
 *      `logs\phone\<machine>-<date>.jsonl`, not just return a JSON body.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const requestLog = require("../server/request-log.cjs");
const machineGateway = require("../server/machine-gateway.cjs");

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = "server-logging-probe";

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function readLines(file) {
  return fs.readFileSync(file, "utf8").split("\n").filter((line) => line.trim());
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function seedHome(home) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(home, "state_5.sqlite"));
  db.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT, rollout_path TEXT, updated_at_ms INTEGER, cwd TEXT);");
  db.close();
}

async function waitForReady(baseUrl) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      // `/api/health` needs the access code on both the codex and http backend
      // paths; `/api/app/update-public` is shadowed by the http backend router.
      const response = await fetch(`${baseUrl}/api/health`, { headers: { "x-access-token": TOKEN } });
      if (response.status === 200) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("server did not become ready within 30s");
}

async function startServer({ logDir, extraArgs = [], env = {} }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-logging-home-"));
  await seedHome(home);
  const port = await freePort();
  const child = spawn(
    process.execPath,
    ["server.js", "--port", String(port), "--host", "127.0.0.1", "--token", TOKEN, "--codex-home", home, ...extraArgs],
    {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, TURNLOOM_LOG_DIR: logDir, LOCALAPPDATA: path.join(logDir, "localappdata"), ...env },
    }
  );
  let log = "";
  child.stdout.on("data", (chunk) => { log += chunk.toString(); });
  child.stderr.on("data", (chunk) => { log += chunk.toString(); });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForReady(baseUrl);
  } catch (error) {
    child.kill("SIGTERM");
    throw new Error(`${error.message}\n--- server log ---\n${log}`);
  }
  return {
    baseUrl,
    log: () => log,
    stop: async () => {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5000);
        child.once("exit", () => { clearTimeout(timer); resolve(); });
      });
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

/** A structurally valid PNG header with arbitrary dimensions, padded past the 512-byte floor. */
function pngBytes(width, height) {
  const buffer = Buffer.alloc(1024);
  buffer.write("89504e470d0a1a0a", 0, "hex");
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  buffer[24] = 8; // bit depth
  buffer[25] = 6; // colour type
  return buffer;
}

function apiPost(baseUrl, pathname, body, { token = TOKEN, raw = false } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers["x-access-token"] = token;
  return fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers,
    body: raw ? body : JSON.stringify(body),
  }).then(async (response) => ({ status: response.status, body: await response.json().catch(() => null) }));
}

test("request records keep routing facts and drop tokens, query strings and message text", () => {
  const record = requestLog.requestLogRecord({
    source: "server",
    level: "warn",
    method: "post",
    pathname: "/api/send?token=secret-access-code&login=1",
    status: 400,
    durationMs: 12.6,
    harness: "de",
    threadId: "thread-1",
    code: "image_dimensions_out_of_range",
    note: "images=1",
    stack: "Error: boom\n  Authorization: Bearer abc.def.ghi\n  x-access-token: super-secret",
  });
  assert.equal(record.method, "POST");
  assert.equal(record.path, "/api/send");
  assert.equal(record.status, 400);
  assert.equal(record.ms, 13);
  assert.equal(record.harness, "de");
  assert.equal(record.threadId, "thread-1");
  assert.equal(record.code, "image_dimensions_out_of_range");
  assert.equal(record.note, "images=1");
  assert.equal("stack" in record, false, "a 400 does not need a stack");
  const serialized = JSON.stringify(record);
  assert.equal(serialized.includes("secret-access-code"), false);
  assert.equal(serialized.includes("\n"), false);

  const failed = requestLog.requestLogRecord({
    level: "error",
    status: 500,
    pathname: "/api/send",
    stack: "Error: boom\n  Authorization: Bearer abc.def.ghi\n  x-access-token: super-secret",
  });
  assert.equal(typeof failed.stack, "string");
  assert.equal(failed.stack.includes("abc.def.ghi"), false);
  assert.equal(failed.stack.includes("super-secret"), false);
});

test("one request is exactly one JSON line and the day file rotates on a size bound", () => {
  withTempDir("turnloom-request-log-", (dir) => {
    const date = new Date(2026, 10, 18, 21, 20, 0);
    const file = requestLog.writeRequestLog(dir, requestLog.requestLogRecord({
      method: "GET", pathname: "/api/threads", status: 200, durationMs: 3,
    }), { date, maxBytes: 400, retain: 2 });
    assert.equal(path.basename(file), "server-20261118.log");
    const lines = readLines(file);
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).path, "/api/threads");

    for (let index = 0; index < 40; index += 1) {
      requestLog.writeRequestLog(dir, requestLog.requestLogRecord({
        method: "POST", pathname: "/api/send", status: 400, durationMs: index,
        code: "image_too_large", threadId: `thread-${index}`,
      }), { date, maxBytes: 400, retain: 2 });
    }
    for (const name of fs.readdirSync(dir)) {
      assert.ok(fs.statSync(path.join(dir, name)).size <= 400, `${name} exceeded the byte bound`);
    }
    assert.deepEqual(fs.readdirSync(dir).sort(), ["server-20261118.log", "server-20261118.log.1", "server-20261118.log.2"]);
    const last = JSON.parse(readLines(path.join(dir, "server-20261118.log")).at(-1));
    assert.equal(last.level, "warn");
    assert.equal(last.code, "image_too_large");
  });
});

test("diagnostics keep only whitelisted, redacted, bounded records", () => {
  const now = new Date(2026, 10, 18, 21, 20, 0);
  const sanitized = requestLog.sanitizeDiagnosticsRequest({
    machine: "736-WIN / 主机",
    appVersion: "2.2.1",
    records: [
      {
        kind: "send",
        status: 400,
        code: "image_dimensions_out_of_range",
        path: "/api/send?token=leaked",
        message: "图片尺寸超出电脑端限制（单边 16–4096px）",
        token: "must-not-survive",
        detail: { bytes: 812345, edge: 2048, note: "x".repeat(900) },
      },
      { kind: "not-a-kind", message: "Bearer abc.def.ghi 被拒", status: 401 },
      { nothing: "useful" },
      "not-an-object",
    ],
  }, { now, fallbackMachine: "fallback" });

  assert.equal(sanitized.machine, "736-WIN-主机");
  assert.equal(sanitized.appVersion, "2.2.1");
  assert.equal(sanitized.records.length, 2, "records without any diagnostic field are dropped");
  const [send, auth] = sanitized.records;
  assert.equal(send.kind, "send");
  assert.equal(send.path, "/api/send", "the query string is stripped from a phone-supplied path");
  assert.equal("token" in send, false);
  assert.equal(send.detail.bytes, 812345);
  assert.ok(send.detail.note.length <= 301);
  assert.equal(auth.kind, "other");
  assert.equal(auth.message.includes("abc.def.ghi"), false);
  assert.equal(sanitized.dropped, 2);
});

test("diagnostics cap the batch, drop the oldest and never throw on a broken directory", () => {
  const now = new Date(2026, 10, 18, 21, 20, 0);
  const records = Array.from({ length: 260 }, (_, index) => ({ kind: "send", status: 500, message: `failure-${index}` }));
  const sanitized = requestLog.sanitizeDiagnosticsRequest({ machine: "m", records }, { now });
  assert.equal(sanitized.records.length, requestLog.DIAGNOSTICS_MAX_RECORDS);
  assert.equal(sanitized.records[0].message, "failure-60");
  assert.equal(sanitized.dropped, 60);

  withTempDir("turnloom-phone-log-", (dir) => {
    const file = path.join(dir, "phone", `m-${requestLog.dayStamp(now)}.jsonl`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const seeded = [];
    for (let index = 0; index < 20; index += 1) seeded.push(JSON.stringify({ at: now.toISOString(), kind: "send", message: `old-${index}` }));
    fs.writeFileSync(file, `${seeded.join("\n")}\n`);
    const written = requestLog.writePhoneDiagnostics(dir, { machine: "m", records: [{ at: now.toISOString(), kind: "send", message: "new" }], dropped: 0 }, { date: now, maxLines: 5 });
    assert.equal(written.stored, 1);
    assert.equal(written.file, path.basename(file));
    const lines = readLines(file);
    assert.equal(lines.length, 5);
    assert.equal(JSON.parse(lines.at(-1)).message, "new");

    const missing = requestLog.writePhoneDiagnostics(path.join(dir, "nested", "..", "missing-root"), { machine: "m", records: [{ kind: "send", message: "x" }] }, { date: now });
    assert.equal(missing.stored, 1, "a fresh directory is created on demand");
  });
});

test("log directory resolution follows the documented Windows location and its override", () => {
  assert.equal(
    requestLog.resolveLogDir({ LOCALAPPDATA: "C:\\Users\\probe\\AppData\\Local" }),
    path.join("C:\\Users\\probe\\AppData\\Local", "CodexPocket", "logs")
  );
  assert.equal(requestLog.resolveLogDir({ LOCALAPPDATA: "C:\\x", TURNLOOM_LOG_DIR: "D:\\logs" }), path.resolve("D:\\logs"));
  assert.equal(requestLog.phoneDiagnosticsPath("D:\\logs", "736-WIN / 主机", new Date(2026, 10, 18, 12, 0, 0)), path.join("D:\\logs", "phone", "736-WIN-主机-20261118.jsonl"));
});

test("thread ids come from the URL without ever reading the body", () => {
  assert.equal(requestLog.threadIdFromRequestPath("/api/threads/019a2b3c-4d5e-7f80-9abc-def012345678/messages"), "019a2b3c-4d5e-7f80-9abc-def012345678");
  assert.equal(requestLog.threadIdFromRequestPath("/api/queue/image", new URLSearchParams("threadId=thread-abc&itemId=1")), "thread-abc");
  assert.equal(requestLog.threadIdFromRequestPath("/api/send"), "");
});

test("the running server writes one log line per /api request and archives phone diagnostics", async (t) => {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-server-log-"));
  t.after(() => fs.rmSync(logDir, { recursive: true, force: true }));
  const server = await startServer({ logDir });
  t.after(server.stop);

  // 1. A real oversized photo is rejected with a Chinese reason and a stable code.
  const image = { name: "IMG_20261118_184957.jpg", mimeType: "image/png", data: pngBytes(4032, 3024).toString("base64") };
  const send = await apiPost(server.baseUrl, "/api/send", {
    threadId: "thread-abc123",
    message: "",
    images: [image],
    clientRequestId: "logging-probe-1",
  });
  assert.equal(send.status, 400, JSON.stringify(send.body));
  assert.equal(send.body?.code, "image_dimensions_out_of_range");
  assert.match(send.body?.error || "", /图片尺寸超出电脑端限制/);
  assert.equal((send.body?.error || "").includes("HTTP-400"), false);

  // 2. An unauthenticated call still carries a machine code.
  const unauthorized = await apiPost(server.baseUrl, "/api/send", { threadId: "t" }, { token: "" });
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.body?.code, "unauthorized");

  // 3. Diagnostics land in logs\phone\<machine>-<date>.jsonl.
  const diagnostics = await apiPost(server.baseUrl, "/api/diagnostics", {
    machine: "736-WIN",
    appVersion: "2.2.1",
    records: [
      { kind: "send", status: 400, code: "image_dimensions_out_of_range", path: "/api/send", message: "图片尺寸超出电脑端限制", detail: { bytes: 812345, edge: 4032 } },
      { kind: "timeout", status: 0, message: "请求超时（30s）", detail: { timeoutMs: 30000 } },
    ],
  });
  assert.equal(diagnostics.status, 200, JSON.stringify(diagnostics.body));
  assert.equal(diagnostics.body?.ok, true);
  assert.equal(diagnostics.body?.stored, 2);
  const phoneFile = path.join(logDir, "phone", diagnostics.body.file);
  const phoneLines = readLines(phoneFile);
  assert.equal(phoneLines.length, 2);
  assert.equal(JSON.parse(phoneLines[0]).kind, "send");
  assert.equal(JSON.parse(phoneLines[1]).detail.timeoutMs, 30000);

  // 4. The hard 256 KiB body bound is enforced before parsing.
  const oversized = await apiPost(server.baseUrl, "/api/diagnostics", JSON.stringify({ records: [{ kind: "send", message: "x".repeat(300 * 1024) }] }), { raw: true });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.body?.code, "payload_too_large");

  // 5. Both requests are in the day file, with routing facts and no credentials.
  const dayFile = path.join(logDir, `server-${requestLog.dayStamp(new Date())}.log`);
  const records = readLines(dayFile).map((line) => JSON.parse(line));
  const sendRecord = records.find((record) => record.path === "/api/send" && record.status === 400);
  assert.ok(sendRecord, `expected a /api/send 400 record, got ${JSON.stringify(records)}`);
  assert.equal(sendRecord.code, "image_dimensions_out_of_range");
  assert.equal(sendRecord.threadId, "thread-abc123");
  assert.equal(sendRecord.note, "images=1");
  const diagnosticsRecord = records.find((record) => record.path === "/api/diagnostics" && record.status === 200);
  assert.ok(diagnosticsRecord, "the diagnostics upload itself is logged");
  assert.ok(records.some((record) => record.path === "/api/send" && record.status === 401));
  const rawLog = fs.readFileSync(dayFile, "utf8");
  assert.equal(rawLog.includes(TOKEN), false, "the access code never reaches the log file");
  assert.equal(rawLog.includes("图片尺寸超出电脑端限制"), false, "message text is never archived in the request log");
});

async function startMockBackend() {
  const calls = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      calls.push({ method: req.method, url: req.url, body });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(req.url === "/threads"
        ? { ok: true, threadId: "mock-thread" }
        : { ok: true, threadId: "mock-thread", turnId: "turn-1" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    calls,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("the --backend http send path returns 200 for the compressed photo and keeps the image code otherwise", async (t) => {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-http-send-"));
  const backend = await startMockBackend();
  t.after(() => backend.close());
  const server = await startServer({ logDir, extraArgs: ["--backend", "http", "--backend-url", backend.url] });
  t.after(server.stop);
  t.after(() => fs.rmSync(logDir, { recursive: true, force: true }));

  const post = (width, height, name) => apiPost(server.baseUrl, "/api/send", {
    threadId: "mock-thread",
    message: "看这张图",
    images: [{ name, mimeType: "image/png", data: pngBytes(width, height).toString("base64") }],
    clientRequestId: `probe-${width}`,
  });

  const rejected = await post(4032, 3024, "IMG_4032x3024.png");
  assert.equal(rejected.status, 400, JSON.stringify(rejected.body));
  assert.equal(rejected.body?.code, "image_dimensions_out_of_range");
  assert.match(rejected.body?.error || "", /4032×3024/);

  const accepted = await post(2048, 1536, "IMG_2048.png");
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body?.ok, true);
  const forwarded = backend.calls.find((call) => /\/threads\/mock-thread\/messages$/.test(call.url));
  assert.equal(forwarded?.body.images.length, 1);
  assert.equal(forwarded?.body.images[0].name, "IMG_2048.png");
});

test("the machine gateway records every routed request as source=gateway", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-gateway-log-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const upstreamPort = await freePort();
  const configPath = path.join(dir, "machine.json");
  fs.writeFileSync(configPath, JSON.stringify({
    machineId: "probe-machine",
    machineName: "Probe",
    machineToken: "machine-token-probe",
    harnesses: [{ id: "codex", name: "Codex", token: "harness-token-probe", port: upstreamPort, spawn: false }],
  }));
  const config = machineGateway.loadMachineConfig(configPath);
  const gateway = machineGateway.createGateway(config, { logDir: dir, log: () => {} });
  const port = await freePort();
  await gateway.listen("127.0.0.1", port);
  t.after(async () => { await gateway.close(); });

  // The harness is deliberately not listening: the gateway must still log the
  // routed request, with the harness id, instead of only the failure.
  const response = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { "x-access-token": "harness-token-probe" } });
  assert.equal(response.status, 502);

  const dayFile = path.join(dir, `server-${requestLog.dayStamp(new Date())}.log`);
  const records = readLines(dayFile).map((line) => JSON.parse(line));
  const record = records.find((row) => row.source === "gateway");
  assert.ok(record, `expected a gateway record, got ${JSON.stringify(records)}`);
  assert.equal(record.path, "/api/health");
  assert.equal(record.harness, "codex");
  assert.equal(record.status, 502);
  assert.equal(record.note, "via=header");
});
