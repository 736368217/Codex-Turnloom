"use strict";

/**
 * 取证卫生（BACKLOG 3b，task:6cc144c0 的 2.2.6 项）：测试不许写进生产日志目录。
 *
 * 起因：36 个测试文件会 spawn `server.js`，其中只有两个设了 `TURNLOOM_LOG_DIR`，
 * 其余都落到 `%LOCALAPPDATA%\CodexPocket\logs\server-YYYYMMDD.log`——于是
 * 操作员点「上传日志」时，包里会带一批看起来像真实故障的 409/403/502/401。
 * 这比缺字段更糟：它会制造错误结论。
 *
 * 判据不是「我这次看过没写」，而是「`node --test` 的上下文里解析出来的目录
 * 一定不是生产目录」，并且这个约定对**子进程**同样成立（测试 spawn 的
 * server.js 继承 NODE_TEST_CONTEXT）。
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

const requestLog = require("../server/request-log.cjs");

const PROD_LOCAL = path.join("C:\\Users\\probe\\AppData\\Local", "CodexPocket", "logs");

test("测试上下文里解析到临时目录，不是生产目录", () => {
  const resolved = requestLog.resolveLogDir({ LOCALAPPDATA: "C:\\Users\\probe\\AppData\\Local", NODE_TEST_CONTEXT: "child-v8" });
  assert.equal(resolved, path.join(os.tmpdir(), "turnloom-test-logs"));
  assert.notEqual(resolved, PROD_LOCAL);
});

test("显式 TURNLOOM_LOG_DIR 仍然优先于测试上下文", () => {
  const resolved = requestLog.resolveLogDir({ NODE_TEST_CONTEXT: "child-v8", TURNLOOM_LOG_DIR: "D:\\logs" });
  assert.equal(resolved, path.resolve("D:\\logs"));
});

test("没有测试上下文时行为不变（生产目录）", () => {
  assert.equal(requestLog.resolveLogDir({ LOCALAPPDATA: "C:\\Users\\probe\\AppData\\Local" }), PROD_LOCAL);
});

test("spawn 出来的子进程继承这个约定（测试里的 server.js 走同一分支）", () => {
  const script = "process.stdout.write(require('./server/request-log.cjs').resolveLogDir())";
  const printed = execFileSync(process.execPath, ["-e", script], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, LOCALAPPDATA: "C:\\Users\\probe\\AppData\\Local", NODE_TEST_CONTEXT: "child-v8" },
    encoding: "utf8",
  }).trim();
  assert.equal(printed, path.join(os.tmpdir(), "turnloom-test-logs"));
});
