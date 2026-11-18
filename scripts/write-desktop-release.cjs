#!/usr/bin/env node
"use strict";

/**
 * Write `public/downloads/desktop-release.json` beside a staged server zip.
 *
 * The manifest is what the Windows console's "检查更新" reads: version, size,
 * sha256, download path. It is generated from the artifact, never hand-edited,
 * so the console can trust the digest.
 *
 *   node scripts/write-desktop-release.cjs ^
 *     --zip public/downloads/turnloom-2.2.1-server.zip ^
 *     --version 2.2.1 ^
 *     --url /downloads/turnloom-2.2.1-server.zip ^
 *     [--notes "本次更新内容"] [--upgrade-script /downloads/update-turnloom.ps1] [--dry-run]
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MANIFEST_NAME = "desktop-release.json";

function fail(message) {
  process.stderr.write(`[desktop-release] ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { notes: "", upgradeScript: "", dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") { options.dryRun = true; continue; }
    const value = argv[index + 1];
    if (!arg.startsWith("--") || value === undefined) continue;
    index += 1;
    if (arg === "--zip") options.zip = value;
    else if (arg === "--version") options.version = value;
    else if (arg === "--url") options.url = value;
    else if (arg === "--notes") options.notes = value;
    else if (arg === "--upgrade-script") options.upgradeScript = value;
    else fail(`unknown argument: ${arg}`);
  }
  return options;
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.zip) fail("--zip <staged.zip> is required");
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(String(options.version || ""))) fail("--version must look like 2.2.1");
  const zipPath = path.resolve(options.zip);
  const stat = fs.statSync(zipPath);
  if (!stat.isFile() || stat.size <= 0) fail(`not a staged file: ${zipPath}`);
  if (!/^(?:\/(?!\/)|https?:\/\/)/.test(String(options.url || ""))) fail("--url must be /downloads/... or an https URL");

  const manifest = {
    schemaVersion: 1,
    product: "codex-turnloom",
    version: options.version,
    packageName: path.basename(zipPath),
    sizeBytes: stat.size,
    sha256: await sha256File(zipPath),
    downloadUrl: options.url,
    ...(options.upgradeScript ? { upgradeScript: options.upgradeScript } : {}),
    ...(options.notes ? { notes: String(options.notes).slice(0, 500) } : {}),
    publishedAt: new Date().toISOString(),
  };
  const output = path.join(path.dirname(zipPath), MANIFEST_NAME);
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    return;
  }
  fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`${output}\n${manifest.sha256}  ${manifest.sizeBytes}  ${manifest.version}\n`);
}

main().catch((error) => fail(error?.message || String(error)));
