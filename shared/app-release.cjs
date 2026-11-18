"use strict";

/**
 * Authoritative metadata for the App APK served by GET /api/apk.
 *
 * The sidecar is written beside the exact staged download artifact after the
 * complete frontend/Gradle/zipalign/signer/badging build succeeds. Neither
 * package.json nor the frozen android/ build files are an authority. Every
 * read streams and hashes the staged bytes again so a swapped or truncated
 * artifact fails closed instead of advertising an unverifiable update.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MANIFEST_SUFFIX = ".release.json";
const APK_URL = "/api/apk";
const DEFAULT_PACKAGE_NAME = "com.codex.turnloom.app";
const EMPTY_VERSION_NAME = "0.0.0";
const EMPTY_SHA256 = "0".repeat(64);
const REQUIRED_BUILD_STEPS = [
  "vite-build",
  "assembleRelease",
  "apksigner-sign",
  "apksigner-verify",
  "aapt2-badging"
];

function manifestPathFor(apkPath) {
  return `${path.resolve(String(apkPath || ""))}${MANIFEST_SUFFIX}`;
}

function defaultApkPath(projectRoot) {
  return path.join(path.resolve(String(projectRoot || process.cwd())), "public", "downloads", "Codex-Turnloom.apk");
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value, maxLength) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength);
}

function parsePositiveInteger(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? value : 0;
  if (!/^[1-9]\d*$/.test(String(value ?? "").trim())) return 0;
  const parsed = Number(String(value).trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function unavailable(reason, details = {}) {
  return {
    available: false,
    reason,
    packageName: DEFAULT_PACKAGE_NAME,
    versionCode: 0,
    versionName: EMPTY_VERSION_NAME,
    apkUrl: APK_URL,
    sha256: EMPTY_SHA256,
    sizeBytes: 0,
    notes: "",
    apkUpdatedAt: "",
    signature: null,
    ...details
  };
}

function hashFile(apkPath) {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(apkPath);
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function buildStepsComplete(value) {
  if (!Array.isArray(value)) return false;
  const names = new Set(value.map((row) => (isObject(row) ? String(row.name || "") : String(row || ""))));
  return REQUIRED_BUILD_STEPS.every((name) => names.has(name));
}

function manifestRecord(manifest, apkPath) {
  if (!isObject(manifest)) return null;
  const identity = isObject(manifest.identity) ? manifest.identity : {};
  const apk = isObject(manifest.apk) ? manifest.apk : {};
  return {
    packageName: cleanText(manifest.packageName || identity.applicationId || identity.packageName, 160),
    versionName: cleanText(manifest.versionName || identity.versionName || manifest.version, 120),
    versionCode: parsePositiveInteger(manifest.versionCode ?? identity.versionCode),
    sha256: cleanText(manifest.sha256 || apk.sha256, 64).toLowerCase(),
    sizeBytes: parsePositiveInteger(manifest.sizeBytes ?? apk.bytes),
    notes: typeof manifest.notes === "string" ? cleanText(manifest.notes, 2000) : "",
    apkName: cleanText(manifest.apkName || apk.name || path.basename(String(manifest.apkPath || "")), 255)
  };
}

function validateRelease(manifest, apkPath, stat) {
  const record = manifestRecord(manifest, apkPath);
  if (!record) return { error: "manifest is not an object", record };
  if (record.packageName !== DEFAULT_PACKAGE_NAME) return { error: "unexpected packageName", record };
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(record.versionName)) return { error: "invalid versionName", record };
  if (!record.versionCode) return { error: "invalid versionCode", record };
  if (!/^[0-9a-f]{64}$/.test(record.sha256)) return { error: "invalid sha256", record };
  if (!record.sizeBytes) return { error: "invalid sizeBytes", record };
  if (record.sizeBytes !== stat.size) return { error: "size-mismatch", record };
  if (!buildStepsComplete(manifest.buildSteps) && !buildStepsComplete(manifest.steps)) {
    return { error: "incomplete build verification", record };
  }
  if (manifest.artifactSha256 && String(manifest.artifactSha256).toLowerCase() !== record.sha256) {
    return { error: "artifact digest fields disagree", record };
  }
  if (manifest.artifactSizeBytes && parsePositiveInteger(manifest.artifactSizeBytes) !== record.sizeBytes) {
    return { error: "artifact size fields disagree", record };
  }
  if (record.apkName && path.basename(record.apkName) !== path.basename(apkPath)) {
    return { error: "manifest names a different staged APK", record };
  }
  return { error: "", record };
}

function statSignature(stat) {
  return {
    dev: Number(stat.dev) || 0,
    ino: Number(stat.ino) || 0,
    size: Number(stat.size) || 0,
    mtimeMs: Number(stat.mtimeMs) || 0,
    ctimeMs: Number(stat.ctimeMs) || 0
  };
}

function sameSignature(left, right) {
  if (!left || !right) return false;
  return ["dev", "ino", "size", "mtimeMs", "ctimeMs"].every((key) => Number(left[key]) === Number(right[key]));
}

async function readAppRelease(apkPath, options = {}) {
  const resolvedApkPath = path.resolve(
    String(apkPath || (options.projectRoot && defaultApkPath(options.projectRoot)) || defaultApkPath(process.cwd()))
  );
  const resolvedManifestPath = manifestPathFor(resolvedApkPath);
  const base = { apkPath: resolvedApkPath, manifestPath: resolvedManifestPath };

  let stat;
  try {
    stat = await fs.promises.stat(resolvedApkPath);
    if (!stat.isFile() || stat.size <= 0) return unavailable("missing-metadata", base);
  } catch {
    return unavailable("missing-metadata", base);
  }

  let manifest;
  try {
    manifest = JSON.parse((await fs.promises.readFile(resolvedManifestPath, "utf8")).replace(/^\uFEFF/, ""));
  } catch {
    return unavailable("missing-metadata", base);
  }

  const { error, record } = validateRelease(manifest, resolvedApkPath, stat);
  if (error) return unavailable(error === "size-mismatch" ? "size-mismatch" : "invalid-metadata", { ...base, error });

  let digest;
  try {
    digest = await hashFile(resolvedApkPath);
  } catch {
    return unavailable("unreadable-apk", base);
  }
  if (digest !== record.sha256) {
    return unavailable("hash-mismatch", { ...base, expectedSha256: record.sha256, actualSha256: digest });
  }
  const finishStat = await fs.promises.stat(resolvedApkPath).catch(() => null);
  if (!finishStat || !sameSignature(statSignature(stat), statSignature(finishStat))) {
    return unavailable("artifact-changed", base);
  }
  return {
    available: true,
    reason: "",
    packageName: record.packageName,
    versionCode: record.versionCode,
    versionName: record.versionName,
    apkUrl: APK_URL,
    sha256: record.sha256,
    sizeBytes: record.sizeBytes,
    notes: record.notes || `${record.versionName} (${record.versionCode})`,
    apkUpdatedAt: new Date(stat.mtimeMs).toISOString(),
    signature: statSignature(stat),
    ...base
  };
}

async function verifyReleaseManifest({ apkPath, manifestPath = manifestPathFor(apkPath) } = {}) {
  const resolvedApkPath = path.resolve(String(apkPath || ""));
  if (path.extname(resolvedApkPath).toLowerCase() !== ".apk") throw new Error("staged artifact must be an APK");
  const sidecar = path.resolve(String(manifestPath || manifestPathFor(resolvedApkPath)));
  if (path.dirname(sidecar) !== path.dirname(resolvedApkPath) || path.basename(sidecar) !== `${path.basename(resolvedApkPath)}${MANIFEST_SUFFIX}`) {
    throw new Error("release manifest must be adjacent to the staged APK");
  }
  const release = await readAppRelease(resolvedApkPath);
  if (!release.available) throw new Error(`staged release is unavailable: ${release.reason}`);
  return release;
}

function publicUpdatePayload(release) {
  return {
    available: Boolean(release?.available),
    packageName: release?.packageName || DEFAULT_PACKAGE_NAME,
    versionCode: release?.versionCode || 0,
    versionName: release?.versionName || EMPTY_VERSION_NAME,
    apkUrl: APK_URL,
    sha256: release?.sha256 || EMPTY_SHA256,
    sizeBytes: release?.sizeBytes || 0,
    notes: release?.notes || ""
  };
}

function legacyHealthFields(release) {
  return {
    apkAvailable: Boolean(release?.available),
    apkUrl: APK_URL,
    appVersionCode: release?.versionCode || 0,
    appVersionName: release?.versionName || EMPTY_VERSION_NAME,
    apkUpdatedAt: release?.apkUpdatedAt || ""
  };
}

function parseCliArgs(argv) {
  const result = { verify: false, apk: "", manifest: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i]);
    if (arg === "--verify") result.verify = true;
    else if (arg === "--apk") result.apk = String(argv[++i] || "");
    else if (arg === "--manifest") result.manifest = String(argv[++i] || "");
    else throw new Error(`unknown argument: ${arg}`);
  }
  return result;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args.verify || !args.apk) throw new Error("usage: app-release.cjs --verify --apk <staged.apk> [--manifest <sidecar>]");
  const release = await verifyReleaseManifest({
    apkPath: args.apk,
    manifestPath: args.manifest || manifestPathFor(args.apk)
  });
  process.stdout.write(`${release.versionName}/${release.versionCode}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[app-release] ${error?.message || String(error)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  MANIFEST_SUFFIX,
  APK_URL,
  DEFAULT_PACKAGE_NAME,
  REQUIRED_BUILD_STEPS,
  manifestPathFor,
  defaultApkPath,
  readAppRelease,
  verifyReleaseManifest,
  sameSignature,
  publicUpdatePayload,
  legacyHealthFields
};
