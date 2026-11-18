#!/usr/bin/env node
/**
 * Mobile E2E capture + measurement harness for app/ (Option A delivery line).
 *
 *   node tools/qa/capture.mjs                       # full 390×844 pass
 *   node tools/qa/capture.mjs --viewports 390x844,360x800,320x568
 *   node tools/qa/capture.mjs --only chat,sheets --out docs/qa/visual/after
 *   node tools/qa/capture.mjs --no-stack            # reuse a running stack
 *
 * The harness starts the real server.js against a deterministic HTTP backend
 * (tools/qa/fixture-backend.mjs), a discovery shim (tools/qa/pairing-proxy.mjs)
 * and `vite preview`, then drives headless Edge over CDP with the native bridge
 * replaced by fetch(). The app itself is untouched: everything it renders comes
 * from real /api/* responses.
 */
import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { CDP, findBrowser } from "./cdp.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../..");
const argv = process.argv.slice(2);
const flag = (name, fallback = "") => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const OUT_DIR = path.resolve(ROOT, flag("out", "docs/qa/visual/before"));
const VIEWPORTS = flag("viewports", "390x844").split(",").map((row) => {
  const [w, h] = row.split("x").map(Number);
  return { width: w, height: h, label: `${w}x${h}` };
});
const ONLY = flag("only", "").split(",").filter(Boolean);
const USE_STACK = !has("no-stack");
const PREVIEW_PORT = Number(flag("preview-port", "0")) || 0;
const SERVER_PORT = Number(flag("server-port", "0")) || 0;
const PROXY_PORT = Number(flag("proxy-port", "0")) || 0;
const FIXTURE_PORT = Number(flag("fixture-port", "0")) || 0;
const ACCESS_CODE = flag("access-code", "qa-code");
const SETTLE = Number(flag("settle", "420"));
const PORTS = { fixture: 0, server: 0, proxy: 0, preview: 0 };
const SAFE_AREA = { top: 47, bottom: 34, left: 0, right: 0 };

const children = [];
const log = (...parts) => console.log("[capture]", ...parts);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHttp(url, { timeoutMs = 25_000, headers = {} } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers });
      if (response.status < 500) return response;
      last = `HTTP ${response.status}`;
    } catch (error) { last = error.message; }
    await sleep(200);
  }
  throw new Error(`not ready: ${url} (${last})`);
}

function startProcess(name, command, args, { cwd = ROOT, env = {} } = {}) {
  const logFile = path.join(OUT_DIR, "stack.log");
  const out = fs.openSync(logFile, "a");
  const child = spawn(command, args, { cwd, stdio: ["ignore", out, out], windowsHide: true, env: { ...process.env, ...env } });
  child.on("exit", (code) => { if (code && code !== 0) log(`${name} exited (${code}) — see ${path.relative(ROOT, logFile)}`); });
  child.on("error", (error) => log(`${name} spawn error: ${error.message}`));
  children.push({ name, child });
  return child;
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

async function startStack() {
  const node = process.execPath;
  // 端口必须两两不同：刚关闭的探针端口会被系统立刻复用，
  // 一旦 proxy 与 server 撞号，proxy 会 bind 失败并静默退出。
  const used = new Set();
  const take = async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const port = await freePort();
      if (!used.has(port)) { used.add(port); return port; }
    }
    throw new Error("could not allocate distinct ports");
  };
  const ports = {
    fixture: FIXTURE_PORT || await take(),
    server: SERVER_PORT || await take(),
    proxy: PROXY_PORT || await take(),
    preview: PREVIEW_PORT || await take(),
  };
  Object.assign(PORTS, ports);
  // D1（--backend http 时 /api/harnesses 被转发层吃掉 → 501）已由 server.js 修复，
  // 默认直连 server；--proxy 只用于对照旧行为。
  PORTS.pairBase = has("proxy") ? ports.proxy : ports.server;
  startProcess("fixture", node, [path.join(ROOT, "tools/qa/fixture-backend.mjs")], { env: { QA_FIXTURE_PORT: String(ports.fixture) } });
  await waitForHttp(`http://127.0.0.1:${ports.fixture}/threads`);
  startProcess("server", node, [
    path.join(ROOT, "server.js"),
    "--port", String(ports.server),
    "--password", ACCESS_CODE,
    "--machine-token", ACCESS_CODE,
    "--backend", "http",
    "--backend-url", `http://127.0.0.1:${ports.fixture}`,
    "--machine-id", "qa-machine",
    "--machine-name", "QA 桌面",
  ]);
  await waitForHttp(`http://127.0.0.1:${ports.server}/api/health`, { headers: { "x-access-token": ACCESS_CODE } });
  if (has("proxy")) {
    startProcess("proxy", node, [path.join(ROOT, "tools/qa/pairing-proxy.mjs")], {
      env: { QA_PROXY_PORT: String(ports.proxy), QA_SERVER_URL: `http://127.0.0.1:${ports.server}`, QA_ACCESS_CODE: ACCESS_CODE },
    });
    await waitForHttp(`http://127.0.0.1:${ports.proxy}/api/harnesses`, { headers: { "x-access-token": ACCESS_CODE } });
  }
  startProcess("preview", node, [path.join(ROOT, "app/node_modules/vite/bin/vite.js"), "preview", "--port", String(ports.preview), "--strictPort", "--host", "127.0.0.1"], { cwd: path.join(ROOT, "app") });
  await waitForHttp(`http://127.0.0.1:${ports.preview}/`);
  log(`stack: preview ${ports.preview} · server ${ports.server} · pairing ${PORTS.pairBase} · fixture ${ports.fixture}`);
}

function stopStack() {
  for (const { child } of children) {
    try { child.kill(); } catch { /* ignore */ }
  }
}

const BRIDGE_SHIM = `(() => {
  // QA_BRIDGE_SEND_FAIL=network|timeout answers /api/send at the native boundary.
  // This is what Android delivers when the socket dies or the read timer fires;
  // the server.js -> fixture path cannot produce it (server.js would return 502).
  const QA_BRIDGE_SEND_FAIL = ${JSON.stringify(String(process.env.QA_BRIDGE_SEND_FAIL || "").trim())};
  const store = {
    get: (k) => { try { return localStorage.getItem('tlqa::' + k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem('tlqa::' + k, v); return true; } catch { return false; } },
    del: (k) => { try { localStorage.removeItem('tlqa::' + k); return true; } catch { return false; } },
  };
  const inFlight = new Map();
  window.__TLQA = { requests: [] };
  window.TurnloomNative = {
    request(requestId, payloadJson) {
      let payload = {};
      try { payload = JSON.parse(payloadJson); } catch {}
      if (QA_BRIDGE_SEND_FAIL && String(payload.url || '').endsWith('/api/send')) {
        window.__TLQA.requests.push({ requestId, url: payload.url, method: payload.method, status: 0, error: QA_BRIDGE_SEND_FAIL });
        setTimeout(() => window.__turnloomNativeHttpResult?.(requestId, JSON.stringify({ status: 0, body: '', error: QA_BRIDGE_SEND_FAIL })), 30);
        return;
      }
      const controller = new AbortController();
      inFlight.set(requestId, controller);
      const started = performance.now();
      window.__TLQA.requests.push({ requestId, url: payload.url, method: payload.method, at: Date.now() });
      fetch(payload.url, {
        method: payload.method || 'GET',
        headers: payload.headers || {},
        body: payload.body,
        signal: controller.signal,
        cache: 'no-store',
      }).then(async (response) => {
        const body = await response.text();
        window.__TLQA.requests.push({ requestId, url: payload.url, status: response.status, ms: Math.round(performance.now() - started), bodyBytes: body.length });
        window.__turnloomNativeHttpResult?.(requestId, JSON.stringify({ status: response.status, body }));
      }).catch((error) => {
        window.__TLQA.requests.push({ requestId, url: payload.url, status: 0, error: String(error && error.message || error) });
        window.__turnloomNativeHttpResult?.(requestId, JSON.stringify({ status: 0, body: '', error: String(error && error.message || 'transport-error') }));
      }).finally(() => inFlight.delete(requestId));
    },
    cancelRequest(requestId) {
      const controller = inFlight.get(requestId);
      if (controller) { try { controller.abort(); } catch {} }
      inFlight.delete(requestId);
    },
    secureGet: (k) => store.get(k),
    secureSet: (k, v) => store.set(k, v),
    secureRemove: (k) => store.del(k),
    getAppInfo: () => JSON.stringify({ label: 'Turnloom QA', version: '2.1.7', versionCode: 2010700, packageName: 'dev.turnloom.qa', cameraAvailable: false, updatesAvailable: false }),
    haptic: () => {},
    setLightBars: () => {},
    openExternalUrl: () => true,
    downloadUpdate: () => {},
    cancelUpdate: () => {},
    installUpdate: () => {},
    pickAttachments: () => 'unavailable',
    cancelAttachmentPick: () => {},
  };
})();`;

const MEASURE = `(() => {
  const visible = (el) => {
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const doc = document.scrollingElement || document.documentElement;
  const vw = window.innerWidth;
  const offenders = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.right > vw + 0.5 || rect.left < -0.5) {
      const scrollable = el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX);
      if (scrollable) continue;
      offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className || '').toString().slice(0, 60),
        left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width),
        text: (el.textContent || '').trim().slice(0, 40),
      });
    }
  }
  const smallTargets = [];
  for (const el of document.querySelectorAll('button, [role="tab"], [role="button"], input, a[href], summary')) {
    if (!visible(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.height < 44 || rect.width < 44) {
      smallTargets.push({
        tag: el.tagName.toLowerCase(),
        label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30),
        w: Math.round(rect.width), h: Math.round(rect.height),
        cls: String(el.className || '').toString().slice(0, 40),
      });
    }
  }
  const bar = document.querySelector('.tl-tabbar');
  const barRect = bar ? bar.getBoundingClientRect() : null;
  const composer = document.querySelector('.tl-composer');
  const composerRect = composer ? composer.getBoundingClientRect() : null;
  return {
    title: document.title,
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
    docScrollWidth: doc.scrollWidth,
    horizontalOverflow: doc.scrollWidth > vw + 0.5,
    offenders: offenders.slice(0, 12),
    smallTargets: smallTargets.slice(0, 20),
    tabbar: barRect ? { top: Math.round(barRect.top), bottom: Math.round(barRect.bottom), height: Math.round(barRect.height) } : null,
    composer: composerRect ? { top: Math.round(composerRect.top), bottom: Math.round(composerRect.bottom) } : null,
    text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 400),
  };
})()`;

async function clickSelector(page, selector, { optional = false } = {}) {
  const result = await page.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return 'missing';
    el.scrollIntoView({ block: 'center' });
    el.click();
    return 'ok';
  })()`);
  if (result !== "ok" && !optional) throw new Error(`click failed (${result}): ${selector}`);
  await sleep(SETTLE);
  return result === "ok";
}

async function clickText(page, text, { selector = "button, [role='tab'], [role='option'], .tl-chat-row, .tl-group-head, div", optional = false } = {}) {
  const result = await page.eval(`(() => {
    const needle = ${JSON.stringify(text)};
    const nodes = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
    const matches = nodes.filter((el) => (el.textContent || '').includes(needle));
    // Prefer the innermost match: the row that directly holds the title text.
    const match = matches.find((el) => !matches.some((other) => other !== el && el.contains(other))) || matches[0];
    if (!match) return 'missing';
    match.scrollIntoView({ block: 'center' });
    match.click();
    return 'ok';
  })()`);
  if (result !== "ok" && !optional) throw new Error(`clickText failed (${result}): ${text}`);
  await sleep(SETTLE);
  return result === "ok";
}

/** Project groups start collapsed; older builds needed two taps to open one. */
async function ensureThreadsOpen(page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const hasRows = await page.eval("Boolean(document.querySelector('.tl-group .tl-card button'))");
    if (hasRows) return true;
    const toggled = await clickSelector(page, ".tl-group-head", { optional: true });
    if (!toggled) return false;
    await sleep(300);
  }
  return false;
}

async function shot(page, dir, name, report, { measure = true } = {}) {  const file = path.join(dir, `${name}.png`);
  await page.screenshot(file);
  const facts = measure ? await page.eval(MEASURE) : null;
  report.screens.push({ name, viewport: dir.split(path.sep).slice(-1)[0], file: path.relative(ROOT, file).replace(/\\/g, "/"), facts });
  if (facts) {
    log(`${name}: ${facts.horizontalOverflow ? `OVERFLOW ${facts.docScrollWidth}>${facts.viewport.w}` : "ok"} · smallTargets=${facts.smallTargets.length} · offenders=${facts.offenders.length}`);
  } else {
    log(`${name}: saved`);
  }
  return facts;
}

const selected = (group) => !ONLY.length || ONLY.includes(group);

async function runViewport(browser, viewport, report) {
  const { width, height, label } = viewport;
  const dir = path.join(OUT_DIR, label);
  fs.mkdirSync(dir, { recursive: true });
  const page = browser;
  void dir;
  await page.setViewport(width, height, 3, { safeArea: SAFE_AREA });
  const base = `http://127.0.0.1:${PORTS.preview}/`;

  // --- pairing -------------------------------------------------------------
  await page.clearStorage(`http://127.0.0.1:${PORTS.preview}`);
  await page.navigate(base);
  await page.waitFor("#connection-url");
  if (selected("connect")) {
    await shot(page, dir, "01-connect", report);
    await page.eval("document.querySelector('#connection-url').scrollIntoView({block:'center'})");
    await shot(page, dir, "01b-connect-manual", report);
  }
  await page.fill("#connection-url", `http://127.0.0.1:${PORTS.pairBase}`);
  await page.fill("#connection-code", ACCESS_CODE);
  await clickSelector(page, ".tl-connect-submit");
  let paired = false;
  for (let attempt = 1; attempt <= 3 && !paired; attempt += 1) {
    try {
      await page.waitFor(".tl-tabbar", { timeoutMs: 20_000 });
      paired = true;
    } catch (error) {
      const debug = await page.eval(`(() => ({
        text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 200),
        requests: (window.__TLQA && window.__TLQA.requests || []).slice(-6),
      }))()`);
      log(`pairing attempt ${attempt} failed:`, JSON.stringify(debug));
      if (attempt === 3) throw error;
      await page.navigate(base);
      await page.waitFor("#connection-url");
      await page.fill("#connection-url", `http://127.0.0.1:${PORTS.pairBase}`);
      await page.fill("#connection-code", ACCESS_CODE);
      await clickSelector(page, ".tl-connect-submit");
    }
  }
  await sleep(900);

  if (selected("connect")) {
    await page.navigate(base);
    await page.waitFor(".tl-tabbar", { timeoutMs: 20_000 });
    await sleep(700);
    await shot(page, dir, "02-cold-start", report);
  }

  if (has("dump")) { log(await page.eval(`document.querySelector(".tl-tabbar")?.outerHTML.slice(0, 1200)`)); }
  // --- home ---------------------------------------------------------------
  if (selected("home")) {
    await shot(page, dir, "03-home", report);
  }

  // --- threads ------------------------------------------------------------
  if (selected("threads")) {
    await clickSelector(page, "button[aria-label='会话']");
    await sleep(600);
    await shot(page, dir, "04-threads-default", report);
    await clickSelector(page, ".tl-group-head", { optional: true });
    await shot(page, dir, "05-threads-after-one-tap", report);
    if (!(await page.eval("Boolean(document.querySelectorAll('.tl-thread-list, .tl-card button').length)"))) {
      await clickSelector(page, ".tl-group-head", { optional: true });
      await shot(page, dir, "05b-threads-after-two-taps", report);
    }
    await page.eval("document.querySelector('.tl-screen')?.scrollTo(0, 600)");
    await sleep(300);
    await shot(page, dir, "06-threads-scrolled", report);
  }

  // --- chat detail --------------------------------------------------------
  if (selected("chat")) {
    await page.eval("window.scrollTo(0,0)");
    await clickSelector(page, "button[aria-label='会话']", { optional: true });
    await sleep(400);
    await ensureThreadsOpen(page);
    await clickText(page, "长 Markdown", { selector: "button" });
    await sleep(1200);
    await shot(page, dir, "07-chat-long-top", report);
    await page.eval(`(() => { const body = document.querySelector('.tl-detail-body'); if (body) body.scrollTop = body.scrollHeight; })()`);
    await sleep(500);
    await shot(page, dir, "08-chat-long-bottom", report);
    await page.eval(`(() => { const body = document.querySelector('.tl-detail-body'); const code = document.querySelector('.tl-markdown pre'); if (body && code) body.scrollTop = code.offsetTop - 80; })()`);
    await sleep(400);
    await shot(page, dir, "09-chat-code", report);
    const codeOverflow = await page.eval(`(() => {
      const pre = document.querySelector('.tl-markdown pre');
      if (!pre) return null;
      const rect = pre.getBoundingClientRect();
      return { clientWidth: pre.clientWidth, scrollWidth: pre.scrollWidth, right: Math.round(rect.right), viewport: window.innerWidth, scrollable: pre.scrollWidth > pre.clientWidth + 1 };
    })()`);
    report.codeBlock = codeOverflow;
    log(`code block: ${JSON.stringify(codeOverflow)}`);

    // Model & effort sheet from the composer.
    if (selected("sheets")) {
      await clickSelector(page, ".tl-model-trigger", { optional: true });
      await sleep(700);
      await shot(page, dir, "10-model-sheet", report);
      await page.eval("window.__turnloomBack ? window.__turnloomBack() : null");
      await sleep(500);
    }

    // Typing + send. The fixture records the exact body, so the report proves
    // whether a plain send carried `model` (it must not).
    if (selected("compose")) {
      await page.fill("textarea.tl-composer-input", "这是一条用于验证输入舱的测试消息");
      await sleep(400);
      await shot(page, dir, "11-composer-typing", report);
      await clickSelector(page, "button[aria-label='发送']", { optional: true });
      if (process.env.QA_SEND_FAIL || process.env.QA_BRIDGE_SEND_FAIL) {
        // 2.2.1: the failure must render as text the user can read, keep the
        // draft, and never be replaced by a bare status code.
        await page.waitFor(".tl-composer-error", { timeoutMs: 40_000 });
        report.sendError = await page.eval(`(() => {
          const el = document.querySelector('.tl-composer-error');
          if (!el) return null;
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          const input = document.querySelector('textarea.tl-composer-input');
          return {
            text: (el.textContent || '').trim(),
            role: el.getAttribute('role') || '',
            height: Math.round(rect.height),
            lines: Math.round(rect.height / (parseFloat(style.lineHeight) || 18)),
            horizontalOverflow: el.scrollWidth > el.clientWidth + 1,
            overflowWrap: style.overflowWrap,
            draftKept: Boolean(input && String(input.value || '').trim()),
          };
        })()`);
        log(`send error: ${JSON.stringify(report.sendError)}`);
        await shot(page, dir, "11b-send-error", report);
      }
      await sleep(process.env.QA_SEND_FAIL ? 800 : 1200);
      report.sends = await (await fetch(`http://127.0.0.1:${PORTS.fixture}/__qa/sends`)).json();
      log(`send bodies: ${JSON.stringify(report.sends)}`);
      await page.eval(`(() => { const el = document.querySelector('textarea.tl-composer-input'); if (!el) return; const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set; setter.call(el,''); el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    }

    // Back to list, then running thread.
    await page.eval("window.__turnloomBack && window.__turnloomBack()");
    await sleep(500);
    await ensureThreadsOpen(page);
    await sleep(600);
    await clickText(page, "正在运行", { selector: "button" });
    await sleep(1200);
    await shot(page, dir, "12-chat-running", report);
    await page.eval("window.__turnloomBack && window.__turnloomBack()");
    await sleep(500);
    await ensureThreadsOpen(page);

    // Approval thread.
    await clickText(page, "等待审批", { selector: "button" });
    await sleep(1400);
    await shot(page, dir, "13-chat-approval", report);
    await clickSelector(page, ".tl-approval-approve", { optional: true });
    await sleep(1600);
    await shot(page, dir, "14-chat-approval-done", report);
    report.approvals = await (await fetch(`http://127.0.0.1:${PORTS.fixture}/__qa/approvals`)).json();
    await page.eval("window.__turnloomBack && window.__turnloomBack()");
    await sleep(500);

    // Approval whose details are missing: buttons must stay disabled.
    await ensureThreadsOpen(page);
    const openedMismatch = await clickText(page, "审批详情缺失", { selector: "button", optional: true });
    report.mismatchOpened = openedMismatch;
    await sleep(1200);
    report.mismatch = await page.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('.tl-approval-actions button'));
      return { disabled: buttons.map((b) => b.disabled), note: document.querySelector('.tl-approval-error')?.textContent || '' };
    })()`);
    await shot(page, dir, "15-chat-approval-disabled", report);
    await page.eval("window.__turnloomBack && window.__turnloomBack()");
    await sleep(400);
  }

  // --- monitors -----------------------------------------------------------
  if (selected("monitors")) {
    await clickSelector(page, "button[aria-label='监控']");
    await sleep(700);
    await shot(page, dir, "16-monitors", report);
  }

  // --- settings -----------------------------------------------------------
  if (selected("settings")) {
    await clickSelector(page, "button[aria-label='设置']");
    await sleep(700);
    await shot(page, dir, "17-settings", report);
  }

  // --- sheets -------------------------------------------------------------
  if (selected("sheets")) {
    await clickSelector(page, "button[aria-label='会话']");
    await sleep(500);
    await clickSelector(page, "button[aria-label='新建任务']", { optional: true });
    await sleep(800);
    await shot(page, dir, "18-new-task-sheet", report);
    await page.eval("window.__turnloomBack && window.__turnloomBack()");
    await sleep(500);
    await clickSelector(page, "button[aria-label='监控']");
    await sleep(600);
    await clickText(page, "查看失败任务", { selector: "button", optional: true });
    await sleep(700);
    await shot(page, dir, "19-diagnostics-sheet", report);
    await page.eval("window.__turnloomBack && window.__turnloomBack()");
    await sleep(400);
  }

  // --- 401: host rotated the access code (D2 regression) -------------------
  if (selected("auth401")) {
    // 把已保存的机器/服务令牌换成一个已失效的值，再冷启动：真实的 401 路径。
    const rewritten = await page.eval(`(() => {
      const key = 'tlqa::turnloom.machine.v2';
      const raw = localStorage.getItem(key);
      if (!raw) return 'no-session';
      const value = JSON.parse(raw);
      value.machineToken = 'revoked-token';
      value.harnesses = (value.harnesses || []).map((h) => ({ ...h, token: 'revoked-token' }));
      localStorage.setItem(key, JSON.stringify(value));
      return 'rewritten';
    })()`);
    await page.navigate(`http://127.0.0.1:${PORTS.preview}/`);
    await sleep(2500);
    const banner = await page.eval(`(() => {
      const node = document.querySelector('.tl-conn-banner');
      return { text: (node?.innerText || '').replace(/\\s+/g, ' ').trim(), status: Boolean(node) };
    })()`);
    report.auth401 = { rewritten, ...banner };
    log(`401 banner: ${JSON.stringify(banner)}`);
    await shot(page, dir, "21-401-banner", report);
  }

  // --- keyboard / viewport shrink ----------------------------------------
  if (selected("keyboard")) {
    await page.setViewport(width, Math.round(height * 0.55), 3, { safeArea: SAFE_AREA });
    await clickSelector(page, "button[aria-label='会话']");
    await sleep(300);
    await ensureThreadsOpen(page);
    await clickText(page, "长 Markdown", { selector: "button", optional: true });
    await sleep(900);
    await shot(page, dir, "20-chat-keyboard", report);
    report.keyboard = await page.eval(`(() => {
      const card = document.querySelector('.tl-composer-card');
      const rect = card ? card.getBoundingClientRect() : null;
      return { viewportHeight: window.innerHeight, composerTop: rect ? Math.round(rect.top) : null, composerBottom: rect ? Math.round(rect.bottom) : null, visible: rect ? rect.bottom <= window.innerHeight + 0.5 && rect.top >= 0 : null };
    })()`);
    await page.setViewport(width, height, 3, { safeArea: SAFE_AREA });
    await sleep(300);
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const report = { generatedAt: new Date().toISOString(), outDir: path.relative(ROOT, OUT_DIR).replace(/\\/g, "/"), viewports: VIEWPORTS.map((v) => v.label), screens: [] };
  const browserPath = flag("browser", "") || findBrowser();
  log(`browser: ${browserPath}`);
  if (USE_STACK) await startStack();
  const page = await new CDP({ browserPath, port: Number(flag("cdp-port", "9333")), width: VIEWPORTS[0].width, height: VIEWPORTS[0].height }).launch();
  try {
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: BRIDGE_SHIM });
    for (const viewport of VIEWPORTS) {
      log(`--- ${viewport.label} ---`);
      await runViewport(page, viewport, report);
    }
    report.requests = await page.eval("window.__TLQA ? window.__TLQA.requests.slice(-40) : []");
  } finally {
    const reportFile = path.join(OUT_DIR, "report.json");
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    log(`report: ${path.relative(ROOT, reportFile)}`);
    await page.close();
    if (USE_STACK) stopStack();
  }
}

main().catch(async (error) => {
  console.error("[capture] failed:", error.message);
  if (USE_STACK) stopStack();
  process.exit(1);
});
