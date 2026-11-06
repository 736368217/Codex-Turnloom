import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CI_NODE_VERSION = "22";

function fail(message) {
  console.error(`[verify-ci] ${message}`);
  process.exitCode = 1;
}

function tapSummary(text) {
  return {
    failed: Number(/# fail (\d+)/.exec(text)?.[1] || 0),
    cancelled: Number(/# cancelled (\d+)/.exec(text)?.[1] || 0),
    passed: Number(/# pass (\d+)/.exec(text)?.[1] || 0)
  };
}

function run(label, command, args, { capture = false } = {}) {
  console.log(`\n[verify-ci] ${label}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? "pipe" : "inherit",
    shell: process.platform === "win32"
  });
  if (capture) {
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
  }
  if (result.error) {
    fail(`${label}: ${result.error.message}`);
    return null;
  }
  if (result.status !== 0) fail(`${label}: exit ${result.status}`);
  return result;
}

function runNodeTests(label, command, args) {
  const result = run(label, command, args, { capture: true });
  if (!result) return;
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const summary = tapSummary(output);
  // A nested test() can pass on Node 24 but be cancelled by Node 22's parent.
  // Require an explicit zero for both failures and cancellations.
  if (result.status !== 0 || summary.failed || summary.cancelled) {
    fail(`${label}: exit ${result.status}, ${summary.passed} pass, ${summary.failed} fail, ${summary.cancelled} cancelled`);
  } else {
    console.log(`[verify-ci] ${label}: ${summary.passed} pass, 0 fail, 0 cancelled`);
  }
}

console.log("[verify-ci] Checking test-file syntax");
for (const name of fs.readdirSync(path.join(ROOT, "test"))) {
  if (!/\.(?:test\.(?:js|cjs|mjs)|\.cjs|\.js)$/.test(name)) continue;
  const file = path.join("test", name);
  const check = run(`node --check ${file}`, process.execPath, ["--check", file]);
  if (!check || check.status !== 0) break;
}

if (!process.exitCode) runNodeTests("node --test (local runtime)", process.execPath, ["--test"]);
if (!process.exitCode) {
  // Keep the local check honest: CI currently runs Node 22, whose scheduler
  // exposed the cancelledByParent regression that local Node 24 did not.
  runNodeTests(`node ${CI_NODE_VERSION} --test (CI runtime)`, "npx", ["--yes", `node@${CI_NODE_VERSION}`, "--test"]);
}
if (!process.exitCode) run("npm run check", "npm", ["run", "check"]);
if (!process.exitCode) run("npm run desktop:check", "npm", ["run", "desktop:check"]);
if (!process.exitCode) {
  console.log("\n[verify-ci] PASS: this commit would satisfy the GitHub Actions server job");
}
