#!/usr/bin/env node
/**
 * 取证卫生检查（BACKLOG 3b）：跑整套测试时，任何日志落点都必须在临时目录里。
 *
 *   node tools/qa/check-log-hygiene.mjs                     # 跑 node --test
 *   node tools/qa/check-log-hygiene.mjs -- node --test test/log-bundle.test.cjs
 *
 * 做法：给整套测试一个**假的 LOCALAPPDATA**，并去掉所有 TURNLOOM_LOG_DIR
 * 覆盖。如果 `node --test` 的上下文没有把默认日志目录改到临时目录，测试就会
 * 在假 LOCALAPPDATA 下建出 `CodexPocket\logs`——这正是检查要抓的东西。
 *
 * 为什么不比对真机上那个目录的字节数：这台机器同时也在跑真服务，`server-*.log`
 * 和 `supervisor.log` 会一直长，那样的断言永远红，等于没断言。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-hygiene-"));

const env = { ...process.env, LOCALAPPDATA: scratch, APPDATA: path.join(scratch, "Roaming") };
for (const key of ["TURNLOOM_LOG_DIR", "CODEX_LAN_LOG_DIR", "NODE_TEST_CONTEXT"]) delete env[key];

// `npm test` is exactly `node --test`; going through npm adds a .cmd shim that
// spawnSync cannot start without a shell, so call node directly.
const override = process.argv.slice(2);
if (override[0] === "--") override.shift();
const [command, ...args] = override.length ? override : [process.execPath, "--test"];
console.log(`scratch LOCALAPPDATA: ${scratch}`);
const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit", env });
if (result.status !== 0) {
  const detail = result.error ? `spawn ${command}: ${result.error.message}` : `exit ${result.status}${result.signal ? ` (${result.signal})` : ""}`;
  console.error(`FAIL: 测试本身没通过（${detail}），先修测试再看日志卫生`);
  process.exit(result.status || 1);
}

const leaked = [];
const logRoot = path.join(scratch, "CodexPocket", "logs");
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile()) leaked.push(`${path.relative(logRoot, full)} (${fs.statSync(full).size} B)`);
  }
}
walk(logRoot);
fs.rmSync(scratch, { recursive: true, force: true });

if (leaked.length) {
  console.error("FAIL: 测试写进了默认（生产形状）日志目录");
  for (const line of leaked) console.error(`  ${line}`);
  process.exit(1);
}
console.log("PASS: 整套测试没有任何写入落到默认日志目录（全部走了测试上下文里的临时目录）");
