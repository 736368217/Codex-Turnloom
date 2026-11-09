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

/**
 * node --test 有两种输出：CI 里的 Node 22 用 TAP（"# fail 0"），
 * 本地 Node 24 在非 TTY 下可能用 spec reporter（"ℹ fail 0"）。
 * 只认一种会让另一种永远读到 0，把 fail/cancelled 门禁变成摆设。
 */
function tapSummary(text) {
  const pick = (label) => {
    const tap = new RegExp(`# ${label} (\\d+)`).exec(text);
    if (tap) return Number(tap[1]);
    const spec = new RegExp(`^\\u2139 ${label} (\\d+)`, "m").exec(text);
    return spec ? Number(spec[1]) : 0;
  };
  return {
    failed: pick("fail"),
    cancelled: pick("cancelled"),
    passed: pick("pass")
  };
}

function run(label, command, args, { capture = false, shell = false } = {}) {
  console.log(`\n[verify-ci] ${label}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? "pipe" : "inherit",
    // 只有 npm/npx 这类 .cmd shim 才走 shell。node 自身明确用 shell:false：
    // 一旦 Node 装在 "C:\Program Files\nodejs"，shell 会把未加引号的路径当成两条命令。
    shell
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

function runNodeTests(label, command, args, options = {}) {
  const result = run(label, command, args, { capture: true, ...options });
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
  // npx / npm 在 Windows 上是 .cmd shim，必须经 shell 才能启动。
  runNodeTests(`node ${CI_NODE_VERSION} --test (CI runtime)`, "npx", ["--yes", `node@${CI_NODE_VERSION}`, "--test"], { shell: true });
}
if (!process.exitCode) run("npm run check", "npm", ["run", "check"], { shell: true });
if (!process.exitCode) run("npm run desktop:check", "npm", ["run", "desktop:check"], { shell: true });
if (!process.exitCode) {
  console.log("\n[verify-ci] PASS: this commit would satisfy the GitHub Actions server job");
}
