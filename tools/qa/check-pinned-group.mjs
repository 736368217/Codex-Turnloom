/**
 * 置顶组（`sessions.pinned`）的入口级回归：真 bundle、真 DOM、两种状态。
 *
 *   node tools/qa/check-pinned-group.mjs
 *
 * 判据不靠眼看：
 *   0 条 pinned → 页面上没有 [data-qa="pinned-group"]，也没有「置顶」两个字；
 *   N 条 pinned → 组在最上；每个 id 在整页只出现一次；「按项目」视图同样不重复。
 *
 * 数据由注入的桥自己回答（/api/threads），不依赖真电脑；pinned 数量由页面
 * URL 的 ?qa-pinned=N 决定，所以同一颗 bundle 能跑两种状态。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CDP } from "./cdp.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const APP = path.join(ROOT, "app");
const flag = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const CDP_PORT = Number(flag("cdp-port", "9333"));
const OUT = path.resolve(ROOT, flag("out", ".scratch/qa/pinned-group.png"));

const THREADS = [
  { id: "qa-pin-a", title: "发布前门禁（钉住）", pinned: true, status: { state: "running", thinking: true }, updatedAtMs: 1_700_000_000_000 },
  { id: "qa-pin-b", title: "缓存清理（钉住）", pinned: true, status: { state: "ended" }, updatedAtMs: 1_699_999_000_000 },
  { id: "qa-plain-a", title: "普通会话 A：项目里的长标题", project: { key: "project:alpha", name: "Alpha" }, status: { state: "ended" }, updatedAtMs: 1_699_900_000_000 },
  { id: "qa-plain-b", title: "普通会话 B：另一个项目", project: { key: "project:beta", name: "Beta" }, status: { state: "ended" }, updatedAtMs: 1_699_800_000_000 },
  { id: "qa-plain-c", title: "普通会话 C：未归类", status: { state: "ended" }, updatedAtMs: 1_699_700_000_000 },
];

const lines = [];
const log = (line) => { lines.push(line); console.log(line); };
let failures = 0;
const check = (ok, label, detail = "") => {
  log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` · ${detail}` : ""}`);
  if (!ok) failures += 1;
};

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const response = await fetch(url); if (response.ok) return; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`preview did not answer: ${url}`);
}

function bridgeSource(threads) {
  return `(() => {
  const store = new Map();
  const base = "http://127.0.0.1:8899";
  store.set("turnloom.machine.v2", JSON.stringify({
    machineId: "qa-pinned-machine", machineName: "QA 置顶宿主", serverUrl: base,
    machineToken: "qa-machine-token",
    harnesses: [{ id: "codex", name: "Codex Desktop", token: "qa-codex-token", kind: "codex", defaultHarness: true, online: true }],
    defaultHarnessId: "codex",
  }));
  const all = ${JSON.stringify(threads)};
  const pinnedCount = Number(new URLSearchParams(location.search).get("qa-pinned") || "0");
  const rows = all.map((row, index) => index < pinnedCount ? row : { ...row, pinned: false });
  window.__qaNativeCalls = [];
  window.TurnloomNative = {
    secureGet(key) { return store.has(key) ? store.get(key) : null; },
    secureSet(key, value) { store.set(key, String(value)); return true; },
    secureRemove(key) { store.delete(key); return true; },
    haptic() {}, setLightBars() {}, scanQr() {},
    getAppInfo() {
      return JSON.stringify({ label: "Codex-Turnloom", version: "2.2.5", versionCode: 94, packageName: "com.codex.turnloom.app", cameraAvailable: false, updatesAvailable: true });
    },
    request(requestId, payloadJson) {
      let payload = {}; try { payload = JSON.parse(payloadJson) || {}; } catch { payload = {}; }
      const url = String(payload.url || "");
      window.__qaNativeCalls.push(url);
      const reply = (status, body, error) => setTimeout(() => window.__turnloomNativeHttpResult?.(requestId, JSON.stringify({ status, body: body === undefined ? "" : body, error })), 15);
      const path = url.replace(/^https?:\\/\\/[^/]+/, "").split("?")[0];
      if (path === "/api/threads") return reply(200, JSON.stringify({ threads: rows, total: rows.length, nextCursor: null }));
      if (path === "/api/health") return reply(200, JSON.stringify({ version: "2.2.5", appVersion: "2.2.5", appVersionCode: 94 }));
      if (path === "/api/harnesses") return reply(200, JSON.stringify({
        ok: true, protocol: "codex-turnloom", version: 2,
        machineId: "qa-pinned-machine", machineName: "QA 置顶宿主", defaultHarnessId: "codex",
        harnesses: [{ id: "codex", name: "Codex Desktop", token: "qa-codex-token", kind: "codex", defaultHarness: true, online: true }],
      }));
      return reply(404, JSON.stringify({ error: "qa-stub" }));
    },
    cancelRequest() {}, downloadUpdate() {}, cancelUpdate() {}, installUpdate() {},
  };
})();`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let preview = null;
let browser = null;

const clickView = (label) => browser.eval(`(() => {
  const el = [...document.querySelectorAll('.tl-filter-chip')].find((b) => b.textContent.includes(${JSON.stringify(label)}));
  if (!el) return false;
  el.click();
  return true;
})()`);

/** Rows fade in; a fixed sleep reads an intermediate frame. Wait for the count. */
async function waitForRows(expected, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  let last = -1;
  while (Date.now() < deadline) {
    last = await browser.eval("document.querySelectorAll('[data-thread-id]').length").catch(() => -1);
    if (last >= expected) return last;
    await sleep(120);
  }
  return last;
}

async function readList(label) {
  return browser.eval(`(() => {
    const rows = [...document.querySelectorAll('[data-thread-id]')];
    const ids = rows.map((el) => el.getAttribute('data-thread-id'));
    const group = document.querySelector('[data-qa="pinned-group"]');
    const text = document.body.innerText;
    const groupTop = group ? Math.round(group.getBoundingClientRect().top) : null;
    const firstRowTop = rows.length ? Math.round(rows[0].getBoundingClientRect().top) : null;
    const dupes = ids.filter((id, index) => ids.indexOf(id) !== index);
    return JSON.stringify({
      ids, dupes, hasGroup: Boolean(group), groupTop, firstRowTop,
      hasPinnedWord: text.includes('置顶'),
      view: document.querySelector('.tl-filter-chip.is-active')?.textContent || '',
    });
  })()`).then(JSON.parse);
}

try {
  if (!fs.existsSync(path.join(APP, "dist", "index.html"))) throw new Error("app/dist is missing — run `npm run app:build` first");
  const port = await freePort();
  preview = spawn(process.execPath, [
    path.join(APP, "node_modules/vite/bin/vite.js"), "preview",
    "--port", String(port), "--strictPort", "--host", "127.0.0.1",
  ], { cwd: APP, stdio: "ignore", windowsHide: true });
  const base = `http://127.0.0.1:${port}/`;
  await waitForHttp(base);

  browser = await new CDP({ port: CDP_PORT, width: 390, height: 844, scale: 3 }).launch();
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: bridgeSource(THREADS) });

  // ---- state 1: no pinned rows -------------------------------------------
  await browser.navigate(`${base}?qa-pinned=0`);
  // The list boots on 按项目 (collapsed groups); the flat 按时间 view is the
  // one that must show every row, so switch before counting.
  await clickView("按时间");
  await waitForRows(5);
  const none = await readList("none");
  check(none.ids.length === 5, "all five fixture rows render", none.ids.join(","));
  check(!none.hasGroup && !none.hasPinnedWord, "0 pinned renders no group and no 置顶 label", `hasGroup=${none.hasGroup} word=${none.hasPinnedWord}`);

  // ---- state 2: two pinned rows ------------------------------------------
  await browser.navigate(`${base}?qa-pinned=2`);
  await clickView("按时间");
  await waitForRows(5);
  const time = await readList("time");
  if (time.ids.length !== 5) {
    const rowsByClass = await browser.eval("document.querySelectorAll('.tl-thread-row').length");
    const body = await browser.eval("document.body.innerText.replace(/\\s+/g,' ').slice(0, 260)");
    log(`debug · .tl-thread-row=${rowsByClass} · ${body}`);
  }
  check(time.hasGroup, "2 pinned renders the group in the time view");
  check(time.ids.length === 5, "no row disappears", String(time.ids.length));
  check(time.dupes.length === 0, "no id renders twice in the time view", time.dupes.join(",") || "0 dupes");
  check(time.groupTop !== null && time.groupTop <= (time.firstRowTop ?? Infinity) + 1,
    "the pinned group is the first thing in the list", `group=${time.groupTop} firstRow=${time.firstRowTop}`);

  await clickView("按项目");
  await sleep(500);
  // Project groups start collapsed; expand every one so the dedupe check sees all rows.
  // One click per turn: a single evaluate that clicks them all races React's re-render.
  for (let i = 0; i < 6; i += 1) {
    const clicked = await browser.eval(`(() => {
      const head = [...document.querySelectorAll('.tl-group-head')]
        .find((el) => el.getAttribute('aria-expanded') === 'false');
      if (!head) return false;
      head.click();
      return true;
    })()`);
    if (!clicked) break;
    await sleep(220);
  }
  await waitForRows(5);
  const project = await readList("project");
  check(project.hasGroup, "2 pinned renders the group in the project view");
  check(project.dupes.length === 0, "no id renders twice in the project view", project.dupes.join(",") || "0 dupes");
  check(project.ids.length === 5, "project view keeps every row", String(project.ids.length));

  await clickView("按时间");
  await sleep(300);
  await browser.screenshot(OUT);
  log(`screenshot ${OUT}`);
} catch (error) {
  check(false, "harness", error.message);
  try {
    const body = await browser.eval("document.body.innerText.slice(0, 400)");
    const calls = await browser.eval("JSON.stringify(window.__qaNativeCalls || [])");
    log(`page text: ${String(body).replace(/\s+/g, " ").slice(0, 240)}`);
    log(`native calls: ${String(calls).slice(0, 400)}`);
  } catch { /* page gone */ }
} finally {
  try { await browser?.close(); } catch { /* ignore */ }
  try { preview?.kill(); } catch { /* ignore */ }
  await sleep(200);
}

log(failures === 0 ? "RESULT: PASS" : `RESULT: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);


