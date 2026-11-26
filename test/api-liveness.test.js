"use strict";

/**
 * What an idle-but-connected phone costs the computer (QA 2026-11-26).
 *
 * Defect 1: the device card stayed 在线 with the service dead, because nothing
 * on that screen ever asked the host anything. The fix is a 3-second beat
 * (`GET /api/ping`), and this file locks the two host-side properties that make
 * it acceptable: it answers from the service layer alone (no Codex Desktop), and
 * it does not write a line into the request log on every beat.
 *
 * Defect 5: the same 3-second cadence made `[goal:read] IPC unavailable` print
 * ~1200 lines an hour with Desktop closed. One warn per thread when a read
 * starts failing, silence while it keeps failing, one info line on recovery.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const requestLog = require("../server/request-log.cjs");

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = "liveness-probe-code";
const THREAD = "11111111-2222-3333-4444-555555555555";

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
      const response = await fetch(`${baseUrl}/api/ping`, { headers: { "x-access-token": TOKEN } });
      if (response.status === 200) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("server did not become ready within 30s");
}

async function startServer({ logDir }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-liveness-home-"));
  await seedHome(home);
  const port = await freePort();
  const child = spawn(
    process.execPath,
    ["server.js", "--port", String(port), "--host", "127.0.0.1", "--token", TOKEN, "--codex-home", home],
    {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        TURNLOOM_LOG_DIR: logDir,
        LOCALAPPDATA: path.join(logDir, "localappdata"),
        // Debug detail must stay off: the whole point is that repeats are silent.
        TURNLOOM_VERBOSE_LOG: "",
      },
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

function dayLogPaths(logDir) {
  const file = path.join(logDir, `server-${requestLog.dayStamp(new Date())}.log`);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter((line) => line.trim())
    .map((line) => JSON.parse(line).path);
}

test("/api/ping answers on the access code alone and stays out of the request log", async (t) => {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-liveness-"));
  const server = await startServer({ logDir });
  t.after(server.stop);
  t.after(() => fs.rmSync(logDir, { recursive: true, force: true }));

  const answered = await fetch(`${server.baseUrl}/api/ping`, { headers: { "x-access-token": TOKEN } });
  assert.equal(answered.status, 200);
  const body = await answered.json();
  assert.equal(body.ok, true);
  assert.equal(body.protocol, "codex-turnloom");
  assert.equal(typeof body.now, "number");

  // Same access code as every other route: an unpaired client learns nothing.
  const denied = await fetch(`${server.baseUrl}/api/ping`);
  assert.equal(denied.status, 401);

  // Six beats = what the device page produces in 18 seconds of doing nothing.
  for (let beat = 0; beat < 6; beat += 1) {
    await fetch(`${server.baseUrl}/api/ping`, { headers: { "x-access-token": TOKEN } });
  }
  // One ordinary call, so the assertion below cannot pass just because
  // nothing is being logged at all.
  await fetch(`${server.baseUrl}/api/threads`, { headers: { "x-access-token": TOKEN } });
  await new Promise((resolve) => setTimeout(resolve, 300));

  const paths = dayLogPaths(logDir);
  assert.equal(paths.includes("/api/ping"), false, `the beat must not enter the request log: ${JSON.stringify(paths)}`);
  assert.ok(paths.includes("/api/threads"), `ordinary calls are still logged: ${JSON.stringify(paths)}`);
});

test("an unavailable Desktop IPC warns once per thread, not once per poll", async (t) => {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-goal-log-"));
  const server = await startServer({ logDir });
  t.after(server.stop);
  t.after(() => fs.rmSync(logDir, { recursive: true, force: true }));

  for (let poll = 0; poll < 4; poll += 1) {
    const response = await fetch(`${server.baseUrl}/api/threads/${THREAD}/goal`, { headers: { "x-access-token": TOKEN } });
    assert.equal(response.status, 200);
    await response.json();
  }
  await new Promise((resolve) => setTimeout(resolve, 200));

  const goalLines = server.log().split("\n").filter((line) => line.includes("[goal:read]"));
  const ipcLines = goalLines.filter((line) => line.includes(`ipc:${THREAD}`));
  assert.equal(ipcLines.length, 1, `expected one warn for four polls, got:\n${goalLines.join("\n")}`);
  assert.match(ipcLines[0], /failed/);
  // Nothing in the repeat path may default to a louder level.
  assert.equal(/still failing/.test(server.log()), false, "repeat detail is debug-only and must stay off by default");
});
