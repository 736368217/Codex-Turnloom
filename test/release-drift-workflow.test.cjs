"use strict";

/**
 * The release-drift sentinel must not depend on one machine being awake.
 *
 * It used to run as a Host subscription; that executor has been failing with
 * spawn-failed since 2026-11-21, so the check now also runs in GitHub Actions on
 * a schedule and on `release: published`. This test pins the wiring, and pins
 * the one security rule in the script: the GitHub token goes to api.github.com
 * only, never to the update-channel host.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const WORKFLOW = path.join(ROOT, ".github", "workflows", "release-drift.yml");
const SCRIPT = path.join(ROOT, "scripts", "team", "release-drift.ps1");

test("release drift runs in CI on a schedule and after a release", () => {
  const yaml = fs.readFileSync(WORKFLOW, "utf8");
  assert.match(yaml, /release:\s*\r?\n\s*types:\s*\[published\]/);
  assert.match(yaml, /cron:\s*'17 \*\/6 \* \* \*'/);
  assert.match(yaml, /scripts\/team\/release-drift\.ps1/);
  assert.match(yaml, /::error title=Release drift/);
  assert.match(yaml, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  // A .ps1 call never sets $LASTEXITCODE; asserting on it failed every run.
  assert.doesNotMatch(yaml, /\$LASTEXITCODE/);
  assert.match(yaml, /if \(-not \$\?\)/);
});

test("the drift script keeps its UTF-8 BOM (Windows PowerShell 5.1 reads BOM-less files as ANSI)", () => {
  const bytes = fs.readFileSync(SCRIPT);
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  // A BOM-less edit once turned every Chinese string into a parse error.
  assert.ok(bytes.length > 3000);
});

test("the GitHub token is sent to the API only, not to the channel host", () => {
  const source = fs.readFileSync(SCRIPT, "utf8");
  assert.match(source, /\$apiHeaders\['authorization'\] = "Bearer \$env:GITHUB_TOKEN"/);
  // The channel request keeps the unauthenticated header set.
  assert.match(source, /Invoke-RestMethod -Uri \$channel -TimeoutSec 20 -Headers \$headers/);
  assert.match(source, /releases\/latest" -TimeoutSec 20 -Headers \$apiHeaders/);
});
