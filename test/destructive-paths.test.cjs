"use strict";

/**
 * Host-safety gate (2026-11-21 incident).
 *
 * A PowerShell cleanup once did `$HOME = <scratch dir>` and then
 * `Remove-Item -Recurse -Force $HOME`. `$HOME` is a read-only automatic
 * variable, so the assignment raised a NON-terminating error, `$HOME` still
 * pointed at C:\Users\Administrator, and the delete removed the real profile
 * (1,132 Remove-Item errors, git history and ~/.dsh gone with it).
 *
 * A rule in AGENTS.md only helps if someone reads it. This test fails the
 * build when the two shapes come back:
 *   1. assigning `$HOME` (or `$env:HOME`) in a PowerShell file;
 *   2. `Remove-Item` aimed at `$HOME`, `$env:USERPROFILE`, `~` or a bare
 *      `$env:HOME` — the profile is never a cleanup target.
 *
 * Reading the profile (Join-Path $env:USERPROFILE '.android\debug.keystore')
 * stays allowed: this gate is about assignment and deletion, not discovery.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SKIP = new Set(["node_modules", ".git", ".scratch", "dist-app", "tmp", "build", ".gradle"]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ps1|psm1)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

const scriptFiles = walk(ROOT);

test("no script assigns the read-only $HOME automatic variable", () => {
  const offenders = [];
  for (const file of scriptFiles) {
    const text = fs.readFileSync(file, "utf8");
    text.split(/\r?\n/).forEach((line, index) => {
      // `$HOME = ...`, `$home=...`, `$env:HOME = ...` and `Set-Item Env HOME`.
      if (/^\s*\$HOME\s*=/i.test(line) || /^\s*\$env:HOME\s*=/i.test(line)) {
        offenders.push(`${path.relative(ROOT, file)}:${index + 1}  ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(offenders, [], `never assign $HOME — it is read-only and the failure is non-terminating:\n${offenders.join("\n")}`);
});

test("no script deletes the user profile or a bare $HOME", () => {
  const offenders = [];
  for (const file of scriptFiles) {
    const text = fs.readFileSync(file, "utf8");
    text.split(/\r?\n/).forEach((line, index) => {
      if (!/Remove-Item|rmdir|\.Delete\(/i.test(line)) return;
      if (/\$HOME\b|\$env:HOME\b|\$env:USERPROFILE\b|%USERPROFILE%|\s~\//i.test(line)) {
        offenders.push(`${path.relative(ROOT, file)}:${index + 1}  ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(offenders, [], `a recursive delete may only target a root this run created:\n${offenders.join("\n")}`);
});
