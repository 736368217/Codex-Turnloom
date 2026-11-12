"use strict";

/**
 * End-to-end HTTP tests for staged App release metadata, authenticated APK
 * range downloads, and machine-gateway proxy routing. Temporary fixtures live
 * in os.tmpdir(); no live service, existing staged APK, or token is touched.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const SERVER = path.join(ROOT, "server.js");
const RELEASE = require(path.join(ROOT, "shared", "app-release.cjs"));
const GATEWAY = require(path.join(ROOT, "server", "machine-gateway.cjs"));

const TOKEN = "TEST-HARNESS-TOKEN";
const APK_BYTES = Buffer.from("staged-apk-fixture-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ");
const STEPS = RELEASE.REQUIRED_BUILD_STEPS.map((name) => ({ name, status: "ok", detail: "" }));

function makeFixture(versionName = "2.1.0", versionCode = 81) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-app-release-"));
  const apk = path.join(dir, "Codex-Turnloom.apk");
  const sidecar = RELEASE.manifestPathFor(apk);
  fs.writeFileSync(apk, APK_BYTES);
  const digest = crypto.createHash("sha256").update(APK_BYTES).digest("hex");
  const manifest = {
    schema: "turnloom-app-release/1",
    packageName: RELEASE.DEFAULT_PACKAGE_NAME,
    versionName,
    versionCode,
    apkName: path.basename(apk),
    apkPath: apk,
    sha256: digest,
    sizeBytes: APK_BYTES.length,
    notes: "Real embedded scanner, updater, and paired HTTP bridge",
    identity: { applicationId: RELEASE.DEFAULT_PACKAGE_NAME, versionName, versionCode: String(versionCode) },
    apk: { name: path.basename(apk), bytes: APK_BYTES.length, sha256: digest },
    buildSteps: STEPS,
  };
  fs.writeFileSync(sidecar, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { dir, apk, sidecar, manifest, digest };
}

function writeManifest(fixture, changes) {
  fs.writeFileSync(fixture.sidecar, `${JSON.stringify({ ...fixture.manifest, ...changes }, null, 2)}\n`, "utf8");
}

function request(port, pathname, { token = TOKEN, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (token !== null) requestHeaders["x-access-token"] = token;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: pathname, method: "GET", headers: requestHeaders }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks)
      }));
    });
    req.on("error", reject);
    req.end();
  });
}

function jsonRequest(port, pathname, options) {
  return request(port, pathname, options).then((result) => ({
    ...result,
    json: (() => {
      try { return JSON.parse(result.body.toString("utf8")); } catch { return null; }
    })()
  }));
}

function waitForHttp(port, child) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 10000;
    const tick = () => {
      if (child.exitCode !== null) {
        reject(new Error(`server exited early (${child.exitCode})`));
        return;
      }
      const probe = http.request({ host: "127.0.0.1", port, path: "/__turnloom/health", method: "GET" }, (res) => {
        res.resume();
        resolve();
      });
      probe.on("error", () => {
        if (Date.now() > deadline) reject(new Error("server did not become ready"));
        else setTimeout(tick, 40);
      });
      probe.end();
    };
    tick();
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function startServer({ apk, backend = "codex" } = {}) {
  const port = await freePort();
  const env = {
    ...process.env,
    CODEX_POCKET_APK_PATH: apk,
    CODEX_LAN_NO_AUTH: "0",
    CODEX_LAN_PROFILES: "",
    CODEX_LAN_BACKEND: backend,
    CODEX_LAN_BACKEND_URL: "http://127.0.0.1:1",
    CODEX_LAN_BACKEND_TOKEN: "",
    CODEX_HOME: path.join(os.tmpdir(), "turnloom-nonexistent-codex-home"),
    CODEX_IPC_SOCKET: path.join(os.tmpdir(), "turnloom-nonexistent-ipc.sock")
  };
  const child = spawn(process.execPath, [SERVER, "--host", "127.0.0.1", "--port", String(port), "--password", TOKEN], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  child.stdout.resume();
  await waitForHttp(port, child);
  return {
    port,
    child,
    async close() {
      if (child.exitCode === null) child.kill();
      await new Promise((resolve) => {
        if (child.exitCode !== null) resolve();
        else child.once("exit", resolve);
      });
    },
    stderr: () => stderr
  };
}

async function withServer(options, callback) {
  const server = await startServer(options);
  try { await callback(server); }
  finally { await server.close(); }
}

test("staged manifest is authoritative and re-hashed on every read", async () => {
  const fixture = makeFixture();
  try {
    const good = await RELEASE.readAppRelease(fixture.apk);
    assert.equal(good.available, true);
    assert.equal(good.versionName, "2.1.0");
    assert.equal(good.versionCode, 81);
    assert.equal(good.sha256, fixture.digest);
    assert.equal(good.sizeBytes, APK_BYTES.length);
    assert.equal(RELEASE.publicUpdatePayload(good).apkUrl, "/api/apk");

    fs.rmSync(fixture.sidecar);
    assert.equal((await RELEASE.readAppRelease(fixture.apk)).reason, "missing-metadata");
    writeManifest(fixture, { packageName: "com.evil.app" });
    assert.equal((await RELEASE.readAppRelease(fixture.apk)).reason, "invalid-metadata");
    writeManifest(fixture, { versionCode: 80 });
    assert.equal((await RELEASE.readAppRelease(fixture.apk)).versionCode, 80);
    writeManifest(fixture, { versionCode: 81 });
    fs.appendFileSync(fixture.apk, Buffer.from("changed"));
    assert.equal((await RELEASE.readAppRelease(fixture.apk)).reason, "size-mismatch");
    const changed = Buffer.from(APK_BYTES);
    changed.write("swapped", 0, "ascii");
    fs.writeFileSync(fixture.apk, changed);
    assert.equal((await RELEASE.readAppRelease(fixture.apk)).reason, "hash-mismatch");
    fs.writeFileSync(fixture.apk, APK_BYTES);
    assert.equal((await RELEASE.readAppRelease(fixture.apk)).available, true);
    await assert.rejects(RELEASE.verifyReleaseManifest({ apkPath: fixture.apk, manifestPath: "elsewhere.json" }), /adjacent/);
    const release = await RELEASE.verifyReleaseManifest({ apkPath: fixture.apk });
    assert.equal(release.versionCode, 81);
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("direct backend authenticates release endpoints and serves exact APK ranges", async () => {
  const fixture = makeFixture();
  await withServer({ apk: fixture.apk }, async ({ port }) => {
    const unauthorized = await jsonRequest(port, "/api/app/update", { token: "wrong" });
    assert.equal(unauthorized.status, 401);
    const noToken = await request(port, "/api/apk", { token: null });
    assert.equal(noToken.status, 401);

    const update = await jsonRequest(port, "/api/app/update");
    assert.equal(update.status, 200);
    assert.deepEqual(update.json, {
      available: true,
      packageName: RELEASE.DEFAULT_PACKAGE_NAME,
      versionCode: 81,
      versionName: "2.1.0",
      apkUrl: "/api/apk",
      sha256: fixture.digest,
      sizeBytes: APK_BYTES.length,
      notes: fixture.manifest.notes
    });

    const health = await jsonRequest(port, "/api/health");
    assert.equal(health.status, 200);
    assert.equal(health.json.apkAvailable, true);
    assert.equal(health.json.apkUrl, "/api/apk");
    assert.equal(health.json.appVersionCode, 81);
    assert.equal(health.json.appVersionName, "2.1.0");
    assert.ok(health.json.apkUpdatedAt);

    const full = await request(port, "/api/apk");
    assert.equal(full.status, 200);
    assert.equal(full.headers["content-length"], String(APK_BYTES.length));
    assert.equal(full.headers["accept-ranges"], "bytes");
    assert.deepEqual(full.body, APK_BYTES);

    const partial = await request(port, "/api/apk", { headers: { range: "bytes=7-15" } });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers["content-length"], "9");
    assert.equal(partial.headers["content-range"], `bytes 7-15/${APK_BYTES.length}`);
    assert.deepEqual(partial.body, APK_BYTES.subarray(7, 16));

    const suffix = await request(port, "/api/apk", { headers: { range: "bytes=-4" } });
    assert.equal(suffix.status, 206);
    assert.equal(suffix.headers["content-range"], `bytes ${APK_BYTES.length - 4}-${APK_BYTES.length - 1}/${APK_BYTES.length}`);
    assert.deepEqual(suffix.body, APK_BYTES.subarray(-4));

    const unsatisfiable = await request(port, "/api/apk", { headers: { range: `bytes=${APK_BYTES.length}-` } });
    assert.equal(unsatisfiable.status, 416);
    assert.equal(unsatisfiable.headers["content-range"], `bytes */${APK_BYTES.length}`);

    const swapped = Buffer.from(APK_BYTES);
    swapped.write("swapped", 0, "ascii");
    fs.writeFileSync(fixture.apk, swapped);
    const mismatch = await jsonRequest(port, "/api/app/update");
    assert.equal(mismatch.status, 200);
    assert.equal(mismatch.json.available, false);
    assert.equal(mismatch.json.versionCode, 0);
    const missingHealth = await jsonRequest(port, "/api/health");
    assert.equal(missingHealth.json.apkAvailable, false);
    assert.equal(missingHealth.json.appVersionCode, 0);
    assert.equal((await request(port, "/api/apk")).status, 404);

    fs.writeFileSync(fixture.apk, APK_BYTES);
    writeManifest(fixture, { versionCode: 80, versionName: "2.0.0" });
    const stagedVersion = await jsonRequest(port, "/api/app/update");
    assert.equal(stagedVersion.json.versionCode, 80);
    assert.equal(stagedVersion.json.versionName, "2.0.0");
  });
  fs.rmSync(fixture.dir, { recursive: true, force: true });
});

test("HTTP backend mode serves the same authenticated release metadata and APK", async () => {
  const fixture = makeFixture();
  await withServer({ apk: fixture.apk, backend: "http" }, async ({ port }) => {
    const unauthorized = await jsonRequest(port, "/api/app/update", { token: "wrong" });
    assert.equal(unauthorized.status, 401);
    const update = await jsonRequest(port, "/api/app/update");
    assert.equal(update.status, 200);
    assert.equal(update.json.versionCode, 81);
    assert.equal(update.json.sha256, fixture.digest);
    const health = await jsonRequest(port, "/api/health");
    assert.equal(health.json.appVersionCode, 81);
    assert.equal(health.json.appVersionName, "2.1.0");
    const apk = await request(port, "/api/apk", { headers: { range: "bytes=0-3" } });
    assert.equal(apk.status, 206);
    assert.equal(apk.headers["content-length"], "4");
    assert.deepEqual(apk.body, APK_BYTES.subarray(0, 4));
  });
  fs.rmSync(fixture.dir, { recursive: true, force: true });
});

test("gateway proxies release metadata and ranges using a harness token header", async () => {
  const fixture = makeFixture();
  const upstream = await startServer({ apk: fixture.apk });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-gateway-release-"));
  const config = {
    configPath: path.join(dir, "machine.json"),
    machineId: "test-machine",
    machineName: "Test Machine",
    machineToken: "MACHINE-TOKEN",
    defaultHarnessId: "codex",
    harnesses: [{
      id: "codex", name: "Codex", token: TOKEN, kind: "codex",
      port: upstream.port, entry: SERVER, spawn: false, extraArgs: [], defaultHarness: true
    }],
    publicUrl: "",
    byToken: new Map()
  };
  config.byToken.set(TOKEN, config.harnesses[0]);
  const gateway = GATEWAY.createGateway(config, { logDir: path.join(dir, "logs"), log: () => {} });
  await gateway.listen("127.0.0.1", 0);
  const gatewayPort = gateway.server.address().port;
  try {
    assert.equal(GATEWAY.withToken("/api/app/update", TOKEN), "/api/app/update");
    assert.equal(GATEWAY.withToken("/api/apk", TOKEN), "/api/apk");
    const unauthorized = await jsonRequest(gatewayPort, "/api/app/update", { token: "MACHINE-TOKEN" });
    assert.equal(unauthorized.status, 401);
    const update = await jsonRequest(gatewayPort, "/api/app/update");
    assert.equal(update.status, 200);
    assert.equal(update.json.versionCode, 81);
    assert.equal(update.json.sha256, fixture.digest);
    const health = await jsonRequest(gatewayPort, "/api/health");
    assert.equal(health.json.appVersionCode, 81);
    const apk = await request(gatewayPort, "/api/apk", { headers: { range: "bytes=7-15" } });
    assert.equal(apk.status, 206);
    assert.equal(apk.headers["content-range"], `bytes 7-15/${APK_BYTES.length}`);
    assert.deepEqual(apk.body, APK_BYTES.subarray(7, 16));
    assert.equal(String(upstream.stderr()).includes(TOKEN), false);
  } finally {
    await gateway.close();
    await upstream.close();
    fs.rmSync(fixture.dir, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
