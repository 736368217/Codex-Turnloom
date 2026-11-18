"use strict";

/**
 * Desktop update check for `/api/health.version` and `/api/desktop/update`.
 *
 * The same evidence the Human's `de` machine will rely on: the console must be
 * able to say "running X, latest Y" from a release manifest, and must never
 * report a fake version or a broken digest as an update.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");

const release = require("../shared/desktop-release.cjs");

const ROOT = path.join(__dirname, "..");
const TOKEN = "desktop-update-probe";
const SHA = "a".repeat(64);

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

async function startServer({ env = {} } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-update-home-"));
  await seedHome(home);
  const port = await freePort();
  const child = spawn(process.execPath, ["server.js", "--port", String(port), "--host", "127.0.0.1", "--token", TOKEN, "--codex-home", home], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, TURNLOOM_LOG_DIR: path.join(home, "logs"), LOCALAPPDATA: path.join(home, "localappdata"), ...env },
  });
  let log = "";
  child.stdout.on("data", (chunk) => { log += chunk; });
  child.stderr.on("data", (chunk) => { log += chunk; });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { headers: { "x-access-token": TOKEN } });
      if (response.status === 200) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
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

const getJson = (baseUrl, pathname) => fetch(`${baseUrl}${pathname}`, { headers: { "x-access-token": TOKEN } })
  .then(async (response) => ({ status: response.status, body: await response.json().catch(() => null) }));

test("version comparison treats a release as newer than its own prerelease", () => {
  assert.equal(release.compareVersions("2.2.1", "2.2.0"), 1);
  assert.equal(release.compareVersions("2.2.1", "2.2.1"), 0);
  assert.equal(release.compareVersions("2.2.10", "2.2.9"), 1);
  assert.equal(release.compareVersions("2.2.1-rc.1", "2.2.1"), -1);
  assert.equal(release.compareVersions("2.2.1", "2.2.1-rc.1"), 1);
  assert.equal(release.compareVersions("1.17.31", "2.0.0"), -1);
  assert.equal(release.compareVersions("v2.2.1", "2.2.1"), 0);
});

test("a manifest is only trusted with a version, a digest and a safe download path", () => {
  const good = release.normalizeManifest({
    version: "2.2.1",
    packageName: "turnloom-2.2.1-server.zip",
    sha256: SHA,
    sizeBytes: 123456,
    downloadUrl: "/downloads/turnloom-2.2.1-server.zip",
    notes: "发图压缩、错误文案、诊断日志",
  });
  assert.equal(good.available, true);
  assert.equal(good.version, "2.2.1");
  assert.equal(good.downloadUrl, "/downloads/turnloom-2.2.1-server.zip");

  assert.equal(release.normalizeManifest({ version: "2.2.1", downloadUrl: "C:\\temp\\x.zip" }).reason, "invalid-download-url");
  assert.equal(release.normalizeManifest({ version: "2.2.1", downloadUrl: "file:///x.zip" }).reason, "invalid-download-url");
  assert.equal(release.normalizeManifest({ version: "2.2.1", sha256: "not-a-digest" }).reason, "invalid-sha256");
  assert.equal(release.normalizeManifest({ version: "2.2.1 升级" }).reason, "invalid-version");
  assert.equal(release.normalizeManifest([]).reason, "manifest-not-object");
});

test("VERSION.json outranks package.json and a build sha is never guessed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-version-"));
  try {
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "1.17.31" }));
    assert.deepEqual(release.readServerVersion({ projectRoot: dir, env: {} }), {
      version: "1.17.31", buildSha: "", generatedAt: "", source: "package.json",
    });
    fs.writeFileSync(path.join(dir, "VERSION.json"), JSON.stringify({ version: "2.2.1", buildSha: "17357f7" }));
    assert.deepEqual(release.readServerVersion({ projectRoot: dir, env: {} }), {
      version: "2.2.1", buildSha: "17357f7", generatedAt: "", source: "VERSION.json",
    });
    fs.writeFileSync(path.join(dir, "VERSION.json"), "{broken");
    assert.equal(release.readServerVersion({ projectRoot: dir, env: {} }).version, "1.17.31");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing or unreadable manifest is reported, never thrown", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-manifest-"));
  try {
    const missing = await release.readDesktopRelease({ projectRoot: dir });
    assert.equal(missing.available, false);
    assert.equal(missing.reason, "missing-manifest");
    assert.equal(missing.sourceKind, "file");

    const explicitPath = path.join(dir, "custom.json");
    fs.writeFileSync(explicitPath, JSON.stringify({ version: "9.9.9" }));
    const found = await release.readDesktopRelease({ projectRoot: dir, configured: explicitPath });
    assert.equal(found.available, true);
    assert.equal(found.version, "9.9.9");
    assert.equal(found.configured, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the update payload only calls a newer manifest an available update", () => {
  const current = { version: "2.2.1", buildSha: "17357f7", startedAt: "2026-11-18T21:00:00.000Z", versionSource: "VERSION.json" };
  const same = release.desktopUpdatePayload(current, {
    available: true, version: "2.2.1", sha256: SHA, sizeBytes: 1, downloadUrl: "/downloads/x.zip", sourceKind: "file", sourceLabel: "x",
  });
  assert.equal(same.updateAvailable, false);
  assert.equal(same.upToDate, true);
  assert.equal(same.current.version, "2.2.1");

  const newer = release.desktopUpdatePayload(current, {
    available: true, version: "2.2.2", sha256: SHA, sizeBytes: 1, downloadUrl: "/downloads/x.zip", sourceKind: "file", sourceLabel: "x",
  });
  assert.equal(newer.updateAvailable, true);
  assert.equal(newer.latest.version, "2.2.2");

  const older = release.desktopUpdatePayload(current, {
    available: true, version: "2.2.0", sha256: SHA, sizeBytes: 1, downloadUrl: "/downloads/x.zip", sourceKind: "file", sourceLabel: "x",
  });
  assert.equal(older.updateAvailable, false);
  assert.equal(older.upToDate, true);
});

test("/api/health exposes the running version and /api/desktop/update reports the manifest", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-update-manifest-"));
  const manifestPath = path.join(dir, "desktop-release.json");
  fs.writeFileSync(manifestPath, JSON.stringify({
    schemaVersion: 1,
    product: "codex-turnloom",
    version: "9.9.9",
    packageName: "turnloom-9.9.9-server.zip",
    sha256: SHA,
    sizeBytes: 4321,
    downloadUrl: "/downloads/turnloom-9.9.9-server.zip",
    upgradeScript: "/downloads/update-turnloom.ps1",
    notes: "probe",
  }));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const server = await startServer({ env: { TURNLOOM_UPDATE_SOURCE: manifestPath } });
  t.after(server.stop);

  const health = await getJson(server.baseUrl, "/api/health");
  assert.equal(health.status, 200);
  const packageVersion = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  assert.equal(health.body?.version, packageVersion);
  assert.equal(typeof health.body?.buildSha, "string");
  assert.ok(!Number.isNaN(Date.parse(health.body?.startedAt || "")), `startedAt must be an ISO instant: ${JSON.stringify(health.body?.startedAt)}`);

  const update = await getJson(server.baseUrl, "/api/desktop/update");
  assert.equal(update.status, 200);
  assert.equal(update.body?.current?.version, packageVersion);
  assert.equal(update.body?.latest?.available, true);
  assert.equal(update.body?.latest?.version, "9.9.9");
  assert.equal(update.body?.updateAvailable, true);
  assert.equal(update.body?.updateSource?.configured, true);

  // The manifest is read-only data: replacing it changes the answer without a restart.
  fs.writeFileSync(manifestPath, JSON.stringify({ version: packageVersion, downloadUrl: "/downloads/same.zip" }));
  const upToDate = await getJson(server.baseUrl, "/api/desktop/update");
  assert.equal(upToDate.body?.updateAvailable, false);
  assert.equal(upToDate.body?.upToDate, true);

  // Unauthenticated calls never leak the manifest.
  const unauthorized = await fetch(`${server.baseUrl}/api/desktop/update`);
  assert.equal(unauthorized.status, 401);
});

test("an http(s) update source is fetched, bounded and reported when unavailable", async (t) => {
  const routes = new Map();
  const server = http.createServer((req, res) => {
    const row = routes.get(String(req.url || ""));
    if (!row) { res.writeHead(404).end("{}"); return; }
    res.writeHead(row.status || 200, { "content-type": "application/json" });
    res.end(row.body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  routes.set("/releases/desktop-release.json", {
    body: JSON.stringify({ version: "2.2.1", sha256: SHA, sizeBytes: 10, downloadUrl: "/downloads/x.zip" }),
  });
  routes.set("/releases/huge.json", { body: JSON.stringify({ version: "2.2.1", notes: "x".repeat(70 * 1024) }) });

  const found = await release.readDesktopRelease({ configured: `${base}/releases/desktop-release.json` });
  assert.equal(found.available, true);
  assert.equal(found.version, "2.2.1");
  assert.equal(found.sourceKind, "url");
  // A site-relative path is resolved against the manifest's own origin, not
  // the console's 127.0.0.1 — the publisher is another machine.
  assert.equal(found.downloadUrl, `${base}/downloads/x.zip`);

  const missing = await release.readDesktopRelease({ configured: `${base}/releases/none.json` });
  assert.equal(missing.available, false);
  assert.match(missing.reason, /404/);

  const huge = await release.readDesktopRelease({ configured: `${base}/releases/huge.json` });
  assert.equal(huge.available, false);
  assert.match(huge.reason, /manifest-too-large/);
});
