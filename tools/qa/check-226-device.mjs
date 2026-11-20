/**
 * 2.2.6 device panel: two-machine criteria (Vera).
 *
 * Why a separate runner: the shared fixtures expose a single machine, so
 * "only one [data-machine] value on screen" is structurally true there — the
 * criterion can never fail and its green says nothing. This harness seeds a
 * registry with two paired machines (A = tools/qa/visual-fixture.mjs, B = a
 * proxy that reports its own identity) and drives the real switch:
 * success, and failure-with-message (UI_SPEC §4).
 *
 * It also runs tools/qa/snippets/check-226-list.js on the same bundle, so the
 * list-side criteria and the device tree are judged against one asset name and
 * byte count.
 *
 * All ports are picked at run time, so parallel QA runs do not collide.
 *
 * Usage:
 *   node tools/qa/check-226-device.mjs --build               # rebuild into tmp/dist-vera, 390x844
 *   node tools/qa/check-226-device.mjs --mode fail --width 320 --height 568
 *   node tools/qa/check-226-device.mjs --build --json tmp/226.json
 * Exit code 1 when any criterion fails — this is the packaging gate.
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
const MODE = argOf("--mode", "ok");            // ok | fail  (B's /api/harnesses)
const WIDTH = Number(argOf("--width", "390"));
const HEIGHT = Number(argOf("--height", "844"));
const DIST = path.resolve(REPO, argOf("--dist", "tmp/dist-vera"));
const JSON_OUT = argOf("--json", "");
const SNIPPET = path.join(REPO, "tools/qa/snippets/check-226-list.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});
const json = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "accept, content-type, x-access-token",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "cache-control": "no-store",
  });
  res.end(payload);
};

if (argv.includes("--build")) {
  const vite = path.join(REPO, "app", "node_modules", "vite", "bin", "vite.js");
  if (!fs.existsSync(vite)) { console.error(`[226] no vite at ${vite} — run npm ci in app/ first`); process.exit(2); }
  const built = spawnSync(process.execPath, [vite, "build", "--outDir", DIST, "--emptyOutDir"], { cwd: path.join(REPO, "app"), stdio: "inherit", windowsHide: true });
  if (built.status !== 0) { console.error("[226] build failed"); process.exit(2); }
}
if (!fs.existsSync(path.join(DIST, "index.html"))) { console.error(`[226] no bundle at ${DIST} — pass --build`); process.exit(2); }

// Without --build the runner reuses whatever bundle sits in DIST. That is handy
// for re-measuring the same artifact, and dangerous as a gate: a stale bundle
// looks green. Refuse it instead of trusting the command line.
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
  const srcMtime = newest(path.join(REPO, "app", "src"));
  const bundleMtime = fs.statSync(path.join(DIST, "index.html")).mtimeMs;
  if (srcMtime > bundleMtime + 1000) {
    console.error(`[226] ${path.relative(REPO, DIST)} is older than app/src (${new Date(bundleMtime).toISOString()} < ${new Date(srcMtime).toISOString()})`);
    console.error("[226] refusing to measure a stale bundle — re-run with --build");
    console.error("[226] --allow-stale is for comparing two artifacts on purpose, never for the release gate");
    process.exit(2);
  }
}

const A_PORT = await freePort();     // visual fixture (machine A)
const B_PORT = await freePort();     // proxy with its own identity (machine B)
const APP_PORT = await freePort();   // static preview of the built bundle
const CDP_PORT = await freePort();

// --- machine A: the shared visual fixture (identity: qa-visual-machine) -----
const fixture = spawn(process.execPath, [path.join(REPO, "tools/qa/visual-fixture.mjs")], {
  env: { ...process.env, QA_VISUAL_PORT: String(A_PORT) },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
fixture.stdout.on("data", (d) => process.stderr.write(`[A] ${d}`));
fixture.stderr.on("data", (d) => process.stderr.write(`[A!] ${d}`));
const fixtureReady = (async () => {
  const end = Date.now() + 10_000;
  while (Date.now() < end) {
    try { const r = await fetch(`http://127.0.0.1:${A_PORT}/api/harnesses`); if (r.ok) return true; } catch { /* not up yet */ }
    await sleep(150);
  }
  return false;
})();

// --- machine B: same fixture, different identity (or a hard failure) --------
const MACHINE_B = {
  machineId: "qa-second-machine",
  machineName: "书房 Mac",
  defaultHarnessId: "b-codex",
  harnesses: [
    { id: "b-codex", name: "Codex Desktop", token: "qa-b-codex", kind: "codex", online: true, defaultHarness: true },
    { id: "b-pi", name: "PI-Desktop", token: "qa-b-pi", kind: "pi", online: true },
  ],
};
const proxyB = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "accept, content-type, x-access-token", "access-control-allow-methods": "GET, POST, OPTIONS" });
    return res.end();
  }
  const isDiscovery = /^\/api\/(harnesses|health)\b/.test(req.url || "");
  if (isDiscovery && MODE === "fail") {
    return json(res, 503, { error: "书房 Mac 的服务没有响应（QA 模拟：切换失败）" });
  }
  const upstream = http.request({ host: "127.0.0.1", port: A_PORT, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${A_PORT}` } }, (up) => {
    const chunks = [];
    up.on("data", (c) => chunks.push(c));
    up.on("end", () => {
      let body = Buffer.concat(chunks);
      if (/^\/api\/harnesses\b/.test(req.url || "")) {
        // Replace the machine identity and its harness list, keep everything else.
        try {
          const parsed = JSON.parse(body.toString("utf8"));
          Object.assign(parsed, MACHINE_B);
          body = Buffer.from(JSON.stringify(parsed), "utf8");
        } catch { /* pass through */ }
      }
      res.writeHead(up.statusCode || 200, {
        "content-type": up.headers["content-type"] || "application/json; charset=utf-8",
        "content-length": body.length,
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "accept, content-type, x-access-token",
        "cache-control": "no-store",
      });
      res.end(body);
    });
  });
  upstream.on("error", (error) => json(res, 502, { error: String(error && error.message || error) }));
  req.pipe(upstream);
});
await new Promise((resolve) => proxyB.listen(B_PORT, "127.0.0.1", resolve));

// --- static preview of the built bundle ------------------------------------
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

const asset = (() => {
  const dir = path.join(DIST, "assets");
  const js = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".js")) : [];
  const biggest = js.map((f) => ({ f, size: fs.statSync(path.join(dir, f)).size })).sort((a, b) => b.size - a.size)[0];
  return biggest ? { file: `assets/${biggest.f}`, bytes: biggest.size } : null;
})();

const REGISTRY = {
  version: 3,
  activeMachineId: "qa-visual-machine",
  machines: [
    {
      machineId: "qa-visual-machine", machineName: "QA 工作站", serverUrl: `http://127.0.0.1:${A_PORT}`, machineToken: "qa-token-a",
      harnesses: [
        { id: "codex", name: "Codex Desktop", token: "qa-codex-token", kind: "codex", online: true, defaultHarness: true },
        { id: "pidesk", name: "PI-Desktop", token: "qa-pi-token", kind: "pi", online: true },
      ],
      defaultHarnessId: "codex", lastUsedAt: Date.now() - 60_000,
    },
    {
      machineId: "qa-second-machine", machineName: "书房 Mac", serverUrl: `http://127.0.0.1:${B_PORT}`, machineToken: "qa-token-b",
      harnesses: MACHINE_B.harnesses, defaultHarnessId: "b-codex", lastUsedAt: Date.now() - 120_000,
    },
  ],
};

const seed = `(() => {
  const PREFIX = 'tlq.';
  window.TurnloomNative = {
    secureGet: (k) => { try { return localStorage.getItem(PREFIX + k); } catch (e) { return null; } },
    secureSet: (k, v) => { try { localStorage.setItem(PREFIX + k, String(v)); return true; } catch (e) { return false; } },
    secureRemove: (k) => { try { localStorage.removeItem(PREFIX + k); return true; } catch (e) { return false; } },
    haptic: () => {}, scanQr: () => {}, setLightBars: () => {},
    // The app never falls back to fetch() for /api calls: it always goes through
    // the native HTTP bridge. So the harness bridge performs the fetch itself.
    request: (requestId, payloadJson) => {
      let p = {};
      try { p = JSON.parse(payloadJson) || {}; } catch (e) {}
      const done = (result) => { try { window.__turnloomNativeHttpResult(requestId, JSON.stringify(result)); } catch (e) {} };
      fetch(p.url, { method: p.method || 'GET', headers: p.headers || {}, ...(p.body ? { body: p.body } : {}) })
        .then(async (r) => done({ status: r.status, body: await r.text() }))
        .catch((e) => done({ status: 0, body: '', error: String((e && e.message) || e) }));
    },
    cancelRequest: () => {},
    getAppInfo: () => JSON.stringify({ label: 'Turnloom', version: '2.2.6', versionCode: 95, packageName: 'com.codex.turnloom.app', cameraAvailable: true, updatesAvailable: false }),
  };
  try { localStorage.setItem(PREFIX + 'turnloom.machine.v2', ${JSON.stringify(JSON.stringify(REGISTRY))}); } catch (e) {}
})();`;

const driver = `
  const qa = (s, r = document) => Array.from(r.querySelectorAll(s));
  const txt = (el) => (el.textContent || '').replace(/\\s+/g, ' ').trim();
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 8000, step = 150) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (fn()) return true; } catch (e) {} await wait(step); } return false; };
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) }; };
  const cards = () => qa('.tl-devcard');
  const activeCard = () => cards().find((c) => c.getAttribute('data-active') === 'true' || /(^|\\s)is-active(\\s|$)/.test(c.className)) || null;
  const machineValues = () => Array.from(new Set(qa('[data-machine]').map((el) => el.getAttribute('data-machine'))));
  const openBranches = () => qa('.tl-branch').filter((b) => b.getAttribute('data-open') === 'true');
  const expandedOf = (card) => { if (!card) return null; const own = card.getAttribute('aria-expanded'); if (own !== null) return own; const inner = card.querySelector('[aria-expanded]'); return inner ? inner.getAttribute('aria-expanded') : null; };

  window.__openDevice = async () => {
    const tab = qa('.tl-tabbar button, .tl-tabbar [role="tab"]').find((el) => /设备/.test(txt(el)) || /设备/.test(el.getAttribute('aria-label') || ''));
    if (!tab) return false;
    tab.click();
    return until(() => document.querySelector('.tl-device-screen'), 8000);
  };
  window.__deviceSnapshot = () => ({
    cards: cards().map((c) => ({ name: txt(c).slice(0, 40), active: c === activeCard(), expanded: expandedOf(c) })),
    values: machineValues(),
    nodes: qa('[data-machine]').length,
    platblocks: qa('.tl-platblock').length,
    openBranches: openBranches().length,
    harnessRowsOpen: qa('.tl-harness[data-open="true"]').length,
    overflow: { scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth },
    bodyText: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 400),
  });
  window.__clickCard = async (name) => {
    const card = cards().find((c) => txt(c).includes(name));
    if (!card) return { clicked: false };
    // the card body is a button (.tl-devcard-select); tap that, like a thumb would
    const target = card.querySelector('.tl-devcard-select') || card;
    target.click();
    await wait(150);
    return { clicked: true, via: String(target.className).slice(0, 40) };
  };
  window.__alert = () => {
    const read = (el, scope) => { if (!el) return null; const r = el.getBoundingClientRect();
      return { scope, text: txt(el).slice(0, 160), top: Math.round(r.top), bottom: Math.round(r.bottom), viewportH: window.innerHeight,
        fullyVisible: r.top >= 0 && r.bottom <= window.innerHeight, inHeader: Boolean(el.closest('.tl-safe-top')) }; };
    // the device screen's own bar first: the app also has a global connection
    // banner with role=alert, and that one is not the switch failure
    const device = read(document.querySelector('[role="alert"].tl-device-error'), 'device');
    const global = read(document.querySelector('[role="alert"]:not(.tl-device-error)'), 'global');
    return { device, global, text: (device || global || {}).text || '', top: (device || global || {}).top ?? null,
      bottom: (device || global || {}).bottom ?? null, inHeader: Boolean((device || {}).inHeader),
      viewportH: window.innerHeight, fullyVisible: Boolean((device || global || {}).fullyVisible) };
  };
  true;
`;

let browser = null;
// 44x44 for anything a thumb can land on, and the band is what counts: a 38px
// cell with a ::before hit area is fine, a 44px box scaled to 43.3 is not.
const measureTouchTargets = async () => {
  const raw = await browser.eval(`(() => {
    const rows = qa('button, [role="button"], a[href], input, select, textarea');
    const bad = [];
    let counted = 0;
    const skipped = [];
    for (const el of rows) {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.bottom <= 0 || r.top >= window.innerHeight) continue; // off screen: not a target right now
      // Only measure what is whole: a control half under the tab bar or the
      // viewport edge has no measurable band, and counting it invents a red.
      const bar = document.querySelector('.tl-tabbar');
      const usableBottom = bar ? Math.min(window.innerHeight, bar.getBoundingClientRect().top) : window.innerHeight;
      if (r.top < 0 || r.bottom > usableBottom) { skipped.push(String(el.className).slice(0, 24)); continue; }
      counted += 1;
      const cx = r.left + r.width / 2;
      let top = null, bottom = null;
      for (let y = Math.max(0, r.top - 14); y <= Math.min(window.innerHeight - 1, r.bottom + 14); y += 0.5) {
        const hit = document.elementFromPoint(cx, y);
        if (hit && (hit === el || el.contains(hit))) { if (top === null) top = y; bottom = y; }
      }
      const band = top === null ? 0 : Math.round((bottom - top + 0.5) * 10) / 10;
      // covered from above (sticky header) or below: the band is not this
      // control's own, so measuring it invents a red instead of finding one
      if (top === null || top - r.top > 2 || r.bottom - bottom > 2) { skipped.push(String(el.className).slice(0, 24)); continue; }
      if (band < 44 || r.width < 44) bad.push({ cls: String(el.className).slice(0, 34), w: Math.round(r.width), h: Math.round(r.height), band, text: txt(el).slice(0, 18) });
    }
    return { counted, bad, skipped };
  })()`);
  return {
    pass: raw.bad.length === 0,
    onScreen: raw.counted, skipped: raw.skipped, tooSmall: raw.bad,
    note: 'device screen only, on-screen elements, band measured with the same 0.5px scan',
  };
};
const out = { run: { mode: MODE, viewport: { w: WIDTH, h: HEIGHT }, asset, builtAt: fs.statSync(path.join(DIST, "index.html")).mtime.toISOString() }, checks: {} };

try {
  if (!await fixtureReady) throw new Error(`machine A fixture did not answer on ${A_PORT}`);
  browser = new CDP({ port: CDP_PORT, headless: true, width: WIDTH, height: HEIGHT, scale: 2 });
  await browser.launch();
  await browser.setViewport(WIDTH, HEIGHT, 2);
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: seed });
  browser.on("Runtime.consoleAPICalled", (p) => {
    const line = (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ");
    if (/error|warn/i.test(String(p.type))) process.stderr.write(`[console:${p.type}] ${line}\n`);
  });
  const netLog = [];
  browser.on("Network.requestWillBeSent", (p) => {
    const url = p && p.request && p.request.url ? p.request.url : "";
    if (/\/api\//.test(url)) netLog.push({ t: Date.now(), url });
  });
  await browser.navigate(`http://127.0.0.1:${APP_PORT}/index.html`);
  out.probe = await browser.eval(`(async () => {
    const raws = {};
    for (const [name, url] of [['A', 'http://127.0.0.1:${A_PORT}/api/harnesses'], ['B', 'http://127.0.0.1:${B_PORT}/api/harnesses']]) {
      try { const r = await fetch(url, { headers: { 'x-access-token': 'qa-token-a' } }); raws[name] = { status: r.status, body: (await r.text()).slice(0, 120) }; }
      catch (e) { raws[name] = { error: String(e && e.message || e) }; }
    }
    return { bridge: Boolean(window.TurnloomNative), hasRequest: Boolean(window.TurnloomNative && window.TurnloomNative.request), storage: Boolean(localStorage.getItem('tlq.turnloom.machine.v2')), raws };
  })()`);
  await browser.eval(driver);
  // the list-view criteria stay the same script as before, so a device-panel
  // change cannot silently move the goalposts for the switch
  try {
    out.list = await browser.eval(fs.readFileSync(SNIPPET, "utf8"));
    out.listSummary = out.list.summary;
  } catch (error) { out.list = { error: String(error && error.message || error) }; }

  const boot = await browser.eval("(async () => { const ok = await window.__openDevice(); return { ok, snap: window.__deviceSnapshot() }; })()");
  out.checks.boot = { pass: Boolean(boot.ok) && boot.snap.cards.length === 2, reachable: Boolean(boot.ok), twoCards: boot.snap.cards.length === 2, snapshot: boot.snap };
  if (!boot.ok) throw new Error("device page did not render");

  // 1 — one machine's platforms at a time, with >=2 machines on screen
  out.checks.singleValue = {
    pass: boot.snap.cards.length >= 2 && boot.snap.values.length === 1 && boot.snap.values[0] === "qa-visual-machine" && boot.snap.nodes > 0,
    cards: boot.snap.cards.length, values: boot.snap.values, nodes: boot.snap.nodes,
    note: 'two machines seeded: the criterion can actually fail here',
  };
  // 2 — UI_SPEC §4: data-machine lives on .tl-platblock, and nowhere else
  const mount = await browser.eval(`(() => {
    const nodes = Array.from(document.querySelectorAll('[data-machine]'));
    return {
      total: nodes.length,
      onBlock: nodes.filter((el) => el.classList.contains('tl-platblock')).length,
      onOther: nodes.filter((el) => !el.classList.contains('tl-platblock')).map((el) => el.className.slice(0, 40)),
      blocks: document.querySelectorAll('.tl-platblock').length,
    };
  })()`);
  out.checks.mountedOnPlatblock = {
    pass: mount.onBlock === mount.blocks && mount.onBlock > 0 && mount.onOther.length === 0,
    blocksWithAttribute: mount.onBlock, blocks: mount.blocks, totalNodes: mount.total, otherCarriers: mount.onOther,
    note: 'UI_SPEC §4: only .tl-platblock carries data-machine',
  };
  // 3 — clicking the current card changes nothing
  const clickCurrent = await browser.eval(`(async () => {
    await until(() => openBranches().length === 1, 4000);
    const before = window.__deviceSnapshot();
    await window.__clickCard('QA 工作站');
    await new Promise((r) => setTimeout(r, 500));
    const after = window.__deviceSnapshot();
    return { before, after };
  })()`);
  const activeBefore = clickCurrent.before.cards.find((c) => c.active);
  const activeAfter = clickCurrent.after.cards.find((c) => c.active);
  out.checks.currentCardInert = {
    pass: clickCurrent.before.values.join() === clickCurrent.after.values.join()
      && clickCurrent.before.openBranches === 1 && clickCurrent.after.openBranches === 1
      && Boolean(activeBefore) && activeBefore.expanded === activeAfter.expanded,
    before: { values: clickCurrent.before.values, openBranches: clickCurrent.before.openBranches, expanded: activeBefore ? activeBefore.expanded : null },
    after: { values: clickCurrent.after.values, openBranches: clickCurrent.after.openBranches, expanded: activeAfter ? activeAfter.expanded : null },
  };

  // 4 — switching to the second machine
  const switched = await browser.eval(`(async () => {
    const click = await window.__clickCard('书房 Mac');
    const settled = await (async () => { const end = Date.now() + 9000; while (Date.now() < end) { const s = window.__deviceSnapshot(); if (s.cards.some((c) => c.active && c.name.includes('书房'))) return true; await new Promise((r) => setTimeout(r, 200)); } return false; })();
    return { click, settled, snap: window.__deviceSnapshot(), alert: window.__alert() };
  })()`);
  if (MODE === "ok") {
    out.checks.switchSuccess = {
      pass: Boolean(switched.settled) && switched.snap.values.length === 1 && switched.snap.values[0] === "qa-second-machine" && switched.snap.openBranches === 1,
      settled: Boolean(switched.settled), click: switched.click, values: switched.snap.values, cards: switched.snap.cards,
      openBranches: switched.snap.openBranches, alert: switched.alert,
    };
  } else {
    const deviceAlert = switched.alert ? switched.alert.device : null;
    const text = deviceAlert ? deviceAlert.text : "";
    const PREFIX = "切换电脑未完成：";
    const reason = text.startsWith(PREFIX) ? text.slice(PREFIX.length).trim() : "";
    out.checks.switchFailureMessage = {
      pass: Boolean(deviceAlert) && reason.length >= 8 && reason !== "请重试",
      alertText: text, reason, alert: deviceAlert, globalBanner: switched.alert ? switched.alert.global : null,
      keptCurrentCard: switched.snap.cards.find((c) => c.active)?.name || null,
      values: switched.snap.values,
      expected: "the reason itself (503 → 电脑上的服务暂时不可用…), not the 请重试 fallback",
    };
    // NB agent 09:17: the error sits in the fixed header, not at the tail of the
    // scrolling list — a user parked mid-list would never see that one.
    out.checks.alertPlacement = {
      pass: Boolean(deviceAlert && deviceAlert.inHeader),
      inHeader: deviceAlert ? deviceAlert.inHeader : null,
      top: deviceAlert ? deviceAlert.top : null,
      note: 'UI_SPEC: 顶部报错 — inside .tl-safe-top, above the scrolling list',
    };
    // NB3 09:31: a failed switch must leave the CURRENT machine exactly as it
    // was — status / online / request scope — and use its own error surface.
    const surface = await browser.eval(`(() => {
      const visible = qa('[role="alert"]').filter((el) => {
        const s = getComputedStyle(el); const r = el.getBoundingClientRect();
        return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      });
      const active = cards().find((c) => c.getAttribute('data-active') === 'true');
      return {
        alerts: visible.map((el) => ({ cls: String(el.className), text: txt(el).slice(0, 60) })),
        currentCard: active ? txt(active).slice(0, 60) : null,
      };
    })()`);
    const online = Boolean(surface.currentCard && /在线/.test(surface.currentCard) && !/离线/.test(surface.currentCard));
    out.checks.currentCardStaysOnline = {
      pass: online, currentCard: surface.currentCard,
      note: 'A was never probed; a failed switch to B must not claim A is offline',
    };
    out.checks.singleErrorSurface = {
      pass: surface.alerts.length === 1 && /tl-device-error/.test(surface.alerts[0].cls),
      alerts: surface.alerts,
      note: 'one bar on screen: the device one; the global banner is for real connection loss only',
    };
    // 44px on this screen — measured while still on the device page, and only
    // for what is actually on screen (a row below the fold has no hit area).
    out.checks.touchTargets = await measureTouchTargets();
    // "currentRequestContext() is still non-null" — proved by behaviour: the
    // refresh button calls refreshThreads(context) only when context exists.
    const mark = Date.now();
    const refresh = await browser.eval(`(async () => {
      const tab = qa('.tl-tabbar button, .tl-tabbar [role="tab"]').find((el) => /会话/.test(txt(el)) || /会话/.test(el.getAttribute('aria-label') || ''));
      if (!tab) return { tab: false };
      tab.click();
      await wait(900);
      const btn = qa('button').find((el) => /刷新会话列表/.test(txt(el)));
      if (!btn) return { tab: true, button: false, text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 160) };
      btn.click();
      await wait(2200);
      return { tab: true, button: true, disabled: btn.disabled };
    })()`);
    const hits = netLog.filter((e) => e.t >= mark && /\/api\/threads/.test(e.url));
    out.checks.stillSyncable = {
      pass: hits.length > 0,
      requests: hits.map((h) => h.url.replace(/^https?:\/\/[^/]+/, "")).slice(0, 3),
      refresh,
      note: 'after a failed switch the current machine must still be able to load the list',
    };
  }
  // 5 — the two entries that make the feature reachable at all (UI_SPEC §4).
  //     Add first: it navigates to the pairing screen, and the forget menu is a
  //     sheet that would otherwise still be covering the list.
  if (MODE === "ok") {
    const addFlow = await browser.eval(`(async () => {
      const entry = qa('button, [role="button"]').find((el) => /添加一台电脑/.test(txt(el)));
      if (!entry) return { found: false };
      entry.click();
      const opened = await until(() => /扫码|输入地址|访问码/.test(document.body.innerText || ''), 6000);
      await wait(400);
      const inputs = qa('input').map((el) => ({ type: el.type, value: el.value, placeholder: el.placeholder }));
      const text = (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 220);
      const back = qa('button, [role="button"]').find((el) => /返回/.test(txt(el)) || /返回/.test(el.getAttribute('aria-label') || ''));
      if (back) back.click();
      await until(() => Boolean(document.querySelector('.tl-device-screen')), 5000);
      return { found: true, opened, inputs, text };
    })()`);
    const seededUrl = `127.0.0.1:${A_PORT}`;
    const dirty = (addFlow.inputs || []).filter((i) => i.value && (i.value.includes(seededUrl) || i.value.includes('qa-token') || i.value.includes('qa-codex-token')));
    out.checks.addEntry = {
      pass: Boolean(addFlow.found && addFlow.opened) && dirty.length === 0,
      found: Boolean(addFlow.found), opened: Boolean(addFlow.opened),
      prefilledInputs: dirty, inputs: addFlow.inputs, text: addFlow.text,
      note: 'adding a second machine must not prefill the current one credentials',
    };
    const forgetFlow = await browser.eval(`(async () => {
      const more = document.querySelector('.tl-devcard-more');
      if (!more) return { found: false };
      more.click();
      const opened = await until(() => /忘记这台电脑/.test(document.body.innerText || ''), 4000);
      await wait(350);
      const text = (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 200);
      const forget = qa('button, [role="button"]').find((el) => /忘记这台电脑/.test(txt(el)));
      // cancel, never confirm: this must not touch the seeded registry
      const cancel = qa('button, [role="button"]').find((el) => /取消|保留|关闭/.test(txt(el)));
      if (cancel) cancel.click();
      await wait(250);
      return { found: true, opened, hasForget: Boolean(forget), text };
    })()`);
    out.checks.forgetEntry = {
      pass: Boolean(forgetFlow.found && forgetFlow.opened && forgetFlow.hasForget),
      found: Boolean(forgetFlow.found), opened: Boolean(forgetFlow.opened), hasForget: Boolean(forgetFlow.hasForget),
      text: forgetFlow.text, note: 'a paired machine must be removable from the device page',
    };
    out.checks.touchTargets = await measureTouchTargets();
  }
  // 7 — no horizontal overflow on this screen
  out.checks.noOverflow = { pass: switched.snap.overflow.scrollWidth <= WIDTH && switched.snap.overflow.innerWidth === WIDTH, ...switched.snap.overflow };
  out.summary = Object.fromEntries(Object.entries(out.checks).map(([k, v]) => [k, v.pass === null ? "N/A" : (v.pass ? "PASS" : "FAIL")]));
} catch (error) {
  out.error = String(error && error.stack || error);
} finally {
  try { if (browser) await browser.close(); } catch { /* ignore */ }
  try { fixture.kill(); } catch { /* ignore */ }
  try { proxyB.close(); } catch { /* ignore */ }
  try { preview.close(); } catch { /* ignore */ }
  const text = JSON.stringify(out, null, 2);
  console.log(text);
  if (JSON_OUT) {
    const file = path.resolve(REPO, JSON_OUT);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  const failed = Object.values(out.checks || {}).filter((c) => c && c.pass === false).length;
  const listFailed = Object.values(out.listSummary || {}).filter((v) => v === "FAIL").length;
  await sleep(150);
  process.exit(out.error || failed || listFailed ? 1 : 0);
}
