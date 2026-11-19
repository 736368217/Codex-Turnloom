#!/usr/bin/env node
/**
 * Screenshot driver for the single App line (`app/`).
 *
 * Chromium/Edge over the DevTools protocol only — no npm dependency, so the
 * evidence can be reproduced on a clean checkout:
 *
 *   node tools/qa/visual-fixture.mjs                                    # :7812
 *   npm run app:build; npx --prefix app vite preview --port 4173        # :4173
 *   node tools/qa/visual-capture.mjs --out docs/qa/visual/before
 *
 * The page under test is the real production bundle. The only injected script
 * is the Android `window.TurnloomNative` bridge (secure storage + native HTTP),
 * which a desktop browser does not have; its `request` implementation forwards
 * to the fixture origin with the same headers the native bridge sends.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const EDGE_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
];

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const OUT = path.resolve(arg("out", "docs/qa/visual/before"));
const BASE = arg("base", "http://127.0.0.1:4173");
const FIXTURE = arg("fixture", "http://127.0.0.1:7812");
const VIEWS = arg("views", "390x844:2").split(",").filter(Boolean);
const ONLY = arg("only", "").split(",").filter(Boolean);
const DUMP = arg("dump", "");
const EVAL_RAW = arg("eval", "");
const EVAL = EVAL_RAW.startsWith("@") ? readFileSync(EVAL_RAW.slice(1), "utf8") : EVAL_RAW;
const PORT = Number(arg("port", "9333"));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Injected native bridge (the only difference from a real Android WebView)
// ---------------------------------------------------------------------------
function bridgeSource({ seed, fixture, machineName }) {
  const machine = seed ? JSON.stringify({
    machineId: "qa-visual-machine",
    machineName,
    serverUrl: fixture,
    machineToken: "qa-machine-token",
    harnesses: [
      { id: "codex", name: "Codex Desktop", token: "qa-codex-token", kind: "codex", defaultHarness: true, online: true },
      { id: "pidesk", name: "PI-Desktop", token: "qa-pi-token", kind: "pi", defaultHarness: false, online: true },
    ],
    defaultHarnessId: "codex",
  }) : "";
  return `(() => {
  const store = new Map();
  const seedData = ${machine || "null"};
  const seed = seedData ? JSON.stringify(seedData) : "";
  if (seed) store.set("turnloom.machine.v2", seed);
  window.__qaSecureCalls = [];
  window.__qaBridgeAt = performance.now();
  window.TurnloomNative = {
    secureGet(key) {
      const value = store.has(key) ? store.get(key) : null;
      window.__qaSecureCalls.push([key, value ? value.slice(0, 24) : null, Math.round(performance.now())]);
      return value;
    },
    secureSet(key, value) { store.set(key, String(value)); return true; },
    secureRemove(key) { store.delete(key); return true; },
    haptic() {},
    setLightBars() {},
    scanQr() {},
    getAppInfo() {
      return JSON.stringify({
        label: "Codex-Turnloom", version: "2.1.7", versionCode: 83,
        packageName: "com.codex.turnloom.app",
        cameraAvailable: false, updatesAvailable: false,
      });
    },
    request(requestId, payloadJson) {
      let payload = {};
      try { payload = JSON.parse(payloadJson) || {}; } catch { payload = {}; }
      const init = { method: payload.method || "GET", headers: payload.headers || {} };
      if (typeof payload.body === "string") init.body = payload.body;
      fetch(payload.url, init)
        .then(async (response) => {
          const text = await response.text();
          window.__turnloomNativeHttpResult(requestId, JSON.stringify({ status: response.status, body: text }));
        })
        .catch((error) => {
          window.__turnloomNativeHttpResult(requestId, JSON.stringify({ status: 0, body: "", error: String((error && error.message) || "transport-error") }));
        });
    },
    cancelRequest() {},
  };
})();`;
}

// ---------------------------------------------------------------------------
// Minimal CDP client
// ---------------------------------------------------------------------------
class Cdp {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
  }
  async open() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(`${message.error.message} ${JSON.stringify(message.error.data || "")}`));
      else resolve(message.result);
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30_000);
    });
  }
  close() { try { this.ws.close(); } catch { /* already closed */ } }
}

async function waitForHttp(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch { /* browser not up yet */ }
    await sleep(150);
  }
  throw new Error(`browser endpoint never came up: ${url}`);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true, userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(`page error: ${result.exceptionDetails.text} ${result.exceptionDetails.exception?.description || ""}`);
  }
  return result.result?.value;
}

async function waitForSelector(cdp, selector, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await evaluate(cdp, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`);
    if (found) return true;
    await sleep(120);
  }
  throw new Error(`selector never appeared: ${selector}`);
}

async function click(cdp, selector) {
  await waitForSelector(cdp, selector);
  const clicked = await evaluate(cdp, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.scrollIntoView({block:'center'}); el.click(); return true; })()`);
  if (!clicked) throw new Error(`cannot click ${selector}`);
  await sleep(280);
}

async function waitForText(cdp, text, selector = "button", timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await evaluate(cdp, `(() => Array.from(document.querySelectorAll(${JSON.stringify(selector)})).some((node) => (node.textContent || "").includes(${JSON.stringify(text)})))()`);
    if (found) return true;
    await sleep(150);
  }
  throw new Error(`text never appeared: ${text}`);
}

async function clickText(cdp, text, selector = "button") {
  const clicked = await evaluate(cdp, `(() => {
    const nodes = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
    const el = nodes.find((node) => (node.textContent || "").includes(${JSON.stringify(text)}));
    if (!el) return false;
    el.scrollIntoView({block:'center'}); el.click(); return true;
  })()`);
  if (!clicked) throw new Error(`cannot click text: ${text}`);
  await sleep(320);
}

async function longPress(cdp, selector, holdMs = 700) {
  await waitForSelector(cdp, selector);
  const box = await evaluate(cdp, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  const base = { x: box.x, y: box.y, button: "left", clickCount: 1 };
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...base });
  await sleep(holdMs);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base });
  await sleep(400);
}

async function scrollTo(cdp, selector, top) {
  await evaluate(cdp, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.scrollTop = ${Number(top)}; return true; })()`);
  await sleep(320);
}

async function shot(cdp, file, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, Buffer.from(data, "base64"));
      console.log(`  + ${path.relative(process.cwd(), file)}`);
      return;
    } catch (error) {
      lastError = error;
      await sleep(1200);
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Scenarios — every screen the Task names, in IA order.
// ---------------------------------------------------------------------------
// Konsta renders the tab buttons with role="link", so address them by label.
const TAB = (label) => `.tl-tabbar [aria-label="${label}"]`;

// 2.2.2 IA: the landing screen IS the conversation list (`HomeScreen` is gone),
// the list is `.tl-thread-*` and the 按时间/按项目 switch is `.tl-filter-chip`.
const SCENARIOS = [
  { name: "landing", steps: [{ waitFor: ".tl-thread-filters" }, { wait: 1000 }] },
  {
    name: "threads-project",
    steps: [
      { click: TAB("会话") },
      { waitFor: ".tl-filter-chip" },
      { clickText: "按项目" },
      { waitFor: ".tl-group-head" },
      { wait: 700 },
    ],
  },
  {
    name: "threads-archive-confirm",
    steps: [
      { click: TAB("会话") },
      { waitFor: "button.tl-thread-row" },
      { wait: 700 },
      { longPress: "button.tl-thread-row" },
      { waitFor: ".tl-confirm-card" },
      { wait: 400 },
    ],
  },
  // The 401 banner only exists while the fixture answers 401 (`-Fail 401`).
  ...(process.env.QA_VISUAL_FAIL
    ? [{ name: "banner-401", steps: [{ waitFor: ".tl-conn-banner" }, { wait: 900 }] }]
    : []),
  { name: "monitors", steps: [{ click: TAB("监控") }, { wait: 700 }] },
  { name: "settings", steps: [{ click: TAB("设置") }, { wait: 700 }] },
  {
    name: "chat-markdown",
    steps: [
      { click: TAB("会话") },
      { waitForText: "视觉检定：长 Markdown" },
      { clickText: "视觉检定：长 Markdown" },
      { waitFor: ".tl-chat-list" },
      { wait: 900 },
    ],
  },
  {
    name: "chat-markdown-code",
    steps: [
      { click: TAB("会话") },
      { waitForText: "视觉检定：长 Markdown" },
      { clickText: "视觉检定：长 Markdown" },
      { waitFor: ".tl-chat-list" },
      { wait: 800 },
      { scroll: ".tl-detail-body", top: 340 },
    ],
  },
  {
    name: "chat-running",
    steps: [
      { click: TAB("会话") },
      { waitForText: "正在运行：把视觉检定跑完" },
      { clickText: "正在运行：把视觉检定跑完" },
      { waitFor: ".tl-chat-list" },
      { wait: 900 },
    ],
  },
  {
    name: "chat-approval",
    steps: [
      { click: TAB("会话") },
      { waitForText: "等待审批：删除构建产物的命令" },
      { clickText: "等待审批：删除构建产物的命令" },
      { waitFor: ".tl-chat-list" },
      { wait: 900 },
    ],
  },
  {
    // 2.2.2: "+" opens a blank conversation page, not a sheet.
    name: "chat-blank",
    steps: [
      { click: TAB("会话") },
      { click: '[aria-label="新建会话"]' },
      { waitFor: ".tl-chat-blank-orb" },
      { wait: 900 },
    ],
  },
  {
    name: "sheet-harness",
    steps: [{ click: TAB("设置") }, { waitForText: "切换电脑上的服务" }, { clickText: "切换电脑上的服务" }, { waitFor: "[data-vaul-drawer]" }, { wait: 800 }],
  },
  {
    name: "sheet-diagnostics",
    steps: [{ click: TAB("设置") }, { clickText: "运行信息" }, { waitFor: "[data-vaul-drawer]" }, { wait: 800 }],
  },
  {
    name: "sheet-model",
    steps: [
      { click: TAB("会话") },
      { waitForText: "视觉检定：长 Markdown" },
      { clickText: "视觉检定：长 Markdown" },
      { waitFor: ".tl-model-trigger" },
      { click: ".tl-model-trigger" },
      { waitFor: "[data-vaul-drawer]" },
      { wait: 800 },
    ],
  },
];

const CONNECT_SCENARIO = {
  name: "connect",
  seed: false,
  steps: [{ waitFor: ".tl-connect-header" }, { wait: 1500 }],
};

async function runScenario(cdp, scenario, view, outDir) {
  await cdp.send("Page.navigate", { url: "about:blank" });
  await sleep(150);
  const { identifier } = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: bridgeSource({
      seed: scenario.seed !== false,
      fixture: FIXTURE,
      machineName: "QA 工作站",
    }),
  });
  try {
    await cdp.send("Page.navigate", { url: BASE });
    await sleep(800);
    await evaluate(cdp, "window.__turnloomBack = () => false");
    for (const step of scenario.steps) {
      if (step.waitFor) await waitForSelector(cdp, step.waitFor);
      if (step.waitForText) await waitForText(cdp, step.waitForText, step.textSelector || "button");
      if (step.wait) await sleep(step.wait);
      if (step.click) await click(cdp, step.click);
      if (step.clickText) await clickText(cdp, step.clickText);
      if (step.longPress) await longPress(cdp, step.longPress);
      if (step.scroll) await scrollTo(cdp, step.scroll.selector, step.scroll.top);
      if (step.probe) {
        if (EVAL) console.log(JSON.stringify(await evaluate(cdp, EVAL), null, 2));
        if (DUMP) console.log(await evaluate(cdp, `(() => { const el = document.querySelector(${JSON.stringify(DUMP)}); return el ? el.outerHTML.slice(0, 4000) : "no-match"; })()`));
        return;
      }
    }
    await shot(cdp, path.join(outDir, `${view.replace(/[:]/g, "@")}-${scenario.name}.png`));
  } finally {
    await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier }).catch(() => {});
  }
}

async function main() {
  const edge = EDGE_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!edge) throw new Error("no Chromium/Edge binary found");
  const profile = path.join(os.tmpdir(), `tl-visual-${Date.now()}`);
  mkdirSync(profile, { recursive: true });
  const child = spawn(edge, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--disable-background-networking",
    "--force-color-profile=srgb", "--hide-scrollbars",
    "about:blank",
  ], { stdio: "ignore" });

  try {
    await waitForHttp(`http://127.0.0.1:${PORT}/json/version`);
    const scenarios = [...(ONLY.length ? SCENARIOS.filter((s) => ONLY.includes(s.name)) : SCENARIOS)];
    if (!ONLY.length || ONLY.includes("connect")) scenarios.push(CONNECT_SCENARIO);
    if (DUMP || EVAL) {
      const clickArg = arg("click", "");
      const clicks = clickArg.startsWith("@")
        ? readFileSync(clickArg.slice(1), "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
        : clickArg.split(",").filter(Boolean);
      scenarios.splice(0, scenarios.length, {
        name: "probe",
        steps: [
          { waitFor: ".tl-app" },
          { wait: 1200 },
          ...clicks.map((label) => label.startsWith("text=") ? ({ waitForText: label.slice(5) }) : ({ click: TAB(label) })),
          ...clicks.map((label) => label.startsWith("text=") ? ({ clickText: label.slice(5) }) : ({ wait: 600 })),
          { probe: true },
        ],
      });
    }
    for (const view of VIEWS) {
      const [width, height, scale = "2"] = view.split(":");
      const [w, h] = width.split("x").map(Number);
      const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
      const cdp = new Cdp(target.webSocketDebuggerUrl);
      await cdp.open();
      await cdp.send("Page.enable");
      await cdp.send("Runtime.enable");
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: w, height: h, deviceScaleFactor: Number(scale), mobile: true,
      });
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      console.log(`[${view}]`);
      for (const scenario of scenarios) {
        try {
          await runScenario(cdp, scenario, view, OUT);
        } catch (error) {
          console.error(`  ! ${view}-${scenario.name}: ${error.message}`);
        }
      }
      cdp.close();
      await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {});
    }
  } finally {
    child.kill();
    await sleep(400);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* windows lock */ }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
