#!/usr/bin/env node
/**
 * 2.4.2 B gate — update is one sheet with two actions (Vera).
 *
 * Runs the REAL built bundle in headless Edge against:
 *   - the shared visual fixture as the paired computer (`/api/harnesses`, `/api/health`),
 *   - a native bridge stub that answers the public R2 manifest and records
 *     `downloadUpdate` / `installUpdate` calls.
 *
 * Criteria (NB3's card, judged on pixels/DOM/counts, never on intent):
 *   1. cold start + manifest newer  -> sheet in the DOM with ZERO clicks, zero downloads;
 *   2. cold start + manifest current -> no sheet; version row `已是最新 · HH:mm`;
 *   3. 稍后 -> same version never auto-opens again in this process; row still `有更新 X`;
 *      a later, higher versionCode may pop again;
 *   4. no answered manifest -> row says 检查失败, never 已是最新;
 *   5. 立即更新 -> one native download; ready -> installer called exactly once;
 *   6. another sheet open when the check finds an update -> no stacking; after it
 *      closes the update sheet is released (deferred, not lost);
 *   7. unpaired cold start -> silent check, no sheet.
 *
 * Usage:
 *   node tools/qa/check-242-update.mjs --build
 *   node tools/qa/check-242-update.mjs --allow-stale
 * Exit code 1 when any criterion fails.
 */
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CDP } from "./cdp.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const argOf = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const DIST = path.resolve(REPO, argOf("--dist", "tmp/dist-vera-242-update"));
const SHOTS = path.resolve(REPO, argOf("--shots", ".scratch/vera-242-update"));
const WIDTH = Number(argOf("--width", "390"));
const HEIGHT = Number(argOf("--height", "844"));
const CDP_PORT = Number(argOf("--cdp-port", "9441"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

if (argv.includes("--build")) {
  const vite = path.join(REPO, "app", "node_modules", "vite", "bin", "vite.js");
  if (!fs.existsSync(vite)) { console.error(`[242] no vite at ${vite} — run npm ci in app/ first`); process.exit(2); }
  const tmp = path.join(REPO, ".scratch", "tmp");
  fs.mkdirSync(tmp, { recursive: true });
  const built = spawnSync(process.execPath, [vite, "build", "--outDir", DIST, "--emptyOutDir"], {
    cwd: path.join(REPO, "app"),
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, TEMP: tmp, TMP: tmp },
  });
  if (built.status !== 0) { console.error("[242] build failed"); process.exit(2); }
}
if (!fs.existsSync(path.join(DIST, "index.html"))) {
  console.error(`[242] no bundle at ${DIST} — pass --build`);
  process.exit(2);
}
if (!argv.includes("--build") && !argv.includes("--allow-stale")) {
  const newest = (dir) => {
    let latest = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) latest = Math.max(latest, newest(full));
      else latest = Math.max(latest, fs.statSync(full).mtimeMs);
    }
    return latest;
  };
  if (newest(path.join(REPO, "app", "src")) > fs.statSync(path.join(DIST, "index.html")).mtimeMs + 1000) {
    console.error("[242] bundle is older than app/src — re-run with --build (or --allow-stale on purpose)");
    process.exit(2);
  }
}

const MACHINE_PORT = await freePort();
const APP_PORT = await freePort();

// --- paired computer: the shared visual fixture ----------------------------
const fixture = spawn(process.execPath, [path.join(REPO, "tools/qa/visual-fixture.mjs")], {
  env: { ...process.env, QA_VISUAL_PORT: String(MACHINE_PORT) },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
fixture.stdout.on("data", (d) => process.stderr.write(`[machine] ${d}`));
fixture.stderr.on("data", (d) => process.stderr.write(`[machine!] ${d}`));

const fixtureReady = (async () => {
  const end = Date.now() + 10_000;
  while (Date.now() < end) {
    try {
      const response = await fetch(`http://127.0.0.1:${MACHINE_PORT}/api/harnesses`);
      if (response.status === 200) return true;
    } catch { /* not up yet */ }
    await sleep(150);
  }
  return false;
})();

// --- static server for the built bundle ------------------------------------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json; charset=utf-8", ".woff2": "font/woff2" };
const preview = http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || "/").split("?")[0]);
  const file = path.join(DIST, rel === "/" ? "index.html" : rel);
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("not found"); }
  const body = fs.readFileSync(file);
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream", "content-length": body.length, "cache-control": "no-store" });
  res.end(body);
});
await new Promise((resolve) => preview.listen(APP_PORT, "127.0.0.1", resolve));
const BASE = `http://127.0.0.1:${APP_PORT}/`;
const MACHINE_URL = `http://127.0.0.1:${MACHINE_PORT}`;

const asset = (() => {
  const dir = path.join(DIST, "assets");
  const js = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".js")) : [];
  const biggest = js.map((f) => ({ f, size: fs.statSync(path.join(dir, f)).size })).sort((a, b) => b.size - a.size)[0];
  return biggest ? { file: `assets/${biggest.f}`, bytes: biggest.size } : null;
})();

const manifestOf = (version, versionCode, notes = "") => ({
  version,
  versionCode,
  apk: `turnloom/Codex-Turnloom-${version}.apk`,
  size: 1024,
  sha256: String(versionCode).padStart(64, "4"),
  publishedAt: "2026-11-22T12:00:00Z",
  ...(notes ? { notes } : {}),
});
const NEWER = manifestOf("9.9.9", 999, "QA 夹具：比已安装版本新");
const HIGHER = manifestOf("10.0.0", 1000, "QA 夹具：同进程内出现更高版本");
const CURRENT = manifestOf("2.4.2", 101);

function seedScript({ manifest, manifestStatus = 200, paired = true, failServerUpdate = false }) {
  const registry = {
    version: 3,
    activeMachineId: "qa-visual-machine",
    machines: [{
      machineId: "qa-visual-machine",
      machineName: "QA 工作站",
      serverUrl: MACHINE_URL,
      machineToken: "qa-token-a",
      harnesses: [{ id: "codex", name: "Codex Desktop", token: "qa-codex-token", kind: "codex", online: true, defaultHarness: true }],
      defaultHarnessId: "codex",
      lastUsedAt: Date.now() - 60_000,
    }],
  };
  return `(() => {
    const PREFIX = 'tlq.';
    window.__qaManifest = ${JSON.stringify(manifest)};
    window.__qaManifestStatus = ${Number(manifestStatus)};
    window.__qaSetManifest = (next, status) => { window.__qaManifest = next; window.__qaManifestStatus = status || 200; };
    window.__qaManifestRequests = 0;
    window.__qaFailServerUpdate = ${failServerUpdate ? "true" : "false"};
    window.__qaDownloads = [];
    window.__qaInstalls = 0;
    window.__qaCancels = 0;
    const answer = (requestId, result) => { try { window.__turnloomNativeHttpResult(requestId, JSON.stringify(result)); } catch (e) {} };
    window.TurnloomNative = {
      secureGet: (k) => { try { return localStorage.getItem(PREFIX + k); } catch (e) { return null; } },
      secureSet: (k, v) => { try { localStorage.setItem(PREFIX + k, String(v)); return true; } catch (e) { return false; } },
      secureRemove: (k) => { try { localStorage.removeItem(PREFIX + k); return true; } catch (e) { return false; } },
      haptic: () => {}, scanQr: () => {}, setLightBars: () => {}, openExternalUrl: () => true,
      getAppInfo: () => JSON.stringify({
        label: 'Codex-Turnloom', version: '2.4.2', versionCode: 101,
        packageName: 'com.codex.turnloom.app', cameraAvailable: false, updatesAvailable: true,
      }),
      request: (requestId, payloadJson) => {
        let p = {}; try { p = JSON.parse(payloadJson) || {}; } catch (e) {}
        const url = String(p.url || '');
        if (url === 'https://dl.736.de5.net/turnloom/latest.json') {
          window.__qaManifestRequests += 1;
          return setTimeout(() => {
            if (window.__qaManifestStatus !== 200) return answer(requestId, { status: window.__qaManifestStatus, body: '' });
            answer(requestId, { status: 200, body: JSON.stringify(window.__qaManifest) });
          }, 30);
        }
        if (window.__qaFailServerUpdate && url.includes('/api/app/update')) {
          return setTimeout(() => answer(requestId, { status: 503, body: '' }), 30);
        }
        fetch(url, { method: p.method || 'GET', headers: p.headers || {}, ...(p.body ? { body: p.body } : {}) })
          .then(async (response) => answer(requestId, { status: response.status, body: await response.text() }))
          .catch((error) => answer(requestId, { status: 0, body: '', error: String((error && error.message) || error) }));
      },
      cancelRequest: () => {},
      downloadUpdate: (id, optionsJson) => {
        let options = {}; try { options = JSON.parse(optionsJson) || {}; } catch (e) {}
        window.__qaDownloads.push({ id, options });
        setTimeout(() => window.__turnloomNativeUpdateEvent?.(id, JSON.stringify({ state: 'downloading', received: 400, total: 1024 })), 250);
        setTimeout(() => window.__turnloomNativeUpdateEvent?.(id, JSON.stringify({ state: 'ready' })), 1600);
      },
      cancelUpdate: () => { window.__qaCancels += 1; },
      installUpdate: () => { window.__qaInstalls += 1; },
    };
    ${paired ? `try { localStorage.setItem(PREFIX + 'turnloom.machine.v2', ${JSON.stringify(JSON.stringify(registry))}); } catch (e) {}` : ""}
  })();`;
}

const lines = [];
const checks = {};
let failures = 0;
const log = (line) => { lines.push(line); console.log(line); };
function check(ok, id, label, detail = "") {
  checks[id] = { pass: Boolean(ok), label, detail: String(detail).slice(0, 400) };
  if (!ok) failures += 1;
  log(`${ok ? "PASS" : "FAIL"} ${id} ${label}${detail ? ` — ${detail}` : ""}`);
}

let browser = null;
let scriptId = null;

async function openApp(seed) {
  if (scriptId) {
    try { await browser.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: scriptId }); } catch { /* ignore */ }
    scriptId = null;
  }
  await browser.clearStorage(BASE.replace(/\/$/, ""));
  const added = await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: seed });
  scriptId = added.identifier;
  await browser.navigate(BASE);
}

async function until(fn, timeoutMs = 12_000, step = 150) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { if (await fn()) return true; } catch { /* keep waiting */ }
    await sleep(step);
  }
  return false;
}

const evalJs = (expression) => browser.eval(expression);

/** Evidence capture must not fail the layout gate: one retry, then report it. */
async function shoot(name) {
  const file = path.join(SHOTS, name);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await browser.screenshot(file);
      return file;
    } catch (error) {
      log(`WARN screenshot ${name} attempt ${attempt}: ${error.message}`);
      await sleep(600);
    }
  }
  check(false, `shot-${name}`, `截图失败（两次尝试）：${name}`);
  return "";
}
const drawerInfo = () => evalJs(`(() => {
  const drawers = Array.from(document.querySelectorAll('[data-vaul-drawer]'));
  const el = drawers[0] || null;
  return {
    count: drawers.length,
    text: el ? (el.innerText || '').replace(/\\s+/g, ' ').trim() : '',
    buttons: el ? Array.from(el.querySelectorAll('button')).map((b) => (b.innerText || '').replace(/\\s+/g, ' ').trim()).filter(Boolean) : [],
  };
})()`);

async function clickText(selector, text) {
  return evalJs(`(() => {
    const el = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
      .find((node) => ((node.innerText || node.textContent || '').replace(/\\s+/g, ' ')).includes(${JSON.stringify(text)}));
    if (!el) return 'missing';
    el.scrollIntoView({ block: 'center' });
    el.click();
    return 'clicked';
  })()`);
}

async function openSettings() {
  const clicked = await evalJs(`(() => {
    const tab = Array.from(document.querySelectorAll('.tl-tabbar button, .tl-tabbar [role="tab"]'))
      .find((el) => /设置/.test((el.innerText || '') + (el.getAttribute('aria-label') || '')));
    if (!tab) return 'missing';
    tab.click();
    return 'clicked';
  })()`);
  if (clicked !== "clicked") return false;
  return until(async () => Boolean(await evalJs(`Boolean(document.querySelector('.tl-settings-scroll'))`)), 6000);
}

const versionRowText = () => evalJs(`(() => {
  const rows = Array.from(document.querySelectorAll('.tl-settings-row'));
  const row = rows.find((el) => (el.innerText || '').includes('版本 2.4.2'));
  return row ? (row.innerText || '').replace(/\\s+/g, ' ').trim() : '';
})()`);

const fireForeground = () => evalJs(`(() => { document.dispatchEvent(new Event('visibilitychange')); return document.visibilityState; })()`);

const SIGNATURE_OLD_ROWS = ["手动检查更新", "下载新版本", "暂停下载", "打开系统安装界面"];

try {
  if (!await fixtureReady) throw new Error(`machine fixture did not answer on ${MACHINE_PORT}`);
  fs.mkdirSync(SHOTS, { recursive: true });

  browser = await new CDP({ port: CDP_PORT, width: WIDTH, height: HEIGHT, scale: 3 }).launch();

  // ------------------------------------------------------------------ case 1
  await openApp(seedScript({ manifest: NEWER }));
  const workbench = await until(async () => Boolean(await evalJs(`Boolean(document.querySelector('.tl-tabbar'))`)), 15_000);
  check(workbench, "boot-workbench", "paired cold start reaches the workbench");

  const autoOpen = await until(async () => {
    const info = await drawerInfo();
    return info.count === 1 && info.text.includes("发现新版本 9.9.9");
  }, 15_000);
  const cold = await drawerInfo();
  check(autoOpen, "cold-auto-sheet", "cold start finds 9.9.9 and opens the sheet with zero clicks", cold.text.slice(0, 120));
  check(cold.count === 1, "cold-single-sheet", "exactly one sheet is in the DOM", `count=${cold.count}`);
  const downloadsAtOpen = await evalJs("window.__qaDownloads.length");
  check(downloadsAtOpen === 0, "cold-no-download", "自动弹层不开始下载", `downloadUpdate calls=${downloadsAtOpen}`);
  check(cold.text.includes("立即更新") && cold.text.includes("稍后"), "cold-two-actions", "the sheet offers exactly 立即更新 / 稍后", cold.buttons.join(" | "));
  const oldRows = SIGNATURE_OLD_ROWS.filter((row) => cold.text.includes(row));
  check(oldRows.length === 0, "cold-no-four-rows", "2.4.1 的四行不再出现", oldRows.join(",") || "none");

  // Let Vaul finish its slide-in before the screenshot and the geometry read.
  await sleep(800);
  await shoot(`cold-available-${WIDTH}.png`);

  const geo = await evalJs(`(() => {
    const el = document.querySelector('[data-vaul-drawer]');
    const r = el.getBoundingClientRect();
    const actions = Array.from(el.querySelectorAll('button')).map((b) => {
      const br = b.getBoundingClientRect();
      return { h: Math.round(br.height), top: Math.round(br.top), bottom: Math.round(br.bottom) };
    });
    return { w: Math.round(r.width), vw: window.innerWidth, sw: document.documentElement.scrollWidth, vh: window.innerHeight, actions };
  })()`);
  check(geo.w <= geo.vw && geo.sw <= geo.vw, "sheet-geometry", "弹层不撑横向滚动", `sheet=${geo.w} vw=${geo.vw} scrollWidth=${geo.sw}`);
  check(geo.actions.length >= 2 && geo.actions.every((a) => a.h >= 44), "sheet-targets", "两个动作都是 ≥44px 命中区", `heights=${geo.actions.map((a) => a.h).join(",")}`);
  check(geo.actions.length >= 2 && geo.actions.every((a) => a.top >= 0 && a.bottom <= geo.vh), "sheet-actions-visible", "两个动作在首屏内（不用滚动才看得到）", geo.actions.map((a) => `${a.top}-${a.bottom}`).join(" ") + ` vh=${geo.vh}`);

  // ------------------------------------------------------------- download
  const tap = await clickText('[data-vaul-drawer] button', "立即更新");
  check(tap === "clicked", "download-tap", "「立即更新」is a real button", tap);
  const downloaded = await until(async () => Number(await evalJs("window.__qaDownloads.length")) === 1, 5000);
  const download = await evalJs("window.__qaDownloads[0] || null");
  check(downloaded, "download-once", "one tap calls native downloadUpdate exactly once", `count=${await evalJs("window.__qaDownloads.length")}`);
  check(download?.options?.url === "https://dl.736.de5.net/turnloom/Codex-Turnloom-9.9.9.apk", "download-url", "download URL is the public R2 APK", download?.options?.url || "(none)");
  check(download?.options?.sha256 === NEWER.sha256, "download-sha", "download carries the manifest sha256", String(download?.options?.sha256 || "").slice(0, 12));
  check((download?.options?.token || "") === "", "download-no-token", "public download carries no machine token", JSON.stringify(download?.options?.token || ""));

  const progress = await until(async () => Boolean(await evalJs(`Boolean(document.querySelector('[data-qa="update-progress"]'))`)), 3000);
  check(progress, "download-progress", "进度条出现在同一弹层里");
  await shoot(`downloading-${WIDTH}.png`);

  const installed = await until(async () => Number(await evalJs("window.__qaInstalls")) === 1, 6000);
  check(installed, "installer-once", "ready 后自动打开系统安装器", `installUpdate calls=${await evalJs("window.__qaInstalls")}`);
  await sleep(1500);
  const installsLater = await evalJs("window.__qaInstalls");
  check(installsLater === 1, "installer-not-twice", "installer is not launched a second time", `installUpdate calls=${installsLater}`);

  // ------------------------------------------------------------------ case 2
  await openApp(seedScript({ manifest: NEWER }));
  await until(async () => Boolean(await evalJs(`Boolean(document.querySelector('.tl-tabbar'))`)), 15_000);
  await until(async () => (await drawerInfo()).text.includes("发现新版本 9.9.9"), 15_000);
  const later = await clickText('[data-vaul-drawer] button', "稍后");
  check(later === "clicked", "later-tap", "「稍后」is a real button", later);
  const closed = await until(async () => (await drawerInfo()).count === 0, 4000);
  check(closed, "later-closes", "稍后 closes the sheet");

  const requestsBefore = Number(await evalJs("window.__qaManifestRequests"));
  await fireForeground();
  await sleep(2200);
  const requestsAfter = Number(await evalJs("window.__qaManifestRequests"));
  // A "no popup" green only means something if the foreground check really ran.
  check(requestsAfter > requestsBefore, "foreground-rechecked", "前台检查确实又请求了清单", `${requestsBefore} -> ${requestsAfter} @${await evalJs("document.visibilityState")}`);
  const reopened = await drawerInfo();
  check(reopened.count === 0, "later-silent-again", "同一版本在本进程内不再自动弹", `count=${reopened.count} text=${reopened.text.slice(0, 60)}`);

  const settings = await openSettings();
  check(settings, "settings-open", "设置页可打开（版本行所在）");
  const row = await versionRowText();
  check(/有更新 9\.9\.9/.test(row), "row-after-later", "版本行仍显示 有更新 9.9.9", row);

  const requestsBeforeHigher = Number(await evalJs("window.__qaManifestRequests"));
  await evalJs(`window.__qaSetManifest(${JSON.stringify(HIGHER)}, 200)`);
  await fireForeground();
  const higher = await until(async () => (await drawerInfo()).text.includes("发现新版本 10.0.0"), 8000);
  const rowAfterHigher = await versionRowText();
  const bodyAfterHigher = await evalJs("(document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 240)");
  check(higher, "higher-pops-again", "同进程内出现更高版本可以再弹",
    `${(await drawerInfo()).text.slice(0, 80)} · requests ${requestsBeforeHigher} -> ${await evalJs("window.__qaManifestRequests")} · row=${rowAfterHigher} · body=${bodyAfterHigher.slice(0, 120)}`);
  await clickText('[data-vaul-drawer] button', "稍后");
  await until(async () => (await drawerInfo()).count === 0, 3000);

  // ------------------------------------------------------------------ case 3
  await openApp(seedScript({ manifest: CURRENT }));
  await until(async () => Boolean(await evalJs(`Boolean(document.querySelector('.tl-tabbar'))`)), 15_000);
  await sleep(2600);
  const currentDrawer = await drawerInfo();
  check(currentDrawer.count === 0, "current-no-popup", "清单=当前版本：冷启动不弹层", `count=${currentDrawer.count}`);
  const settings2 = await openSettings();
  const row2 = settings2 ? await versionRowText() : "";
  check(/已是最新 · \d{2}:\d{2}/.test(row2), "row-current", "版本行 = 已是最新 · HH:mm", row2);
  await shoot(`settings-current-${WIDTH}.png`);

  // ------------------------------------------------------------------ case 4
  await openApp(seedScript({ manifest: CURRENT, manifestStatus: 500, failServerUpdate: true }));
  await until(async () => Boolean(await evalJs(`Boolean(document.querySelector('.tl-tabbar'))`)), 15_000);
  await sleep(2200);
  const settings3 = await openSettings();
  const row3 = settings3 ? await versionRowText() : "";
  check(settings3 && row3.includes("检查失败"), "row-failure", "清单失败且无备用来源：版本行 = 检查失败", row3);
  check(!row3.includes("已是最新"), "row-failure-not-current", "失败绝不被写成已是最新", row3);

  // ------------------------------------------------------------------ case 5
  await openApp(seedScript({ manifest: NEWER }));
  await until(async () => Boolean(await evalJs(`Boolean(document.querySelector('.tl-tabbar'))`)), 15_000);
  await until(async () => (await drawerInfo()).text.includes("发现新版本 9.9.9"), 15_000);
  await clickText('[data-vaul-drawer] button', "稍后");
  await until(async () => (await drawerInfo()).count === 0, 3000);
  await openSettings();
  const diag = await clickText('.tl-settings-row', "诊断");
  const diagOpen = diag === "clicked" && await until(async () => (await drawerInfo()).text.includes("连接状态"), 5000);
  check(diagOpen, "other-sheet-open", "诊断弹层已打开（复现「冷启动时有别的 sheet」）", diag);

  await evalJs(`window.__qaSetManifest(${JSON.stringify(HIGHER)}, 200)`);
  await fireForeground();
  await sleep(2000);
  const stacked = await drawerInfo();
  check(stacked.count === 1 && !stacked.text.includes("立即更新"), "no-stacking", "更新弹层不叠在诊断上", `count=${stacked.count} text=${stacked.text.slice(0, 60)}`);

  // Close whatever is open through the same path Android's Back uses; a synthetic
  // overlay click does not drive Vaul's pointer handler.
  const back = await evalJs(`(() => {
    if (typeof window.__turnloomBack !== 'function') return 'missing';
    return String(window.__turnloomBack());
  })()`);
  const released = await until(async () => (await drawerInfo()).text.includes("发现新版本 10.0.0"), 6000);
  check(released, "deferred-released", "别的 sheet 关闭后，更新提示延后弹出而不是丢失", `back=${back}`);

  // ------------------------------------------------------------------ case 6
  await openApp(seedScript({ manifest: NEWER, paired: false }));
  const connect = await until(async () => Boolean(await evalJs(`Boolean(document.querySelector('.tl-connect .tl-large-title'))`)), 12_000);
  await sleep(2500);
  const unpaired = await drawerInfo();
  check(connect, "unpaired-connect", "未配对冷启动到达连接页（静默检查）", String(connect));
  check(unpaired.count === 0, "unpaired-no-popup", "未配对：不弹更新层", `count=${unpaired.count}`);

  // ------------------------------------------------------------------ case 7
  // The settings path, counted like a thumb: row tap (1) + 立即更新 (2).
  await openApp(seedScript({ manifest: NEWER }));
  await until(async () => Boolean(await evalJs(`Boolean(document.querySelector('.tl-tabbar'))`)), 15_000);
  await until(async () => (await drawerInfo()).text.includes("发现新版本 9.9.9"), 15_000);
  await clickText('[data-vaul-drawer] button', "稍后");
  await until(async () => (await drawerInfo()).count === 0, 3000);
  const settingsPath = await openSettings();
  check(settingsPath, "settings-path-open", "设置页可打开（两次点击路径的起点）");
  const rowTap = await clickText('.tl-settings-row', "版本 2.4.2");
  const rowSheet = await until(async () => (await drawerInfo()).text.includes("发现新版本 9.9.9"), 4000);
  check(rowTap === "clicked" && rowSheet, "settings-row-opens-sheet", "第 1 次点击：版本行打开同一张更新弹层", rowTap);
  await clickText('[data-vaul-drawer] button', "立即更新");
  const twoClickDownload = await until(async () => Number(await evalJs("window.__qaDownloads.length")) === 1, 5000);
  check(twoClickDownload, "settings-two-clicks", "第 2 次点击：立即更新发起下载（设置到下载共 2 次点击）", `downloads=${await evalJs("window.__qaDownloads.length")}`);
} catch (error) {
  check(false, "harness", "gate harness crashed", error?.stack || String(error));
} finally {
  try { await browser?.close(); } catch { /* ignore */ }
  try { fixture.kill(); } catch { /* ignore */ }
  try { preview.close(); } catch { /* ignore */ }
  await sleep(200);
}

const summary = { run: { at: new Date().toISOString(), viewport: `${WIDTH}x${HEIGHT}`, asset }, checks, failures };
fs.mkdirSync(SHOTS, { recursive: true });
fs.writeFileSync(path.join(SHOTS, "check-242-update.json"), JSON.stringify(summary, null, 2));
log(`asset ${asset?.file || "(none)"} · ${asset?.bytes ?? 0} B`);
log(`screenshots ${SHOTS}`);
log(failures === 0 ? "RESULT: PASS" : `RESULT: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
