#!/usr/bin/env node
/**
 * 2.4.0 search contract check — REAL server.js, synthetic Codex home.
 *
 * 判据来源：NB agent 2026-11-20 23:56 的接口规格
 *   GET /api/search?q=&limit=
 *   -> { ok, query, took, results: [{ kind: "thread"|"message", threadId, title,
 *        project, field: "title"|"project"|"content", snippet, at }] }
 *   - 中文子串匹配（不分词、不拼音），ASCII 大小写不敏感
 *   - LIKE 参数化（% _ ' 不当通配、不当注入）
 *   - query 长度上限；<300ms（2000 会话量级）
 *   - 标题/项目命中优先，内容命中其次
 *   - /api/threads 契约不动
 *
 * 为什么是黑盒：和 check-queue-api.mjs 一样起真 server.js，只换 --codex-home。
 * 不读真实数据、不碰 Codex Desktop；2000 条会话是现场生成的（内容可控，
 * 所以"搜得到"和"不该搜到"都能断言，不是只看 200）。
 *
 *   node tools/qa/check-search-api.mjs
 *   node tools/qa/check-search-api.mjs --sessions 2000 --json tmp/search-api.json
 *   node tools/qa/check-search-api.mjs --keep          # 保留临时 home 便于复盘
 *
 * 退出码 1 = 有判据失败。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const argOf = (name, fallback = "") => {
  const key = String(name).startsWith("--") ? String(name) : `--${name}`;
  const index = argv.indexOf(key);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : fallback;
};
const hasFlag = (name) => argv.includes(`--${name}`);
const JSON_OUT = argOf("json", "");
const KEEP = hasFlag("keep");
const SESSIONS = Math.max(200, Number(argOf("sessions", "2000")) || 2000);
const TOKEN = "qa-search-api-token";
const PROJECT_NAME = "深空计划";
const FILLER_PROJECT = "基线项目";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
function check(id, pass, detail = "") {
  results.push({ id, pass: Boolean(pass), detail });
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${id}${detail ? ` — ${detail}` : ""}`);
}
function note(text) {
  console.log(`  [INFO] ${text}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * 夹具：每个会话一条 rollout（session_meta + 一个完整 turn）。
 * 关键词只出现在点名的那几条里，填充会话一律不含关键词——
 * 这样"不该命中的没命中"也是判据。
 */
const FIXTURES = {
  title: {
    id: "11111111-1111-4111-8111-111111111111",
    title: "深空调试记录",
    project: PROJECT_NAME,
    cwd: "C:\\qa\\projects\\deepspace\\title",
    messages: [
      ["user", "帮我把这轮的记录整理一下。"],
      ["assistant", "已经整理成三条，见下。"]
    ]
  },
  projectOnly: {
    id: "22222222-2222-4222-8222-222222222222",
    title: "周报模板",
    project: PROJECT_NAME,
    cwd: "C:\\qa\\projects\\deepspace\\weekly",
    messages: [
      ["user", "周报模板改一下。"],
      ["assistant", "模板已按上周结构更新。"]
    ]
  },
  content: {
    id: "33333333-3333-4333-8333-333333333333",
    title: "无关标题",
    project: FILLER_PROJECT,
    cwd: "C:\\qa\\projects\\filler\\content",
    messages: [
      ["user", "看一下这段记录。"],
      ["assistant", "记录里写着：深空站在凌晨部署了新的中继，延迟降了一半。"]
    ]
  },
  multi: {
    id: "44444444-4444-4444-8444-444444444444",
    title: "深空值班表",
    project: FILLER_PROJECT,
    cwd: "C:\\qa\\projects\\filler\\multi",
    messages: [
      ["user", "值班表发我。"],
      ["assistant", "值班表已发；深空这周的夜班是周三。"]
    ]
  },
  caseOnly: {
    id: "55555555-5555-4555-8555-555555555555",
    title: "Release Notes 2026",
    project: FILLER_PROJECT,
    cwd: "C:\\qa\\projects\\filler\\case",
    messages: [
      ["user", "构建状态怎么样？"],
      ["assistant", "def build is green, no regressions."]
    ]
  },
  likeOnly: {
    id: "66666666-6666-4666-8666-666666666666",
    title: "覆盖率与命名",
    project: FILLER_PROJECT,
    cwd: "C:\\qa\\projects\\filler\\like",
    messages: [
      ["user", "覆盖率多少？"],
      ["assistant", "覆盖率 100% 通过；命名 a_b 已统一；it's fine；十六进制 1000 不算。"]
    ]
  }
};

function rolloutLines(thread, atMs) {
  const at = (offset) => new Date(atMs + offset).toISOString();
  const lines = [
    { timestamp: at(0), type: "session_meta", payload: { id: thread.id, cwd: thread.cwd } },
    { timestamp: at(10), type: "event_msg", payload: { type: "task_started", turn_id: `${thread.id}-t1`, started_at: Math.floor((atMs + 10) / 1000) } }
  ];
  thread.messages.forEach(([role, text], index) => {
    lines.push({
      timestamp: at(20 + index * 10),
      type: "event_msg",
      payload: { type: role === "user" ? "user_message" : "agent_message", message: text }
    });
  });
  lines.push({
    timestamp: at(1000),
    type: "event_msg",
    payload: { type: "task_complete", turn_id: `${thread.id}-t1`, completed_at: Math.floor((atMs + 1000) / 1000), duration_ms: 990 }
  });
  return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
}

async function seedHome(home) {
  const sessions = path.join(home, "sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const nowMs = Date.now();
  const rows = [];
  let seq = 0;
  const write = (thread, atMs) => {
    // 文件名必须带 UUID：server.js 靠 sessionIdFromRolloutName 从文件名反解会话 id，
    // 只按 sqlite 的 rollout_path 走，/api/threads/:id/messages 会 404。
    seq += 1;
    const date = new Date(atMs);
    const day = path.join(sessions, String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0"));
    fs.mkdirSync(day, { recursive: true });
    const stamp = `${date.toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
    const file = path.join(day, `rollout-${stamp}-${String(seq).padStart(4, "0")}-${thread.id}.jsonl`);
    fs.writeFileSync(file, rolloutLines(thread, atMs), "utf8");
    rows.push({ id: thread.id, title: thread.title, rollout: path.relative(home, file), at: atMs, cwd: thread.cwd });
  };

  for (const fixture of Object.values(FIXTURES)) write(fixture, nowMs - 60_000);
  // 填充会话：内容里没有任何测试关键词。
  for (let index = 0; index < SESSIONS; index += 1) {
    const n = String(index).padStart(4, "0");
    write({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      title: `基线会话 ${n}`,
      cwd: `C:\\qa\\projects\\filler\\base-${Math.floor(index / 100)}`,
      messages: [
        ["user", `普通问题 ${n}：这个模块怎么组织？`],
        ["assistant", `普通回答 ${n}：按职责拆开，接口写在文件顶部。`]
      ]
    }, nowMs - 120_000 - index * 1000);
  }

  // 表结构对着 server.js 的 thread 列表 SELECT 写：少一列就是 500，
  // 而 500 会被误读成"搜索坏了"。空表也要在，LEFT JOIN 才不会炸。
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(home, "state_5.sqlite"));
  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY, title TEXT, rollout_path TEXT, archived INTEGER DEFAULT 0,
      created_at_ms INTEGER, updated_at_ms INTEGER, updated_at INTEGER,
      preview TEXT, cwd TEXT, model TEXT, source TEXT, thread_source TEXT, agent_path TEXT,
      is_pinned INTEGER DEFAULT 0, thread_section_id TEXT, section_position INTEGER, project_id TEXT
    );
    CREATE TABLE thread_sections (id TEXT PRIMARY KEY, name TEXT, appearance TEXT);
    CREATE TABLE thread_spawn_edges (child_thread_id TEXT, parent_thread_id TEXT);
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, position INTEGER);
    CREATE TABLE project_roots (project_id TEXT, path TEXT, position INTEGER);
    CREATE TABLE thread_goals (thread_id TEXT, objective TEXT, status TEXT, created_at_ms INTEGER, updated_at_ms INTEGER);
  `);
  db.prepare("INSERT INTO projects (id, name, position) VALUES (?, ?, ?)").run("qa-project-deep", PROJECT_NAME, 1);
  db.prepare("INSERT INTO projects (id, name, position) VALUES (?, ?, ?)").run("qa-project-filler", FILLER_PROJECT, 2);
  db.prepare("INSERT INTO project_roots (project_id, path, position) VALUES (?, ?, 1)").run("qa-project-deep", "C:\\qa\\projects\\deepspace");
  db.prepare("INSERT INTO project_roots (project_id, path, position) VALUES (?, ?, 1)").run("qa-project-filler", "C:\\qa\\projects\\filler");
  const insert = db.prepare(`
    INSERT INTO threads (id, title, rollout_path, archived, created_at_ms, updated_at_ms, updated_at, cwd, model, project_id)
    VALUES (?, ?, ?, 0, ?, ?, ?, ?, 'qa-model', ?)
  `);
  const projectOf = (row) => {
    const fixture = Object.values(FIXTURES).find((item) => item.id === row.id);
    return fixture ? (fixture.project === PROJECT_NAME ? "qa-project-deep" : "qa-project-filler") : "qa-project-filler";
  };
  db.exec("BEGIN");
  for (const row of rows) {
    insert.run(row.id, row.title, row.rollout, row.at, row.at, Math.floor(row.at / 1000), row.cwd, projectOf(row));
  }
  db.exec("COMMIT");
  db.close();
  return rows.length;
}

let server = null;
let baseUrl = "";

async function startServer(home, logDir) {
  const port = await freePort();
  const child = spawn(process.execPath, [
    "server.js",
    "--host", "127.0.0.1",
    "--port", String(port),
    "--token", TOKEN,
    "--codex-home", home,
    "--active-turn-stale-minutes", "600"
  ], {
    cwd: REPO,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, LOCALAPPDATA: path.join(logDir, "localappdata"), TURNLOOM_LOG_DIR: logDir }
  });
  let log = "";
  child.stdout.on("data", (chunk) => { log += chunk.toString(); });
  child.stderr.on("data", (chunk) => { log += chunk.toString(); });
  baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { headers: { "x-access-token": TOKEN } });
      if (response.status === 200) { server = { child, log: () => log }; return; }
    } catch { /* not listening yet */ }
    await sleep(150);
  }
  child.kill();
  throw new Error(`server did not become ready\n--- server log ---\n${log}`);
}

async function stopServer() {
  if (!server) return;
  const { child } = server;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
  server = null;
}

async function api(pathname, { timeoutMs = 30_000 } = {}) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: { "x-access-token": TOKEN },
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  const ms = performance.now() - started;
  let data = {};
  try { data = JSON.parse(text || "{}"); } catch { data = { raw: text.slice(0, 400) }; }
  return { status: response.status, data, ms };
}

const search = (query, limit) => {
  const params = new URLSearchParams({ q: query });
  if (limit !== undefined) params.set("limit", String(limit));
  return api(`/api/search?${params.toString()}`);
};

/** 结果里某条命中的 field 判定允许写错，但必须能在结果里找到对应 threadId。 */
const rowsOf = (response) => (Array.isArray(response.data?.results) ? response.data.results : []);
const hitIds = (response) => new Set(rowsOf(response).map((row) => String(row.threadId || "")));
function fieldsById(response, id) {
  return rowsOf(response).filter((row) => String(row.threadId) === id).map((row) => row.field);
}

function shapeProblems(response) {
  const problems = [];
  const body = response.data || {};
  if (body.ok !== true) problems.push(`ok=${JSON.stringify(body.ok)}`);
  if (typeof body.query !== "string") problems.push(`query=${typeof body.query}`);
  if (typeof body.took !== "number") problems.push(`took=${typeof body.took}`);
  if (!Array.isArray(body.results)) problems.push(`results=${typeof body.results}`);
  for (const row of rowsOf(response)) {
    const where = row?.threadId || "?";
    if (row?.kind !== "thread" && row?.kind !== "message") problems.push(`${where}:kind=${row?.kind}`);
    if (!["title", "project", "content"].includes(row?.field)) problems.push(`${where}:field=${row?.field}`);
    if (typeof row?.threadId !== "string" || !row.threadId) problems.push(`${where}:threadId`);
    if (typeof row?.title !== "string") problems.push(`${where}:title=${typeof row?.title}`);
    if (typeof row?.project !== "string") problems.push(`${where}:project=${typeof row?.project}`);
    if (typeof row?.snippet !== "string") problems.push(`${where}:snippet=${typeof row?.snippet}`);
    const at = row?.at;
    if (!(typeof at === "number" && Number.isFinite(at)) && !(typeof at === "string" && Number.isFinite(Date.parse(at)))) {
      problems.push(`${where}:at=${JSON.stringify(at)}`);
    }
    if (typeof row?.snippet === "string" && row.snippet.length > 400) problems.push(`${where}:snippet-too-long=${row.snippet.length}`);
  }
  return problems;
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-search-api-"));
  const home = path.join(root, "home");
  const logDir = path.join(root, "logs");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  const seeded = await seedHome(home);
  note(`synthetic home: ${home} · ${seeded} threads`);

  try {
    await startServer(home, logDir);

    // 0. 夹具自证：服务端必须真的看见这 2006 条会话、项目名和正文。
    //    这一步红了就停下——否则搜不到东西会被误判成产品缺陷。
    const fixtureThreads = await api("/api/threads?limit=500");
    const fixtureRow = (fixtureThreads.data.threads || []).find((row) => row.id === FIXTURES.title.id);
    const fixtureTotal = Number(fixtureThreads.data.total) || 0;
    const fixtureProject = String(fixtureRow?.project?.name || "");
    const fixtureMessages = await api(`/api/threads/${encodeURIComponent(FIXTURES.content.id)}/messages?limit=10`);
    const fixtureText = JSON.stringify(fixtureMessages.data).includes("深空站");
    check("fixture.home", fixtureThreads.status === 200 && fixtureTotal >= Math.min(seeded, 500) && fixtureProject === PROJECT_NAME,
      `total=${fixtureTotal}/${seeded} project=${JSON.stringify(fixtureProject)}`);
    check("fixture.messages", fixtureMessages.status === 200 && fixtureText, `HTTP ${fixtureMessages.status} text=${fixtureText}`);
    if (fixtureTotal < Math.min(seeded, 500) || !fixtureProject || !fixtureText) {
      note("夹具没被服务端完整读入，搜索判据无从谈起；先修夹具或确认 --codex-home 语义。");
      throw new Error("fixture rejected by server");
    }

    // 1. 路由存在
    let response = await search("深空");
    check("route.status", response.status === 200, `HTTP ${response.status} ${JSON.stringify(response.data).slice(0, 160)}`);
    if (response.status !== 200) {
      note("接口还没落地/没走通：后续判据全部按失败计，这就是已知失败样本。");
      for (const id of ["shape", "zh.title", "zh.project", "zh.content", "zh.order", "ascii.case", "like.percent", "like.underscore", "like.quote", "injection", "cap.query", "limit.small", "limit.large", "timing.warm", "threads.contract", "empty.query", "unicode"]) {
        check(id, false, "route missing");
      }
      return;
    }

    // 2. 形状
    const problems = shapeProblems(response);
    check("shape", problems.length === 0, problems.slice(0, 6).join("; "));

    // 3. 中文子串：三条点名会话各自命中，且 field 正确
    const ids = hitIds(response);
    check("zh.title", fieldsById(response, FIXTURES.title.id).includes("title"), `fields=${JSON.stringify(fieldsById(response, FIXTURES.title.id))}`);
    check("zh.project", fieldsById(response, FIXTURES.projectOnly.id).includes("project"), `fields=${JSON.stringify(fieldsById(response, FIXTURES.projectOnly.id))}`);
    check("zh.content", fieldsById(response, FIXTURES.content.id).includes("content"), `fields=${JSON.stringify(fieldsById(response, FIXTURES.content.id))}`);
    // 多字段的那条：标题命中必须排在正文命中之前
    const multiFields = fieldsById(response, FIXTURES.multi.id);
    check("zh.order", multiFields.includes("title") && (!multiFields.includes("content") || multiFields.indexOf("title") < multiFields.indexOf("content")), `fields=${JSON.stringify(multiFields)}`);

    // 4. 全局顺序：标题/项目命中都在内容命中之前
    const rows = rowsOf(response);
    const firstContent = rows.findIndex((row) => row.field === "content");
    const lastOther = rows.map((row) => row.field !== "content").lastIndexOf(true);
    check("zh.global-order", firstContent === -1 || lastOther < firstContent, `firstContent=${firstContent} lastOther=${lastOther}`);

    // 5. ASCII 大小写不敏感（两个方向都查）
    const upper = await search("DEF");
    const lower = await search("def");
    check("ascii.case", hitIds(upper).has(FIXTURES.caseOnly.id) && hitIds(lower).has(FIXTURES.caseOnly.id),
      `DEF=${upper.status}/${rowsOf(upper).length} def=${lower.status}/${rowsOf(lower).length}`);
    const titleCase = await search("release");
    check("ascii.case.title", hitIds(titleCase).has(FIXTURES.caseOnly.id), `release=${titleCase.status}/${rowsOf(titleCase).length}`);

    // 6. LIKE 元字符按字面量处理
    const percent = await search("100%");
    check("like.percent", hitIds(percent).has(FIXTURES.likeOnly.id) && rowsOf(percent).length < 10, `hits=${rowsOf(percent).length} ids=${[...hitIds(percent)].slice(0, 5)}`);
    const noWildcard = await search("100X");
    check("like.percent.literal", noWildcard.status === 200 && rowsOf(noWildcard).length === 0, `hits=${rowsOf(noWildcard).length}`);
    const underscore = await search("a_b");
    check("like.underscore", hitIds(underscore).has(FIXTURES.likeOnly.id), `hits=${rowsOf(underscore).length}`);
    const underscoreLiteral = await search("axb");
    check("like.underscore.literal", underscoreLiteral.status === 200 && rowsOf(underscoreLiteral).length === 0, `hits=${rowsOf(underscoreLiteral).length}`);
    const quote = await search("it's");
    check("like.quote", hitIds(quote).has(FIXTURES.likeOnly.id), `hits=${rowsOf(quote).length}`);

    // 7. 注入：不 500、不全量、库没坏
    const injection = await search("%' OR 1=1 --");
    check("injection", injection.status === 200 && rowsOf(injection).length === 0, `HTTP ${injection.status} hits=${rowsOf(injection).length}`);
    const drop = await search("'; DROP TABLE threads; --");
    const afterDrop = await api("/api/threads?limit=5");
    check("injection.table", drop.status === 200 && afterDrop.status === 200 && Array.isArray(afterDrop.data.threads) && afterDrop.data.threads.length === 5,
      `drop=${drop.status} threads=${afterDrop.status}/${(afterDrop.data.threads || []).length}`);

    // 8. query 长度上限：不许 500
    const longQuery = "深".repeat(4000);
    const capped = await search(longQuery);
    const cappedOk = capped.status === 200 || (capped.status >= 400 && capped.status < 500);
    check("cap.query", cappedOk, `HTTP ${capped.status} echo=${String(capped.data?.query || "").length}`);
    if (capped.status === 200) note(`query 被截到 ${String(capped.data.query || "").length} 字符`);

    // 9. limit 上限与边界值
    const small = await search("基线", 5);
    check("limit.small", small.status === 200 && rowsOf(small).length <= 5, `HTTP ${small.status} hits=${rowsOf(small).length}`);
    const large = await search("基线", 9999);
    check("limit.large", large.status === 200 && rowsOf(large).length <= seeded, `HTTP ${large.status} hits=${rowsOf(large).length}`);
    const zero = await search("基线", 0);
    check("limit.zero", zero.status !== 500, `HTTP ${zero.status} hits=${rowsOf(zero).length}`);

    // 10. 空 / 纯 emoji：不许 500，不许把全部会话倒出来
    const empty = await search("");
    check("empty.query", empty.status !== 500 && (empty.status !== 200 || rowsOf(empty).length === 0), `HTTP ${empty.status} hits=${rowsOf(empty).length}`);
    const emoji = await search("😀😀");
    check("unicode", emoji.status === 200 && rowsOf(emoji).length === 0, `HTTP ${emoji.status} hits=${rowsOf(emoji).length}`);

    // 11. 性能：暖态 5 次中位数 < 300ms（2000 会话）
    await search("深空");
    const timings = [];
    for (let index = 0; index < 5; index += 1) {
      const run = await search(index % 2 ? "深空" : "基线");
      timings.push(run.ms);
      await sleep(30);
    }
    timings.sort((a, b) => a - b);
    const warmMedian = timings[Math.floor(timings.length / 2)];
    note(`cold=${response.ms.toFixed(0)}ms warm=${timings.map((value) => value.toFixed(0)).join("/")}ms`);
    check("timing.warm", warmMedian < 300, `median=${warmMedian.toFixed(0)}ms (${seeded} threads)`);

    // 12. /api/threads 契约不动
    const threads = await api("/api/threads?limit=5");
    const threadRow = (threads.data.threads || [])[0] || {};
    check("threads.contract",
      threads.status === 200 &&
      Array.isArray(threads.data.threads) &&
      typeof threads.data.total === "number" &&
      "nextCursor" in threads.data &&
      typeof threadRow.id === "string" &&
      typeof threadRow.title === "string" &&
      typeof threadRow.status?.state === "string" &&
      typeof threadRow.status?.thinking === "boolean" &&
      "project" in threadRow,
      `HTTP ${threads.status} total=${threads.data.total} keys=${Object.keys(threadRow).slice(0, 12).join(",")}`);

    // 13. 结果里的 threadId 必须真实存在
    const all = await search("深空", 200);
    const known = new Set((threads.data.threads || []).map((row) => row.id));
    const sample = rowsOf(all).slice(0, 20).map((row) => row.threadId);
    const unknown = sample.filter((id) => !known.has(id));
    check("threadId.valid", unknown.length === 0, `${unknown.length} unknown of ${sample.length} sampled (线程页只取了 5 条，样本允许未覆盖)`);

    // 14. 正文命中要带得出片段（不是空串）
    const contentRow = rowsOf(response).find((row) => row.threadId === FIXTURES.content.id && row.field === "content");
    check("snippet.content", Boolean(contentRow) && contentRow.snippet.includes("深空"), `snippet=${JSON.stringify(contentRow?.snippet || "").slice(0, 120)}`);
  } finally {
    await stopServer();
    if (KEEP) note(`kept: ${root}`);
    else fs.rmSync(root, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    const failed = results.filter((row) => !row.pass);
    console.log(`\n${results.length - failed.length} PASS / ${failed.length} FAIL`);
    if (JSON_OUT) {
      fs.mkdirSync(path.dirname(path.resolve(REPO, JSON_OUT)), { recursive: true });
      fs.writeFileSync(path.resolve(REPO, JSON_OUT), JSON.stringify({ sessions: SESSIONS, at: new Date().toISOString(), results }, null, 2));
      console.log(`report: ${JSON_OUT}`);
    }
    process.exit(failed.length ? 1 : 0);
  })
  .catch((error) => {
    console.error(error?.stack || error);
    process.exit(1);
  });
