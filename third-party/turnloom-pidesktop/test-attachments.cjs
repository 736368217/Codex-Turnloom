"use strict";
/**
 * 图片附件回归测试。
 *
 * 背景：Codex 侧把图片作为 {type:"image", url:"data:<mime>;base64,<data>"} 放进 input。
 * 宿主 agent/prompt 的 attachments 不是内联 base64，而是「磁盘路径」：
 * preparePromptAttachments() 会读 attachment.path 并在 <dataRoot>/scratch/<sessionId>、
 * <dataRoot>/attachments、项目根之内解析，否则抛 PATH_OUTSIDE_WORKSPACE；缺 name 时
 * 宿主 name.trim() 直接崩。历史上先后踩过「静默丢图」和「只传 base64 崩宿主」两个坑。
 *
 * 用法：node test-attachments.cjs
 * 安全：会把 PIPE_PATH 改到临时管道名，绝不碰正在运行的实例。
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { DatabaseSync } = require("node:sqlite");

const SRC = path.join(__dirname, "plugin", "main.js");
const TMP_PIPE = `\\\\.\\pipe\\turnloom-attach-test-${Date.now()}`;
const outDir = path.join(os.tmpdir(), `turnloom-attach-test-${Date.now()}`);
const dbPath = path.join(outDir, "pi.sqlite");
fs.mkdirSync(outDir, { recursive: true });

// 夹具：足够回答「这条会话的模型还能不能用」。发送前的模型闸门会读它，
// 因此这里不能省，否则测试会去读真实的 pi.sqlite。
{
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE providers (id TEXT PRIMARY KEY, name TEXT, enabled INTEGER, default_model_id TEXT);
    CREATE TABLE models (provider_id TEXT, model_id TEXT, display_name TEXT, capabilities_json TEXT);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, provider_id TEXT, model_id TEXT, deleted_at INTEGER);
    CREATE TABLE turns (
      id TEXT PRIMARY KEY, session_id TEXT, status TEXT, provider_id TEXT,
      model_id TEXT, started_at INTEGER, ended_at INTEGER
    );
    CREATE TABLE messages (
      mid INTEGER PRIMARY KEY, id TEXT, session_id TEXT, turn_id TEXT, seq INTEGER,
      role TEXT, tool_name TEXT, is_error INTEGER, text TEXT, created_at INTEGER, streaming INTEGER
    );
    CREATE TABLE turn_queue (
      id TEXT PRIMARY KEY, session_id TEXT, principal TEXT, idempotency_key TEXT,
      input_hash TEXT, content TEXT, attachments_json TEXT, permission_mode TEXT,
      position INTEGER, priority INTEGER, created_at INTEGER,
      session_message_id TEXT, user_message_id TEXT, voice_origin_json TEXT
    );
  `);
  db.prepare("INSERT INTO providers (id,name,enabled,default_model_id) VALUES (?,?,?,?)")
    .run("P1", "vision-provider", 1, "vision-model");
  db.prepare("INSERT INTO models (provider_id,model_id,display_name,capabilities_json) VALUES (?,?,?,?)")
    .run("P1", "vision-model", "vision-model", '["text","vision"]');
  db.prepare("INSERT INTO sessions (id,provider_id,model_id,deleted_at) VALUES (?,?,?,?)")
    .run("session-from-stub", "P1", "vision-model", null);
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
source = source.replace("const PI_DB = resolvePiDb();", `const PI_DB = ${JSON.stringify(dbPath)};`);
if (!source.includes(JSON.stringify(dbPath))) {
  console.error("FAIL: could not redirect PI_DB — refusing to touch the live database");
  process.exit(1);
}
source += "\nmodule.exports = { attachmentsFromTurnInput, textFromTurnInput, handleAction, stageAttachmentFile, PI_DATA_ROOT };\n";

for (const name of ["codex-side.cjs", "manifest.json"]) {
  fs.copyFileSync(path.join(path.dirname(SRC), name), path.join(outDir, name));
}
const testFile = path.join(outDir, "main.js");
fs.writeFileSync(testFile, source, "utf8");

const calls = [];
global.pi = {
  desktop: {
    invoke: async ({ operation, args }) => {
      calls.push({ operation, payload: args[0] });
      if (operation === "session/create") return { session: { id: "session-from-stub" } };
      return { ok: true };
    },
  },
};

const plugin = require(testFile);

// 一张真实的最小 PNG（1x1 蓝色），不依赖任何外部素材。
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const fails = [];
const check = (label, condition, detail) => {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${!condition && detail ? " :: " + detail : ""}`);
  if (!condition) fails.push(label);
};

const staged = plugin.attachmentsFromTurnInput(
  [
    { type: "text", text: "look", text_elements: [] },
    { type: "image", url: `data:image/png;base64,${PNG_BASE64}` },
  ],
  "session-from-stub",
);
check("一张图 → 一个附件", staged.length === 1, JSON.stringify(staged).slice(0, 160));
check("附件带 path（宿主硬要求）", Boolean(staged[0] && staged[0].path), JSON.stringify(staged[0]));
check("附件带 name（宿主会 name.trim()）", Boolean(staged[0] && staged[0].name), JSON.stringify(staged[0]));
check("kind 是 image", staged[0] && staged[0].kind === "image");
check("文件真的落盘了", Boolean(staged[0] && fs.existsSync(staged[0].path)));
check("落盘字节与载荷一致", staged[0] && fs.readFileSync(staged[0].path).toString("base64") === PNG_BASE64);
const root = path.resolve(plugin.PI_DATA_ROOT, "scratch", "session-from-stub");
check("路径落在 <dataRoot>/scratch/<sessionId> 下", staged[0] && path.resolve(staged[0].path).startsWith(root), staged[0] && staged[0].path);
check("不把内联 base64 泄给宿主", staged[0] && staged[0].data === undefined);

const jpeg = plugin.attachmentsFromTurnInput([{ type: "image", data: "QUJD", mimeType: "image/jpeg" }], "s2");
check("jpeg 保留 mime 与扩展名", jpeg[0] && jpeg[0].mimeType === "image/jpeg" && jpeg[0].path.endsWith(".jpg"), JSON.stringify(jpeg[0]));
const bare = plugin.attachmentsFromTurnInput([{ type: "image", data: "QUJD" }], "s2");
check("裸 data 默认 image/png", bare[0] && bare[0].mimeType === "image/png" && bare[0].path.endsWith(".png"), JSON.stringify(bare[0]));
check("远程 url 不当内联数据处理", plugin.attachmentsFromTurnInput([{ type: "image", url: "https://x.test/a.png" }], "s2").length === 0);
check("纯文本不产出附件", plugin.attachmentsFromTurnInput([{ type: "text", text: "x" }], "s2").length === 0);

(async () => {
  calls.length = 0;
  await plugin.handleAction(
    "start-conversation",
    { input: [{ type: "text", text: "new", text_elements: [] }, { type: "image", url: `data:image/png;base64,${PNG_BASE64}` }] },
    0,
  );
  const created = calls.find((c) => c.operation === "session/create");
  const prompt = calls.find((c) => c.operation === "agent/prompt");
  check("先建会话再落盘附件", Boolean(created) && Boolean(prompt));
  check(
    "prompt 带的是路径型附件",
    prompt && Array.isArray(prompt.payload.attachments) && prompt.payload.attachments.length === 1,
    JSON.stringify(prompt && prompt.payload),
  );
  check(
    "附件目录用的是新建会话的 id",
    prompt && path.resolve(prompt.payload.attachments[0].path).includes("session-from-stub"),
    prompt && prompt.payload.attachments[0].path,
  );

  calls.length = 0;
  await plugin.handleAction(
    "thread-follower-start-turn",
    {
      conversationId: "session-from-stub",
      turnStart: { request: { threadId: "session-from-stub", input: [{ type: "image", url: `data:image/png;base64,${PNG_BASE64}` }] } },
    },
    2,
  );
  const followUp = calls.find((c) => c.operation === "agent/prompt");
  check("只发图的一轮也被接受并转发", followUp && followUp.payload.attachments.length === 1);

  calls.length = 0;
  await plugin.handleAction(
    "thread-follower-steer-turn",
    { conversationId: "session-from-stub", input: [{ type: "image", url: `data:image/png;base64,${PNG_BASE64}` }] },
    4,
  );
  const steer = calls.find((c) => c.operation === "agent/prompt");
  check("steer 同样转发附件", steer && steer.payload.attachments.length === 1);

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${fails.length} failure(s)`);
  process.exit(fails.length ? 1 : 0);
})();