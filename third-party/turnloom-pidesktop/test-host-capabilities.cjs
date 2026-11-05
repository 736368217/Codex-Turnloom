"use strict";
/**
 * 宿主能力层回归测试（2026-11-05「全部功能落地」）。
 *
 * 覆盖三件事：
 *   1. 白名单是硬边界：未知操作、dangerous 无确认都必须被拒；
 *   2. 审批：plan_approvals 映射 + plans/resolve / tool/resolvePermission /
 *      agent/askTool 三条不同的宿主契约（都能带 confirm:true）；
 *   3. 只读聚合：待办、通知、定时任务、用量都从 pi.sqlite 真实取数。
 *
 * 安全：PIPE_PATH 与 PI_DB 都指向临时位置，绝不碰运行中的实例与真实数据库。
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { DatabaseSync } = require("node:sqlite");

const SRC = path.join(__dirname, "plugin", "main.js");
const TMP_PIPE = `\\\\.\\pipe\\turnloom-host-test-${Date.now()}`;
const outDir = path.join(os.tmpdir(), `turnloom-host-test-${Date.now()}`);
const dbPath = path.join(outDir, "pi.sqlite");
fs.mkdirSync(outDir, { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec(`
  CREATE TABLE plan_approvals (
    request_id TEXT PRIMARY KEY, session_id TEXT, turn_id TEXT, tool_call_id TEXT,
    kind TEXT, plan_json TEXT, title TEXT, question TEXT, status TEXT, action TEXT,
    target_permission_mode TEXT, feedback TEXT, created_at INTEGER, updated_at INTEGER,
    expires_at INTEGER, resolved_at INTEGER, error_code TEXT, artifact_relative_path TEXT,
    artifact_sha256 TEXT, artifact_size_bytes INTEGER, version INTEGER,
    execution_id TEXT, execution_state TEXT
  );
  CREATE TABLE session_todo (
    session_id TEXT, position INTEGER, content TEXT, status TEXT, priority TEXT, updated_at INTEGER
  );
  CREATE TABLE notifications (
    id TEXT PRIMARY KEY, kind TEXT, session_id TEXT, session_title TEXT, turn_id TEXT,
    error_code TEXT, created_at INTEGER, read_at INTEGER
  );
  CREATE TABLE scheduled_tasks (
    id TEXT PRIMARY KEY, title TEXT, prompt TEXT, cadence TEXT, enabled INTEGER,
    project_id TEXT, config_json TEXT, last_run_at INTEGER, created_at INTEGER, updated_at INTEGER
  );
  CREATE TABLE turns (
    id TEXT PRIMARY KEY, session_id TEXT, status TEXT, provider_id TEXT, model_id TEXT,
    error_code TEXT, input_tokens INTEGER, output_tokens INTEGER, usage_json TEXT,
    started_at INTEGER, ended_at INTEGER
  );
`);
db.prepare(
  `INSERT INTO plan_approvals (request_id,session_id,turn_id,tool_call_id,kind,title,question,status,created_at,updated_at,version)
   VALUES (?,?,?,?,?,?,?,?,?,?,?)`
).run("req-1", "s-1", "turn-1", "tool-1", "goal", "修复登录", "是否按此范围实施？", "pending", 1000, 1000, 2);
db.prepare(
  "INSERT INTO session_todo (session_id,position,content,status,priority,updated_at) VALUES (?,?,?,?,?,?)"
).run("s-1", 1, "复现问题", "completed", "high", 1000);
db.prepare("INSERT INTO session_todo (session_id,position,content,status,priority,updated_at) VALUES (?,?,?,?,?,?)")
  .run("s-1", 2, "修复并验收", "in_progress", "high", 1001);
db.prepare("INSERT INTO notifications (id,kind,session_id,session_title,created_at) VALUES (?,?,?,?,?)")
  .run("n-1", "task.completed", "s-1", "登录修复", 1002);
db.prepare("INSERT INTO notifications (id,kind,session_id,session_title,created_at,read_at) VALUES (?,?,?,?,?,?)")
  .run("n-2", "task.failed", "s-2", "旧会话", 900, 950);
db.prepare("INSERT INTO scheduled_tasks (id,title,prompt,cadence,enabled,last_run_at,created_at) VALUES (?,?,?,?,?,?,?)")
  .run("sch-1", "每小时巡检", "检查链接", "hourly", 1, 1003, 900);
db.prepare("INSERT INTO turns (id,session_id,status,provider_id,model_id,input_tokens,output_tokens,started_at,ended_at) VALUES (?,?,?,?,?,?,?,?,?)")
  .run("t-1", "s-1", "completed", "P1", "m1", 100, 20, 900, 1000);
db.prepare("INSERT INTO turns (id,session_id,status,provider_id,model_id,input_tokens,output_tokens,started_at,ended_at) VALUES (?,?,?,?,?,?,?,?,?)")
  .run("t-2", "s-1", "completed", "P1", "m1", 200, 40, 1000, 1100);
db.close();

let source = fs.readFileSync(SRC, "utf8");
const before = source;
source = source.replace(
  'const PIPE_PATH = "\\\\\\\\.\\\\pipe\\\\pidesktop-codex-ipc";',
  `const PIPE_PATH = ${JSON.stringify(TMP_PIPE)};`,
);
if (source === before) throw new Error("could not redirect PIPE_PATH");
source = source.replace("const PI_DB = resolvePiDb();", `const PI_DB = ${JSON.stringify(dbPath)};`);
if (!source.includes(JSON.stringify(dbPath))) throw new Error("could not redirect PI_DB");
source +=
  "\nmodule.exports = { hostInvoke, hostApprovals, hostApprovalsResolve, hostTodos, hostNotifications, hostNotificationsRead, hostScheduled, hostUsage };\n";
for (const name of ["codex-side.cjs", "manifest.json"]) {
  fs.copyFileSync(path.join(path.dirname(SRC), name), path.join(outDir, name));
}
const testFile = path.join(outDir, "main.js");
fs.writeFileSync(testFile, source, "utf8");

const calls = [];
global.pi = {
  desktop: {
    invoke: async (input) => {
      calls.push({ operation: input.operation, args: input.args, confirm: input.confirm });
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
  // 1. 白名单
  calls.length = 0;
  await plugin.hostInvoke({ operation: "fs/list", args: [{ sessionId: "s-1", path: "" }] });
  check("只读操作放行且不带 confirm", calls.length === 1 && calls[0].confirm === undefined, JSON.stringify(calls));

  let denied = null;
  try {
    await plugin.hostInvoke({ operation: "providers/getSecret", args: [] });
  } catch (error) {
    denied = error.message;
  }
  check("未知操作被白名单拒绝", /not allowed/i.test(String(denied)), String(denied));
  check("被拒的操作没有发到宿主", calls.length === 1, JSON.stringify(calls));

  let needConfirm = null;
  try {
    await plugin.hostInvoke({ operation: "session/delete", args: ["s-1"] });
  } catch (error) {
    needConfirm = error.message;
  }
  check("dangerous 无确认被拒", /explicit confirmation/i.test(String(needConfirm)), String(needConfirm));

  calls.length = 0;
  await plugin.hostInvoke({ operation: "session/delete", args: ["s-1"], confirm: true });
  check("dangerous 确认后带 confirm:true 下发", calls[0] && calls[0].confirm === true, JSON.stringify(calls[0]));

  // 2. 审批读数
  const listed = plugin.hostApprovals({ threadId: "s-1" });
  check("审批列表按会话过滤", listed.approvals.length === 1 && listed.approvals[0].requestId === "req-1", JSON.stringify(listed.approvals));
  check(
    "审批带齐 resolve 所需身份字段",
    listed.approvals[0].sessionId === "s-1" &&
      listed.approvals[0].turnId === "turn-1" &&
      listed.approvals[0].toolCallId === "tool-1" &&
      listed.approvals[0].version === 2,
    JSON.stringify(listed.approvals[0]),
  );

  // 3. 审批解决：plan
  calls.length = 0;
  await plugin.hostApprovalsResolve({
    kind: "goal",
    requestId: "req-1",
    sessionId: "s-1",
    turnId: "turn-1",
    toolCallId: "tool-1",
    version: 2,
    action: "approve",
    targetPermissionMode: "accept-edits",
    confirm: true,
  });
  check("plan 审批走 plans/resolve", calls[0] && calls[0].operation === "plans/resolve", JSON.stringify(calls[0]));
  check(
    "plans/resolve 参数形状符合宿主契约",
    calls[0] &&
      calls[0].args[0].proposalId === "req-1" &&
      calls[0].args[0].action === "approve" &&
      calls[0].args[0].targetPermissionMode === "accept-edits" &&
      calls[0].args[0].version === 2 &&
      calls[0].confirm === true,
    JSON.stringify(calls[0]),
  );

  let noConfirm = null;
  try {
    await plugin.hostApprovalsResolve({ kind: "goal", action: "approve", confirm: false, requestId: "req-1" });
  } catch (error) {
    noConfirm = error.message;
  }
  check("审批没有手机确认就不下发", /confirmation/i.test(String(noConfirm)), String(noConfirm));

  // 4. 审批解决：permission / ask
  calls.length = 0;
  await plugin.hostApprovalsResolve({ kind: "permission", requestId: "perm-1", decision: "allow-once", confirm: true });
  check(
    "permission 走 tool/resolvePermission",
    calls[0] && calls[0].operation === "tool/resolvePermission" && calls[0].args[0].requestId === "perm-1" && calls[0].args[0].decision === "allow-once",
    JSON.stringify(calls[0]),
  );
  calls.length = 0;
  await plugin.hostApprovalsResolve({ kind: "ask", sessionId: "s-1", requestId: "ask-1", answer: "用 A 方案", confirm: true });
  check(
    "ask 走 agent/askTool/resolve",
    calls[0] && calls[0].operation === "agent/askTool/resolve" && calls[0].args[0].answer === "用 A 方案",
    JSON.stringify(calls[0]),
  );

  // 5. 待办 / 通知 / 定时 / 用量
  const todos = plugin.hostTodos({ threadId: "s-1" });
  check("待办按 position 排序", todos.todos.map((t) => t.content).join("|") === "复现问题|修复并验收", JSON.stringify(todos.todos));
  const notifications = plugin.hostNotifications({ limit: 30 });
  check("通知带未读数", notifications.notifications.length === 2 && notifications.unread === 1, JSON.stringify({ n: notifications.notifications.length, unread: notifications.unread }));
  plugin.hostNotificationsRead({ id: "n-1" });
  check("标记已读后未读归零", plugin.hostNotifications({ limit: 30 }).unread === 0);
  const scheduled = plugin.hostScheduled({});
  check("定时任务可读", scheduled.tasks.length === 1 && scheduled.tasks[0].cadence === "hourly", JSON.stringify(scheduled.tasks));
  const usage = plugin.hostUsage({ threadId: "s-1" });
  check("用量按会话聚合", usage.totals.turns === 2 && usage.totals.inputTokens === 300 && usage.totals.outputTokens === 60, JSON.stringify(usage.totals));
  check("用量返回最近轮次", usage.turns.length === 2 && usage.turns[0].id === "t-2", JSON.stringify(usage.turns.map((t) => t.id)));

  fs.rmSync(outDir, { recursive: true, force: true });
  console.log(`\n${fails.length} failure(s)`);
  process.exit(fails.length ? 1 : 0);
})();
