#!/usr/bin/env node
/**
 * 2.4.0 `/api/threads` 的 `active` 契约——真 server.js × 合成 Codex home。
 *
 * 契约（NB agent 00:03 定，Atlas 00:08 定 A 口径）：
 *   active: {
 *     running: [{ id, title, project, startedAtMs, updatedAtMs }],   // thinking && !interactionRequired
 *     waiting: [{ id, title, project, reason }],                     // interactionRequired
 *     truncated: boolean
 *   }
 *   status.state: waiting > running > ended（interactionRequired 必须是 "waiting"）
 *   running 与 waiting 不相交，两数相加 = 活会话数；分页不参与计数。
 *
 * 夹具见 truth-home.mjs：3 运行中 + 2 等授权在第 1 页，另有一条运行中排在第 61 位。
 * 只过滤"已加载页"的实现会数出 3+2（少一条）；把 waiting 算进 running 的实现会数出 5+2（重数一条）。
 *
 *   node tools/qa/check-active-api.mjs [--json tmp/active-api.json] [--keep]
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  seedTruthHome, closeTurnWithoutApproval, PAGE2_RUN_ID, PAGE_SIZE, PROJECT_NAME, RUN_IDS, WAIT_IDS
} from "./truth-home.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const argOf = (name, fallback = "") => {
  const key = `--${name}`;
  const index = argv.indexOf(key);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : fallback;
};
const JSON_OUT = argOf("json", "");
const KEEP = argv.includes("--keep");
const TOKEN = "qa-active-api-token";
const ALL_ACTIVE = [...RUN_IDS, ...WAIT_IDS];
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

let baseUrl = "";
let server = null;

async function startServer(home, logDir) {
  const port = await freePort();
  const child = spawn(process.execPath, [
    "server.js", "--host", "127.0.0.1", "--port", String(port), "--token", TOKEN,
    "--codex-home", home, "--active-turn-stale-minutes", "600"
  ], {
    cwd: REPO, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
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
    } catch { /* not listening */ }
    await sleep(150);
  }
  child.kill();
  throw new Error(`server did not become ready\n${log}`);
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

async function get(pathname, headers = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: { "x-access-token": TOKEN, ...headers },
    signal: AbortSignal.timeout(60_000)
  });
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text || "{}"); } catch { data = { raw: text.slice(0, 300) }; }
  return { status: response.status, data, text, etag: response.headers.get("etag") || "" };
}

const idsOf = (rows) => (Array.isArray(rows) ? rows.map((row) => String(row?.id || "")) : []);
const rowProblems = (rows, kind) => {
  const problems = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (typeof row?.id !== "string" || !row.id) problems.push(`${kind}:id`);
    if (typeof row?.title !== "string") problems.push(`${kind}:title=${typeof row?.title}`);
    if (typeof row?.project !== "string") problems.push(`${kind}:project=${typeof row?.project}`);
    if (kind === "running" && !(Number(row?.startedAtMs) > 0)) problems.push(`running:startedAtMs=${row?.startedAtMs}`);
    if (kind === "waiting" && !["interaction", "unknown"].includes(row?.reason)) problems.push(`waiting:reason=${row?.reason}`);
  }
  return problems;
};

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-active-api-"));
  const home = path.join(root, "home");
  const logDir = path.join(root, "logs");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  const seeded = await seedTruthHome(home);
  note(`synthetic home: ${home} · ${seeded.total} threads (page size ${PAGE_SIZE})`);

  try {
    await startServer(home, logDir);

    // 0. 夹具自证（不依赖 active）：第 1 页能看到 5 条活会话；第 2 页那条不在第 1 页，
    //    但它的详情接口自己说 thinking=true —— 这就是"真相在库里、列表看不见"的证据。
    let response = await get("/api/threads?limit=60");
    const body = response.data || {};
    const pageIdsBefore = idsOf(body.threads);
    const pageThinkingBefore = (body.threads || []).filter((row) => row?.status?.thinking).map((row) => row.id);
    const page2Detail = await get(`/api/threads/${encodeURIComponent(PAGE2_RUN_ID)}/messages?limit=5`);
    const page2Thinking = page2Detail.data?.status?.thinking === true;
    check("fixture.page1", response.status === 200 && pageIdsBefore.length === PAGE_SIZE
      && ALL_ACTIVE.every((id) => pageThinkingBefore.includes(id))
      && !pageIdsBefore.includes(PAGE2_RUN_ID),
      `page1=${pageIdsBefore.length} thinking=${pageThinkingBefore.length} page2InPage1=${pageIdsBefore.includes(PAGE2_RUN_ID)}`);
    check("fixture.page2.running", page2Thinking, `detail thinking=${JSON.stringify(page2Detail.data?.status)}`);
    if (!(pageIdsBefore.length === PAGE_SIZE && page2Thinking)) {
      note("夹具没造出预期的分页/运行状态，后面的 active 判据没有意义，先修夹具。");
      throw new Error("fixture not in expected shape");
    }

    // 1. `active` 存在且形状对
    const active = body.active;
    const shapeOk = response.status === 200
      && active && typeof active === "object"
      && Array.isArray(active.running) && Array.isArray(active.waiting)
      && typeof active.truncated === "boolean";
    check("active.shape", shapeOk, `HTTP ${response.status} active=${JSON.stringify(active)?.slice(0, 200)}`);
    if (!shapeOk) {
      note("`active` 还没落地：后续按失败计（这就是已知失败样本）。");
      for (const id of [
        "active.running.ids", "active.waiting.ids", "active.rows", "active.paging",
        "active.paging.negative", "active.disjoint", "active.sum", "state.waiting",
        "state.page1.thinking", "etag", "etag.invalidate"
      ]) check(id, false, "active missing");
      return;
    }

    // 2. 集合：3 运行中 + 1 第 2 页运行中
    const runningIds = idsOf(active.running);
    const waitingIds = idsOf(active.waiting);
    check("active.running.ids", RUN_IDS.every((id) => runningIds.includes(id)) && runningIds.includes(PAGE2_RUN_ID),
      `running=${runningIds.length} expected ⊇ ${[...RUN_IDS, PAGE2_RUN_ID].length}`);
    check("active.waiting.ids", WAIT_IDS.every((id) => waitingIds.includes(id)) && waitingIds.length === WAIT_IDS.length,
      `waiting=${JSON.stringify(waitingIds)}`);
    check("active.rows", rowProblems(active.running, "running").length === 0 && rowProblems(active.waiting, "waiting").length === 0,
      [...rowProblems(active.running, "running"), ...rowProblems(active.waiting, "waiting")].slice(0, 6).join("; "));

    // 3. 分页不再是真相：第 1 页里没有那条，active 里必须有
    const pageIds = idsOf(body.threads);
    check("active.paging", pageIds.length === PAGE_SIZE && !pageIds.includes(PAGE2_RUN_ID) && runningIds.includes(PAGE2_RUN_ID),
      `page1=${pageIds.length} page1Has=${pageIds.includes(PAGE2_RUN_ID)} activeHas=${runningIds.includes(PAGE2_RUN_ID)}`);
    const pageThinking = (body.threads || []).filter((row) => row?.status?.thinking).map((row) => row.id);
    check("state.page1.thinking", ALL_ACTIVE.every((id) => pageThinking.includes(id)),
      `page1 thinking=${pageThinking.length} expected 5`);

    // 4. 不相交且相加 = 活会话数（A 口径）
    const disjoint = runningIds.every((id) => !waitingIds.includes(id));
    check("active.disjoint", disjoint, `overlap=${runningIds.filter((id) => waitingIds.includes(id)).length}`);
    const union = new Set([...runningIds, ...waitingIds]);
    const missing = ALL_ACTIVE.filter((id) => !union.has(id));
    check("active.sum", disjoint && runningIds.length === RUN_IDS.length + 1 && waitingIds.length === WAIT_IDS.length && missing.length === 0,
      `running=${runningIds.length} waiting=${waitingIds.length} sum=${runningIds.length + waitingIds.length} missing=${JSON.stringify(missing)}`);

    // 5. status.state 三态：等授权必须是 waiting（今天永远拿不到）
    const waitRows = (body.threads || []).filter((row) => WAIT_IDS.includes(row.id));
    const waitStates = waitRows.map((row) => `${row.id.slice(0, 8)}:${row.status?.state}/thinking=${row.status?.thinking}/interaction=${row.status?.interactionRequired}`);
    check("state.waiting", waitRows.length === WAIT_IDS.length && waitRows.every((row) => row.status?.state === "waiting" && row.status?.interactionRequired === true),
      waitStates.join(", "));

    // 6. ETag 是缓存一致性的载体：body 变了就必须换
    const etag = response.etag;
    const repeat = await get("/api/threads?limit=60", { "if-none-match": etag });
    check("etag", Boolean(etag) && repeat.status === 304, `etag=${etag ? "yes" : "no"} repeat=${repeat.status}`);
    closeTurnWithoutApproval(home, PAGE2_RUN_ID);
    await sleep(200);
    const after = await get("/api/threads?limit=60", { "if-none-match": etag });
    const afterRunning = idsOf(after.data?.active?.running);
    check("etag.invalidate", after.status === 200 && after.etag !== etag && !afterRunning.includes(PAGE2_RUN_ID),
      `after=${after.status} etagChanged=${after.etag !== etag} stillRunning=${afterRunning.includes(PAGE2_RUN_ID)}`);
    note(`project=${JSON.stringify(active.running.find((row) => row.id === RUN_IDS[0])?.project)} expected=${PROJECT_NAME}`);
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
      fs.writeFileSync(path.resolve(REPO, JSON_OUT), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
      console.log(`report: ${JSON_OUT}`);
    }
    process.exit(failed.length ? 1 : 0);
  })
  .catch((error) => {
    console.error(error?.stack || error);
    process.exit(1);
  });
