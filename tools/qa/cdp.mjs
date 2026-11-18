/**
 * Minimal Chrome DevTools Protocol driver (no third-party dependency).
 *
 * Node 22+ ships a global WebSocket, so a headless Edge/Chrome can be driven
 * with nothing but the standard library. Used by tools/qa/capture.mjs.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const EDGE_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

export function findBrowser(explicit) {
  const candidates = explicit ? [explicit, ...EDGE_CANDIDATES] : EDGE_CANDIDATES;
  for (const candidate of candidates) {
    try { if (fs.existsSync(candidate)) return candidate; } catch { /* ignore */ }
  }
  throw new Error("No Chromium/Edge binary found; pass --browser <path>");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForJson(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    await sleep(120);
  }
  throw new Error(`CDP endpoint ${url} not ready: ${lastError?.message || "timeout"}`);
}

export class CDP {
  constructor({ browserPath, port = 9333, headless = true, width = 390, height = 844, scale = 3, args = [] } = {}) {
    this.browserPath = browserPath || findBrowser();
    this.port = port;
    this.width = width;
    this.height = height;
    this.scale = scale;
    this.headless = headless;
    this.args = args;
    this.proc = null;
    this.ws = null;
    this.seq = 0;
    this.pending = new Map();
    this.sessionId = null;
    this.events = new Map();
  }

  async launch() {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tl-qa-"));
    this.userDataDir = userDataDir;
    const args = [
      `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-sync",
      "--disable-gpu",
      "--hide-scrollbars",
      // The app talks to the QA server through the native HTTP bridge, which
      // is replaced by fetch() in the harness; that fetch is cross-origin.
      "--disable-web-security",
      "--disable-features=IsolateOrigins,site-per-process",
      ...(this.headless ? ["--headless=new"] : []),
      ...this.args,
      "about:blank",
    ];
    this.proc = spawn(this.browserPath, args, { stdio: "ignore", windowsHide: true });
    const version = await waitForJson(`http://127.0.0.1:${this.port}/json/version`);
    this.ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", () => reject(new Error("CDP socket error")), { once: true });
    });
    this.ws.addEventListener("message", (event) => this.#onMessage(event.data));
    const { targetId } = await this.send("Target.createTarget", { url: "about:blank" });
    const attached = await this.send("Target.attachToTarget", { targetId, flatten: true });
    this.sessionId = attached.sessionId;
    await this.send("Page.enable", {});
    await this.send("Runtime.enable", {});
    await this.send("Log.enable", {});
    await this.send("Network.enable", {});
    await this.setViewport(this.width, this.height, this.scale);
    return this;
  }

  #onMessage(raw) {
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject, method } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(`${method}: ${message.error.message}`));
      else resolve(message.result);
      return;
    }
    if (message.method) {
      const bucket = this.events.get(message.method);
      if (bucket) for (const listener of bucket) listener(message.params, message.sessionId);
    }
  }

  on(method, listener) {
    if (!this.events.has(method)) this.events.set(method, new Set());
    this.events.get(method).add(listener);
  }

  send(method, params = {}, sessionId = this.sessionId) {
    this.seq += 1;
    const id = this.seq;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${method}: timeout`));
        }
      }, 45_000).unref?.();
    });
  }

  async setViewport(width, height, scale = this.scale, { safeArea = null, mobile = true } = {}) {
    this.width = width; this.height = height; this.scale = scale;
    await this.send("Emulation.setDeviceMetricsOverride", {
      width, height, deviceScaleFactor: scale, mobile,
      screenOrientation: { type: "portraitPrimary", angle: 0 },
    });
    if (safeArea) {
      // Probe support once: iOS safe-area insets are 0 on a desktop browser.
      try {
        await this.send("Emulation.setSafeAreaInsetsOverride", { insets: safeArea });
      } catch {
        await this.send("Emulation.setSafeAreaInsetsOverride", {
          insets: { top: safeArea.top, topMax: safeArea.top, bottom: safeArea.bottom, bottomMax: safeArea.bottom, left: safeArea.left || 0, leftMax: safeArea.left || 0, right: safeArea.right || 0, rightMax: safeArea.right || 0 },
        }).catch(() => {});
      }
    }
  }

  async navigate(url) {
    const loaded = new Promise((resolve) => {
      const listener = () => { this.events.get("Page.loadEventFired")?.delete(listener); resolve(); };
      this.on("Page.loadEventFired", listener);
      setTimeout(resolve, 20_000);
    });
    await this.send("Page.navigate", { url });
    await loaded;
  }

  async eval(expression, { awaitPromise = true } = {}) {
    const result = await this.send("Runtime.evaluate", {
      expression, awaitPromise, returnByValue: true, userGesture: true,
      ...(awaitPromise ? { replMode: false } : {}),
    });
    if (result.exceptionDetails) {
      throw new Error(`eval failed: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
    }
    return result.result?.value;
  }

  async screenshot(filePath, { fullPage = false } = {}) {
    const params = { format: "png", captureBeyondViewport: fullPage, fromSurface: true };
    if (fullPage) {
      const metrics = await this.send("Page.getLayoutMetrics", {});
      const content = metrics.cssContentSize || metrics.contentSize;
      params.clip = { x: 0, y: 0, width: content.width, height: content.height, scale: 1 };
    }
    const { data } = await this.send("Page.captureScreenshot", params);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(data, "base64"));
    return filePath;
  }

  /** Wipe one origin's web storage without racing the app's own writes. */
  async clearStorage(origin) {
    try {
      await this.send("Storage.clearDataForOrigin", { origin, storageTypes: "local_storage,session_storage,indexeddb" });
    } catch {
      await this.send("Runtime.evaluate", { expression: "(() => { try { localStorage.clear(); } catch (e) {} })()" });
    }
  }

  async waitFor(selector, { timeoutMs = 12_000, visible = true } = {}) {    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = await this.eval(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        if (!${visible}) return true;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })()`);
      if (found) return true;
      await sleep(100);
    }
    throw new Error(`selector not found: ${selector}`);
  }

  async waitForText(text, { timeoutMs = 12_000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.eval(`document.body.innerText.includes(${JSON.stringify(text)})`)) return true;
      await sleep(100);
    }
    throw new Error(`text not found: ${text}`);
  }

  async click(selector) {
    const ok = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'missing';
      el.scrollIntoView({ block: 'center' });
      el.click();
      return 'clicked';
    })()`);
    if (ok !== "clicked") throw new Error(`click target ${ok}: ${selector}`);
    await sleep(180);
  }

  async fill(selector, value) {
    const ok = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'missing';
      const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`);
    if (ok !== "ok") throw new Error(`fill target ${ok}: ${selector}`);
    await sleep(80);
  }

  async close() {
    try { await this.send("Browser.close", {}, null); } catch { /* ignore */ }
    try { this.ws?.close(); } catch { /* ignore */ }
    try { this.proc?.kill(); } catch { /* ignore */ }
    await sleep(300);
    try { fs.rmSync(this.userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
