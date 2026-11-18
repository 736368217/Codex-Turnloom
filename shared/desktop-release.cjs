"use strict";

/**
 * Read-only update metadata for the *desktop/server* side of Turnloom.
 *
 * The console and `/api/desktop/update` only ever report what a release
 * manifest says; nothing here replaces binaries. The manifest is
 * `public/downloads/desktop-release.json`, written next to the upgrade zip by
 * `scripts/write-desktop-release.cjs`, and overridable through
 * `TURNLOOM_UPDATE_SOURCE` (a path or an http(s) URL) or the console config
 * field `updateSource.desktop`.
 *
 * `VERSION.json` inside an installed tree is the authority for "what is
 * running"; `package.json` is only the npm package version and a fallback.
 */

const fs = require("node:fs");
const path = require("node:path");

const MANIFEST_NAME = "desktop-release.json";
const PRODUCT = "codex-turnloom";
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_NOTES = 500;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

function stripBom(text) {
  return String(text || "").replace(/^\uFEFF/, "");
}

function cleanText(value, max) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
}

function positiveInt(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function defaultManifestPath(projectRoot) {
  return path.join(path.resolve(String(projectRoot || process.cwd())), "public", "downloads", MANIFEST_NAME);
}

/**
 * Version precedence: `VERSION.json` (written by the release packaging) →
 * `package.json`. `buildSha` is only reported when the packaging recorded it;
 * guessing from `.git` would be wrong inside an installed copy.
 */
function readServerVersion({ projectRoot = process.cwd(), env = process.env, packageJson } = {}) {
  const root = path.resolve(String(projectRoot || process.cwd()));
  const versionFile = path.join(root, "VERSION.json");
  try {
    const parsed = JSON.parse(stripBom(fs.readFileSync(versionFile, "utf8")));
    const version = cleanText(parsed?.version, 64);
    if (VERSION_PATTERN.test(version)) {
      return {
        version,
        // The packaging script records the commit as `gitCommit`; `sha256` in
        // that file is the file-manifest digest and must never be shown as a
        // build id.
        buildSha: cleanText(parsed?.buildSha || parsed?.gitCommit, 64).toLowerCase(),
        generatedAt: cleanText(parsed?.generatedAt, 40),
        source: "VERSION.json",
      };
    }
  } catch {
    // fall through to package.json
  }
  let pkg = packageJson;
  if (!pkg) {
    try {
      pkg = JSON.parse(stripBom(fs.readFileSync(path.join(root, "package.json"), "utf8")));
    } catch {
      pkg = null;
    }
  }
  const version = cleanText(pkg?.version, 64);
  return {
    version: VERSION_PATTERN.test(version) ? version : "0.0.0",
    buildSha: cleanText(env.TURNLOOM_BUILD_SHA, 64),
    generatedAt: "",
    source: VERSION_PATTERN.test(version) ? "package.json" : "unknown",
  };
}

/** -1 / 0 / 1; a release outranks the same number with a `-rc` suffix. */
function compareVersions(left, right) {
  const split = (value) => String(value || "").replace(/^v/i, "").split(/[.+-]/).filter((part) => part !== "");
  const a = split(left);
  const b = split(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const x = a[index];
    const y = b[index];
    // A side that ran out is the released version when the other side's next
    // segment is a tag (`-rc`), and the older one when it is a number.
    if (y === undefined) return /^\d+$/.test(String(x)) ? 1 : -1;
    if (x === undefined) return /^\d+$/.test(String(y)) ? -1 : 1;
    const nx = /^\d+$/.test(x) ? Number(x) : null;
    const ny = /^\d+$/.test(y) ? Number(y) : null;
    if (nx !== null && ny !== null) {
      if (nx !== ny) return nx > ny ? 1 : -1;
      continue;
    }
    if (nx !== null) return 1;
    if (ny !== null) return -1;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/** Accept a same-origin path or an absolute http(s) URL; never a local path. */
function normalizedDownloadUrl(value) {
  const text = cleanText(value, 500);
  if (!text) return "";
  if (/^\/(?!\/)/.test(text)) return text;
  if (/^https?:\/\//i.test(text)) return text;
  return "";
}

function normalizeManifest(raw, { sourceLabel = MANIFEST_NAME } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { available: false, reason: "manifest-not-object", sourceLabel };
  const version = cleanText(raw.version || raw.versionName, 64);
  if (!VERSION_PATTERN.test(version)) return { available: false, reason: "invalid-version", sourceLabel };
  const sha256 = cleanText(raw.sha256, 64).toLowerCase();
  if (sha256 && !/^[0-9a-f]{64}$/.test(sha256)) return { available: false, reason: "invalid-sha256", sourceLabel };
  const sizeBytes = positiveInt(raw.sizeBytes);
  const downloadUrl = normalizedDownloadUrl(raw.downloadUrl || raw.url);
  if ((raw.downloadUrl || raw.url) && !downloadUrl) return { available: false, reason: "invalid-download-url", sourceLabel };
  return {
    available: true,
    reason: "",
    product: cleanText(raw.product, 40) || PRODUCT,
    version,
    packageName: cleanText(raw.packageName, 160),
    sha256,
    sizeBytes,
    downloadUrl,
    upgradeScript: normalizedDownloadUrl(raw.upgradeScript),
    notes: cleanText(raw.notes, MAX_NOTES),
    publishedAt: cleanText(raw.publishedAt, 40),
    asset: cleanText(raw.asset, 80),
    schemaVersion: positiveInt(raw.schemaVersion) || 1,
    sourceLabel,
  };
}

function resolveUpdateSource({ projectRoot = process.cwd(), configured = "" } = {}) {
  const explicit = cleanText(configured, 600);
  const root = path.resolve(String(projectRoot || process.cwd()));
  if (explicit) {
    if (/^https?:\/\//i.test(explicit)) {
      return { kind: "url", target: explicit, label: "updateSource", configured: true };
    }
    // An absolute local path is the operator's business, not the phone's:
    // report the file name instead of the machine layout.
    const label = path.isAbsolute(explicit) ? path.basename(explicit) : explicit;
    return { kind: "file", target: path.resolve(root, explicit), label, configured: true };
  }
  // Installed trees may keep the manifest beside the app rather than in
  // `public/downloads`; prefer whichever exists, and report the documented
  // path when neither does.
  const packaged = defaultManifestPath(root);
  if (fs.existsSync(packaged)) {
    return { kind: "file", target: packaged, label: `public/downloads/${MANIFEST_NAME}`, configured: false };
  }
  const besideApp = path.join(root, MANIFEST_NAME);
  if (fs.existsSync(besideApp)) {
    return { kind: "file", target: besideApp, label: MANIFEST_NAME, configured: false };
  }
  return { kind: "file", target: packaged, label: `public/downloads/${MANIFEST_NAME}`, configured: false };
}

async function readManifestFromUrl(url, { fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch-unavailable");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, cache: "no-store", headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_MANIFEST_BYTES) throw new Error("manifest-too-large");
    return JSON.parse(stripBom(text));
  } finally {
    clearTimeout(timer);
  }
}

function readManifestFromFile(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) throw new Error("manifest-too-large");
  return JSON.parse(stripBom(fs.readFileSync(file, "utf8")));
}

/**
 * Resolve the release manifest. A missing or broken manifest is a normal,
 * reported state (`available:false`), never an exception: the console must be
 * able to say "更新源不可用" instead of crashing its health view.
 */
async function readDesktopRelease({ projectRoot = process.cwd(), configured = "", fetchImpl, env = process.env } = {}) {
  const source = resolveUpdateSource({ projectRoot, configured });
  try {
    const raw = source.kind === "url"
      ? await readManifestFromUrl(source.target, { fetchImpl })
      : readManifestFromFile(source.target);
    const record = normalizeManifest(raw, { sourceLabel: source.label });
    return { ...record, sourceKind: source.kind, sourceLabel: source.label, configured: source.configured };
  } catch (error) {
    const reason = String(error?.message || error || "unreadable-manifest");
    return {
      available: false,
      reason: /^ENOENT|no such file/i.test(reason) ? "missing-manifest" : cleanText(reason, 120),
      sourceKind: source.kind,
      sourceLabel: source.label,
      configured: source.configured,
    };
  }
}

function currentServerIdentity({ projectRoot = process.cwd(), env = process.env, startedAt = "" } = {}) {
  const version = readServerVersion({ projectRoot, env });
  return {
    version: version.version,
    buildSha: version.buildSha,
    generatedAt: version.generatedAt,
    versionSource: version.source,
    startedAt: cleanText(startedAt, 40),
  };
}

/** `GET /api/desktop/update` body: current, latest and the read-only verdict. */
function desktopUpdatePayload(current, latest) {
  const newer = Boolean(latest?.available) && compareVersions(latest.version, current?.version) > 0;
  return {
    ok: true,
    current: {
      version: current?.version || "0.0.0",
      buildSha: current?.buildSha || "",
      startedAt: current?.startedAt || "",
      versionSource: current?.versionSource || "",
    },
    latest: latest?.available
      ? {
        available: true,
        version: latest.version,
        packageName: latest.packageName || "",
        sha256: latest.sha256 || "",
        sizeBytes: latest.sizeBytes || 0,
        downloadUrl: latest.downloadUrl || "",
        upgradeScript: latest.upgradeScript || "",
        notes: latest.notes || "",
        publishedAt: latest.publishedAt || "",
        generatedAt: latest.publishedAt || "",
      }
      : { available: false, reason: latest?.reason || "missing-manifest" },
    updateSource: { kind: latest?.sourceKind || "file", label: latest?.sourceLabel || "", configured: Boolean(latest?.configured) },
    updateAvailable: newer,
    upToDate: Boolean(latest?.available) && !newer,
  };
}

module.exports = {
  MANIFEST_NAME,
  PRODUCT,
  MAX_MANIFEST_BYTES,
  defaultManifestPath,
  readServerVersion,
  compareVersions,
  normalizeManifest,
  resolveUpdateSource,
  readDesktopRelease,
  currentServerIdentity,
  desktopUpdatePayload,
};
