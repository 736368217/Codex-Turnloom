"use strict";
/**
 * 模型路由回归测试（2026-10-30 首次事故 + 2026-11-05 级联事故）。
 *
 * 事故一（2026-10-30）：桥把「providerName + 裸 modelId」塞进 agent/prompt，
 * 宿主 schema 里没有这些字段，会话被写成一个不存在的组合，下一轮 MODEL_NOT_CONFIGURED。
 *
 * 事故二（2026-11-05，用户原话「发完图之后再发普通消息也会失败，一张图就把整个会话拖垮了」）：
 *   1. 手机端每轮都带模型 slug，桥调 session/configure 却没带宿主契约要求的 confirm:true；
 *   2. 调用被拒后桥吞掉错误，继续 agent/prompt；
 *   3. 会话 provider 已失效，宿主 resolveAgentRuntimeLaunch 抛 No provider configured；
 *   4. 之后每条普通消息重复同一条坏路径。
 *
 * 本测试钉住四条不变式：
 *   A. session/create 只用 (providerId, modelId, thinkingLevel)。
 *   B. agent/prompt 不带任何模型字段。
 *   C. 换模型必须 session/configure + confirm:true；被拒就中止本轮，绝不再 prompt。
 *   D. 会话模型已失效时，发送前自动修复到确定可用的模型；找不到可用模型就明确报错。
 *
 * 用法：node test-model-routing.cjs
 * 安全：PIPE_PATH 与 PI_DB 都重定向到临时位置，绝不碰正在运行的实例和真实数据库。
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { DatabaseSync } = require("node:sqlite");

const SRC = path.join(__dirname, "plugin", "main.js");
const TMP_PIPE = `\\\\.\\pipe\\turnloom-model-test-${Date.now()}`;
const outDir = path.join(os.tmpdir(), `turnloom-model-test-${Date.now()}`);
const dbPath = path.join(outDir, "pi.sqlite");
fs.mkdirSync(outDir, { recursive: true });

// ── 夹具：PI 的 providers × models × sessions × turns ─────────────────────
const db = new DatabaseSync(dbPath);
db.exec(`
  CREATE TABLE providers (
    id TEXT PRIMARY KEY, name TEXT, enabled INTEGER, default_model_id TEXT
  );
  CREATE TABLE models (
    provider_id TEXT, model_id TEXT, display_name TEXT, capabilities_json TEXT
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY, provider_id TEXT, model_id TEXT, deleted_at INTEGER,
    title TEXT, last_seq INTEGER, updated_at INTEGER
  );
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
  .run("P1", "77625 free", 1, "x-deepseek-v4.1-flash");
db.prepare("INSERT INTO providers (id,name,enabled,default_model_id) VALUES (?,?,?,?)")
  .run("P2", "U2", 1, "deepseek-v4.1-flash");
db.prepare("INSERT INTO providers (id,name,enabled,default_model_id) VALUES (?,?,?,?)")
  .run("P3", "hub-4.1auto", 1, "deepseek-v4.1-flash");
// P4 已禁用：事故里会话正是被写到了这类供应商上。
db.prepare("INSERT INTO providers (id,name,enabled,default_model_id) VALUES (?,?,?,?)")
  .run("P4", "disabled-provider", 0, "ghost-model");
const insModel = db.prepare("INSERT INTO models (provider_id,model_id,display_name,capabilities_json) VALUES (?,?,?,?)");
insModel.run("P1", "x-deepseek-v4.1-flash", "x-deepseek-v4.1-flash", '["text","vision"]');
insModel.run("P2", "deepseek-v4.1-flash", "deepseek-v4.1-flash", '["text"]');
insModel.run("P3", "deepseek-v4.1-flash", "deepseek-v4.1-flash", '["text"]');
insModel.run("P3", "community/vendouple/deepseek-v4.1-flash", "nested", '["text"]');
insModel.run("P4", "ghost-model", "ghost-model", '["text"]');
const insSession = db.prepare("INSERT INTO sessions (id,provider_id,model_id,deleted_at,title,last_seq,updated_at) VALUES (?,?,?,?,?,?,?)");
// sess-broken：供应商被禁用 → 宿主必抛 No provider configured。
// sess-healthy：正常会话。
insSession.run("sess-healthy", "P1", "x-deepseek-v4.1-flash", null, "healthy", 1, Date.now());
// sess-same：桥刚重载、内存里还没有快照，但数据库里的模型与手机端所选相同。
insSession.run("sess-same", "P1", "x-deepseek-v4.1-flash", null, "same", 1, Date.now());
db.prepare("INSERT INTO turns (id,session_id,status,provider_id,model_id,started_at,ended_at) VALUES (?,?,?,?,?,?,?)")
  .run("t-good", "sess-broken", "completed", "P1", "x-deepseek-v4.1-flash", 1, 2);
db.close();

// ── 加载桥源码（重定向管道与数据库） ─────────────────────────────────────
let source = fs.readFileSync(SRC, "utf8");
const before = source;
source = source.replace(
  'const PIPE_PATH = "\\\\\\\\.\\\\pipe\\\\pidesktop-codex-ipc";',
  `const PIPE_PATH = ${JSON.stringify(TMP_PIPE)};`,
);
if (source === before) throw new Error("could not redirect PIPE_PATH — refusing to run against the live pipe");
source = source.replace("const PI_DB = resolvePiDb();", `const PI_DB = ${JSON.stringify(dbPath)};`);
if (!source.includes(JSON.stringify(dbPath))) throw new Error("could not redirect PI_DB");
source +=
  "\nmodule.exports = { handleAction, turnSettingsFromRequest, buildModelIndex, ensureSendableModel, modelPairUsable, sessionModelPair, fallbackModelPair, applyModelIfChanged, modelCapabilities, modelVisionFromRow };\n";

for (const name of ["codex-side.cjs", "manifest.json"]) {
  fs.copyFileSync(path.join(path.dirname(SRC), name), path.join(outDir, name));
}
const testFile = path.join(outDir, "main.js");
fs.writeFileSync(testFile, source, "utf8");

// ── 宿主 stub：可编程拒绝 session/configure ───────────────────────────────
const calls = [];
let refuseConfigure = null;
global.pi = {
  desktop: {
    invoke: async (input) => {
      calls.push({ operation: input.operation, args: input.args, confirm: input.confirm });
      if (input.operation === "session/create") return { session: { id: "sess-new" } };
      if (input.operation === "session/configure" && refuseConfigure) {
        throw Object.assign(new Error(refuseConfigure), { code: "PERMISSION_DENIED" });
      }
      if (input.operation === "session/configure") {
        // 宿主成功后会把配置写进会话；夹具里同步写，供发送前复核。
        const [id, config] = input.args;
        const live = new DatabaseSync(dbPath);
        live.prepare("UPDATE sessions SET provider_id = ?, model_id = ? WHERE id = ?")
          .run(config.providerId, config.modelId, id);
        live.close();
      }
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
const opsOf = () => calls.map((call) => call.operation);

plugin.buildModelIndex([
  { provider_id: "P1", provider_name: "77625 free", model_id: "x-deepseek-v4.1-flash", provider_enabled: 1 },
  { provider_id: "P2", provider_name: "U2", model_id: "deepseek-v4.1-flash", provider_enabled: 1 },
  { provider_id: "P3", provider_name: "hub-4.1auto", model_id: "deepseek-v4.1-flash", provider_enabled: 1 },
  { provider_id: "P3", provider_name: "hub-4.1auto", model_id: "community/vendouple/deepseek-v4.1-flash", provider_enabled: 1 },
]);

// ── 1. slug 解析 ─────────────────────────────────────────────────────────
const bySlug = plugin.turnSettingsFromRequest({ model: "77625 free/x-deepseek-v4.1-flash" });
check("门面 slug 解析成 id 对", bySlug.providerId === "P1" && bySlug.modelId === "x-deepseek-v4.1-flash", JSON.stringify(bySlug));

const byPair = plugin.turnSettingsFromRequest({ model: "P2/deepseek-v4.1-flash" });
check("providerId/modelId 解析", byPair.providerId === "P2" && byPair.modelId === "deepseek-v4.1-flash", JSON.stringify(byPair));

const nested = plugin.turnSettingsFromRequest({ model: "hub-4.1auto/community/vendouple/deepseek-v4.1-flash" });
check(
  "含斜杠的 modelId 不被首个斜杠切坏",
  nested.providerId === "P3" && nested.modelId === "community/vendouple/deepseek-v4.1-flash",
  JSON.stringify(nested),
);

const poison = plugin.turnSettingsFromRequest({ model: "77625 free/deepseek-v4.1-flash" });
check("provider×model 不存在时整对丢弃", poison.providerId === undefined && poison.modelId === undefined, JSON.stringify(poison));

const ambiguous = plugin.turnSettingsFromRequest({ model: "deepseek-v4.1-flash" });
check("多个供应商共有裸 modelId 时不猜", ambiguous.modelId === undefined, JSON.stringify(ambiguous));
const preferred = plugin.turnSettingsFromRequest({ model: "deepseek-v4.1-flash" }, "P3");
check("裸 modelId 优先沿用会话自己的供应商", preferred.providerId === "P3", JSON.stringify(preferred));

// ── 2. 模型能力（纯文本模型不能带图） ────────────────────────────────────
check("capabilities 能识别视觉模型", plugin.modelCapabilities('["text","vision"]').vision === true);
check("capabilities 纯文本返回 false", plugin.modelCapabilities('["text"]').vision === false);
check("capabilities 坏 JSON 保守按纯文本", plugin.modelCapabilities("{oops").vision === false);
// 真机事实：krisphyn 的 cn:hy4 在 capabilities_json 里是 ["text"]，但供应商
// config_json 明确写了 supportsImages:true。只看能力表会误拦能用的模型。
const visionRow = {
  model_id: "cn:hy4",
  capabilities_json: '["text"]',
  provider_config_json: JSON.stringify({ models: [{ id: "cn:hy4", supportsImages: true }] }),
};
check("供应商显式 supportsImages 优先于过时能力表", plugin.modelVisionFromRow(visionRow) === true);
const textRow = {
  model_id: "cn:deepseek-v4.1-flash",
  capabilities_json: '["vision"]',
  provider_config_json: JSON.stringify({ models: [{ id: "cn:deepseek-v4.1-flash", supportsImages: false }] }),
};
check("供应商显式 false 时按 false", plugin.modelVisionFromRow(textRow) === false);
check(
  "没有供应商声明时退回能力表",
  plugin.modelVisionFromRow({ model_id: "m", capabilities_json: '["text","vision"]' }) === true,
);

(async () => {
  // ── 3. 新建会话只走 session/create ─────────────────────────────────────
  calls.length = 0;
  await plugin.handleAction(
    "start-conversation",
    { input: [{ type: "text", text: "new", text_elements: [] }], model: "77625 free/x-deepseek-v4.1-flash", effort: "high" },
    0,
  );
  const create = calls.find((c) => c.operation === "session/create");
  const firstPrompt = calls.find((c) => c.operation === "agent/prompt");
  check(
    "session/create 带 providerId + modelId + thinkingLevel",
    create && create.args[0].providerId === "P1" && create.args[0].modelId === "x-deepseek-v4.1-flash" && create.args[0].thinkingLevel === "high",
    JSON.stringify(create && create.args),
  );
  check("session/create 不再发 providerName", create && create.args[0].providerName === undefined, JSON.stringify(create && create.args));
  check(
    "agent/prompt 不带任何模型字段",
    firstPrompt &&
      firstPrompt.args[0].providerId === undefined &&
      firstPrompt.args[0].modelId === undefined &&
      firstPrompt.args[0].providerName === undefined &&
      firstPrompt.args[0].thinkingLevel === undefined,
    JSON.stringify(firstPrompt && firstPrompt.args),
  );

  // ── 4. 换模型：confirm:true 契约成立 ───────────────────────────────────
  calls.length = 0;
  refuseConfigure = null;
  await plugin.handleAction(
    "thread-follower-start-turn",
    {
      conversationId: "sess-healthy",
      turnStart: { request: { threadId: "sess-healthy", input: [{ type: "text", text: "hi" }], model: "U2/deepseek-v4.1-flash", effort: "high" } },
    },
    2,
  );
  const configure = calls.filter((c) => c.operation === "session/configure");
  check("换模型走 session/configure", configure.length === 1, JSON.stringify(opsOf()));
  check(
    "session/configure 以 [id, config] 调用且用 id",
    configure[0] &&
      configure[0].args.length === 2 &&
      configure[0].args[0] === "sess-healthy" &&
      configure[0].args[1].providerId === "P2" &&
      configure[0].args[1].modelId === "deepseek-v4.1-flash" &&
      configure[0].args[1].mode === "agent" &&
      configure[0].args[1].thinkingLevel === "high",
    JSON.stringify(configure[0] && configure[0].args),
  );
  check("dangerous 操作带 confirm:true（宿主契约）", configure[0] && configure[0].confirm === true, JSON.stringify(configure[0]));

  // ── 5. 同一模型不重复 configure ────────────────────────────────────────
  calls.length = 0;
  await plugin.handleAction(
    "thread-follower-start-turn",
    {
      conversationId: "sess-healthy",
      turnStart: { request: { threadId: "sess-healthy", input: [{ type: "text", text: "again" }], model: "U2/deepseek-v4.1-flash" } },
    },
    2,
  );
  check("同一模型不重复 configure（不重复弹确认框）", calls.every((c) => c.operation !== "session/configure"), JSON.stringify(opsOf()));

  // ── 5b. 桥刚重载、内存无快照：数据库已同模型时不能弹确认框 ─────────────
  calls.length = 0;
  await plugin.handleAction(
    "thread-follower-start-turn",
    {
      conversationId: "sess-same",
      turnStart: { request: { threadId: "sess-same", input: [{ type: "text", text: "first after reload" }], model: "77625 free/x-deepseek-v4.1-flash" } },
    },
    2,
  );
  check(
    "内存无快照时按数据库判断，同模型不弹确认框",
    calls.every((c) => c.operation !== "session/configure"),
    JSON.stringify(opsOf()),
  );
  check("这一轮仍然正常发送", Boolean(calls.find((c) => c.operation === "agent/prompt")), JSON.stringify(opsOf()));

  // ── 6. 解析不出的模型不阻断、也不写坏会话 ─────────────────────────────
  calls.length = 0;
  let threw = null;
  try {
    await plugin.handleAction(
      "thread-follower-start-turn",
      {
        conversationId: "sess-healthy",
        turnStart: { request: { threadId: "sess-healthy", input: [{ type: "text", text: "ok" }], model: "ghost/not-real" } },
      },
      2,
    );
  } catch (error) {
    threw = error.message;
  }
  check("解析不出的模型不阻断这一轮", threw === null, String(threw));
  check("解析不出的模型不触发 configure", calls.every((c) => c.operation !== "session/configure"), JSON.stringify(opsOf()));

  // ── 7. 级联事故本体：configure 被拒 → 必须中止，绝不 prompt ────────────
  calls.length = 0;
  refuseConfigure = "confirm=true is required for session/configure";
  let refused = null;
  try {
    await plugin.handleAction(
      "thread-follower-start-turn",
      {
        conversationId: "sess-healthy",
        turnStart: { request: { threadId: "sess-healthy", input: [{ type: "text", text: "after-image" }], model: "77625 free/x-deepseek-v4.1-flash" } },
      },
      2,
    );
  } catch (error) {
    refused = error.message;
  }
  check("configure 被拒时本轮抛错（不再假装发送成功）", Boolean(refused), String(refused));
  check(
    "configure 被拒后绝不调用 agent/prompt（级联污染被切断）",
    calls.every((c) => c.operation !== "agent/prompt"),
    JSON.stringify(opsOf()),
  );
  check("错误里点名模型切换未确认", /未.*确认|confirm/i.test(String(refused)), String(refused));
  refuseConfigure = null;

  // ── 8. 会话本身已坏：发送前自动修复到可用模型 ──────────────────────────
  calls.length = 0;
  await plugin.handleAction(
    "thread-follower-start-turn",
    {
      conversationId: "sess-broken",
      turnStart: { request: { threadId: "sess-broken", input: [{ type: "text", text: "plain after image" }] } },
    },
    2,
  );
  const repair = calls.filter((c) => c.operation === "session/configure");
  const repairPrompt = calls.find((c) => c.operation === "agent/prompt");
  check("坏会话在发送前被修复（configure 一次）", repair.length === 1, JSON.stringify(opsOf()));
  check(
    "修复目标落在启用供应商的可用模型上",
    repair[0] && plugin.modelPairUsable({ providerId: repair[0].args[1].providerId, modelId: repair[0].args[1].modelId }),
    JSON.stringify(repair[0] && repair[0].args),
  );
  check("修复后普通消息仍可发送", Boolean(repairPrompt), JSON.stringify(opsOf()));
  check("修复也遵守 confirm:true", repair[0] && repair[0].confirm === true);

  // ── 9. 找不到任何可用模型 → 明确拒绝，不发 prompt ──────────────────────
  const noModelDb = new DatabaseSync(dbPath);
  noModelDb.exec("UPDATE providers SET enabled = 0");
  noModelDb.close();
  calls.length = 0;
  let noModelError = null;
  try {
    await plugin.handleAction(
      "thread-follower-start-turn",
      {
        conversationId: "sess-broken",
        turnStart: { request: { threadId: "sess-broken", input: [{ type: "text", text: "no model" }] } },
      },
      2,
    );
  } catch (error) {
    noModelError = error.message;
  }
  check("无可用模型时明确报错", /没有可用模型|不可用/.test(String(noModelError)), String(noModelError));
  check("无可用模型时绝不 prompt", calls.every((c) => c.operation !== "agent/prompt"), JSON.stringify(opsOf()));

  fs.rmSync(outDir, { recursive: true, force: true });
  console.log(`\n${fails.length} failure(s)`);
  process.exit(fails.length ? 1 : 0);
})();
