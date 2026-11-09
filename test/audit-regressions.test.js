import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(path.join(ROOT, relative), "utf8");

test("appConfirm stays at module scope so approval buttons actually fire", () => {
  const source = read("public/app.js");
  // 回归：它曾被写进 renderMessages() 的 .map() 回调，5 个顶层调用点全部 ReferenceError。
  assert.match(source, /^function appConfirm\(/m, "appConfirm 必须是模块顶层函数声明");
  assert.ok(
    source.indexOf("function appConfirm(") < source.indexOf("function renderMessages("),
    "appConfirm 必须在 renderMessages 之前声明"
  );
  assert.match(source, /await appConfirm\(/, "审批/删除/压缩必须真的调用 appConfirm");
});

test("access codes are not baked into clients nor printed into background logs", () => {
  assert.doesNotMatch(read("mobile-app/src/services/appState.ts"), /token:\s*'\d{6}'/);
  const server = read("server.js");
  assert.match(server, /randomBytes\(18\)/, "默认访问码必须是高强度随机值");
  assert.match(server, /timingSafeEqual/, "令牌比较必须恒时");
  assert.match(server, /AUTH_MAX_FAILURES/, "登录失败必须有速率限制");
  assert.doesNotMatch(server, /logInfo\(`Access code: \$\{ACCESS_TOKEN\}`\)/, "后台日志不得明文打印访问码");
});

test("file streams carry error handlers and static reads are size-bounded", () => {
  const server = read("server.js");
  // 回归：裸 .pipe(res) 一旦 ENOENT/EPIPE，全局 uncaughtException 会 process.exit(1)。
  assert.doesNotMatch(server, /createReadStream\([^)]*\)\.pipe\(res\)/);
  assert.match(server, /function streamFileToResponse/);
  assert.match(server, /MAX_STATIC_INLINE_BYTES/);
});

test("json bodies are decoded once so multi-byte characters survive chunk boundaries", () => {
  const server = read("server.js");
  assert.match(server, /Buffer\.concat\(chunks, receivedBytes\)/, "请求体必须整体解码");
});

test("database writes use a writable sqlite connection", () => {
  const server = read("server.js");
  assert.match(server, /async function runSqlWrite/);
  assert.match(server, /readOnly: !write/, "只读连接不能执行 BEGIN/UPDATE");
  assert.match(server, /await runSqlWrite\(`/, "置顶写入必须走可写连接");
});

test("read-only mode blocks every write route, not just send/pin", () => {
  const server = read("server.js");
  const guards = (server.match(/if \(!requireWriteEnabled\(res\)\) return;/g) || []).length;
  assert.ok(guards >= 7, `写路由守卫数量不足：${guards}`);
});

test("mobile thread screen keeps stable callbacks instead of polling in a loop", () => {
  const source = read("mobile-app/src/app/thread/[id].tsx");
  // 回归：线程刷新若让 load/applyMessages/长轮询 effect 反复重建，就会重置游标并无限刷新。
  // PR #4 的最终实现以 contextKey + requestGate + loadSequence 隔离同一会话的请求生命周期。
  assert.doesNotMatch(source, /\[cacheKey, thread\]/);
  assert.match(source, /const contextKey =/);
  assert.match(source, /useRef\(createRequestGate\(\)\)/);
  assert.match(source, /loadSequence\.current/);
  assert.match(source, /threadRef/);
  assert.match(source, /\[cacheKey, contextKey, requestGate\]/);
});

test("web-ui poller regression is obsolete after the web-ui compatibility tree was removed", () => {
  // 当前公开仓库只保留原生 App 主线，web-ui 已整体移除；轮询回归不再有适用源码。
  assert.ok(!existsSync(path.join(ROOT, "web-ui/src/App.tsx")));
  const app = read("public/app.js");
  assert.doesNotMatch(app, /\[threads, showError\]/);
  assert.match(app, /function loadThreads\(/);
});

test("prune refuses --apply without an explicit time window", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, "scripts", "prune-session-artifacts.mjs"), "--apply", "--db", path.join(ROOT, "no-such.sqlite")],
    { encoding: "utf8" }
  );
  assert.equal(result.status, 2, "没有 --since 的 --apply 必须被拒绝");
});
