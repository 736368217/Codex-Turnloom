"use strict";
/**
 * 分支（thread/fork）回归测试。
 *
 * 手机端「从这里创建分支」发的是 Codex 形状的 thread/fork(lastTurnId)，而 PI 宿主的
 * session/fork 只认 throughMessageId。桥必须自己把 turnId 换算成该轮最后一条消息的
 * id，并且把原会话的模型对继承给新会话（否则新会话第一次 prompt 直接
 * MODEL_NOT_CONFIGURED）。
 *
 * 安全性：PIPE_PATH 被重定向到临时管道名，PI_DB 被重定向到临时 sqlite，
 * 所以这个测试既不碰正在跑的实例，也不读写真实数据库。
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { DatabaseSync } = require("node:sqlite");

const SRC = path.join(__dirname, "plugin", "main.js");
const TMP_PIPE = `\\\\.\\pipe\\turnloom-fork-test-${Date.now()}`;
const outDir = path.join(os.tmpdir(), `turnloom-fork-test-${Date.now()}`);
fs.mkdirSync(outDir, { recursive: true });

// A tiny pi.sqlite with two turns, so the resolver has a deterministic fixture.
const fixtureDb = path.join(outDir, "pi.sqlite");
{
  const db = new DatabaseSync(fixtureDb);
  db.exec(`
    CREATE TABLE messages (mid INTEGER PRIMARY KEY, id TEXT, session_id TEXT, turn_id TEXT, seq INTEGER, role TEXT, tool_name TEXT, is_error INTEGER, text TEXT, created_at INTEGER, streaming INTEGER);
    CREATE TABLE turns (id TEXT, session_id TEXT, status TEXT, provider_id TEXT, model_id TEXT, started_at INTEGER, ended_at INTEGER);
  `);
  const insert = db.prepare(
    "INSERT INTO messages (id, session_id, turn_id, seq, role, text) VALUES (?, ?, ?, ?, ?, ?)",
  );
  insert.run("m-u1", "sess-1", "turn-1", 1, "user", "第一个问题");
  insert.run("m-a1", "sess-1", "turn-1", 2, "assistant", "第一个回答");
  insert.run("m-u2", "sess-1", "turn-2", 3, "user", "第二个问题");
  insert.run("m-a2", "sess-1", "turn-2", 4, "assistant", "第二个回答");
  db.close();
}

let source = fs.readFileSync(SRC, "utf8");
const before = source;
source = source.replace(
  'const PIPE_PATH = "\\\\\\\\.\\\\pipe\\\\pidesktop-codex-ipc";',
  `const PIPE_PATH = ${JSON.stringify(TMP_PIPE)};`,
);
if (source === before) {
  console.error("FAIL: could not redirect PIPE_PATH — refusing to run against the live pipe");
  process.exit(1);
}
// Point the resolver at the fixture instead of the real database: the real
// candidates are checked in order and would win, so the return is pinned.
const dbPatched = source.replace(
  "return candidates.find((p) => p && fs.existsSync(p)) || candidates[0];",
  `return ${JSON.stringify(fixtureDb)};`,
);
if (dbPatched === source) {
  console.error("FAIL: could not redirect the PI database path");
  process.exit(1);
}
source = `${dbPatched}\nmodule.exports = { handleAction, piForkPoint };\n`;

const testFile = path.join(outDir, "main.js");
fs.writeFileSync(testFile, source, "utf8");
for (const name of ["codex-side.cjs", "manifest.json"]) {
  fs.copyFileSync(path.join(path.dirname(SRC), name), path.join(outDir, name));
}

const calls = [];
global.pi = {
  desktop: {
    invoke: async ({ operation, args }) => {
      calls.push({ operation, args });
      if (operation === "session/fork") return { session: { id: "sess-forked" } };
      return { ok: true };
    },
  },
};

const plugin = require(testFile);
const fails = [];
const check = (label, condition, detail) => {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${!condition && detail ? " :: " + detail : ""}`);
  if (!condition) fails.push(label);
};

(async () => {
  // 1. Resolver: a turn maps to its last message; the previous turn maps correctly.
  check("turnId 解析为该轮最后一条消息", plugin.piForkPoint("sess-1", { lastTurnId: "turn-1" }).messageId === "m-a1");
  check("beforeTurnId 解析为该轮之前的最后一条消息", plugin.piForkPoint("sess-1", { beforeTurnId: "turn-2" }).messageId === "m-a1");
  check("没有轮次信息时退回会话末尾", plugin.piForkPoint("sess-1", {}).messageId === "m-a2");
  check("未知会话不返回 id", plugin.piForkPoint("sess-nope", { lastTurnId: "turn-1" }).messageId === "");

  // 手机端直接给消息 id 时最准；不属于这条会话的 id 必须被拒，否则能跨会话分叉。
  check("throughMessageId 优先", plugin.piForkPoint("sess-1", { throughMessageId: "m-u1" }).messageId === "m-u1");
  check("throughMessageId 不属于该会话时忽略", plugin.piForkPoint("sess-1", { throughMessageId: "m-other" }).messageId === "m-a2");

  // 分叉出来的会话 PI 会把 turn_id 清空，这时只能退到末尾 —— 要如实标记。
  check("退化到末尾时标记 branchFallback", plugin.piForkPoint("sess-1", { lastTurnId: "turn-local" }).fallback === true);
  check("按轮次命中时不算退化", plugin.piForkPoint("sess-1", { lastTurnId: "turn-1" }).fallback === false);

  // 2. The handler must translate and pass throughMessageId to session/fork.
  calls.length = 0;
  const result = await plugin.handleAction("thread/fork", { threadId: "sess-1", lastTurnId: "turn-1" }, 0);
  const fork = calls.find((c) => c.operation === "session/fork");
  check("thread/fork 调用宿主的 session/fork", Boolean(fork), JSON.stringify(calls.map((c) => c.operation)));
  check(
    "session/fork 收到换算后的 throughMessageId",
    Boolean(fork) && fork.args[0].throughMessageId === "m-a1",
    JSON.stringify(fork && fork.args[0]),
  );
  check("session/fork 只认 sessionId，不回传门面 id", Boolean(fork) && fork.args[0].sessionId === "sess-1");
  check("返回新会话 id 给手机", Boolean(result) && result.threadId === "sess-forked", JSON.stringify(result));
  check("正常轮次不标记退化", Boolean(result) && result.branchFallback === false, JSON.stringify(result));

  // 3. Missing threadId must fail loudly instead of forking something random.
  let threw = false;
  try {
    await plugin.handleAction("thread/fork", {}, 0);
  } catch {
    threw = true;
  }
  check("缺 threadId 时直接报错", threw);

  fs.rmSync(outDir, { recursive: true, force: true });
  console.log(`\n${fails.length} failure(s)`);
  process.exit(fails.length ? 1 : 0);
})();
