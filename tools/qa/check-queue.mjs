#!/usr/bin/env node
/**
 * 2.3.0 queue acceptance — real App bundle × deterministic queue fixture.
 *
 * What this proves:
 *   - the running composer really queues (mode:"queue") instead of blocking;
 *   - the queue bar / drawer / item panel exist, are reachable and readable;
 *   - take-back-edit, reorder, move-to-top, steer, delete, retry, pause/resume
 *     each hit their real endpoint and the UI follows the response;
 *   - failure paths keep the draft and say the message is still queued;
 *   - 390×844 / 390×640 (keyboard) / 320×568: no horizontal overflow, 44px hit
 *     targets, stop stays right of send, the queue bar sits above the composer.
 *
 * The App is the production bundle; the only injected script is the Android
 * native bridge (secure storage + native HTTP + attachment picker). The queue
 * server is `tools/qa/queue-fixture.mjs` (contract fixture), NOT real server.js:
 * server.js queue behaviour is verified separately by check-queue-api.mjs.
 *
 * Usage:
 *   node tools/qa/check-queue.mjs --build
 *   node tools/qa/check-queue.mjs --views 390x844,320x568 --only composer,sheet
 *   node tools/qa/check-queue.mjs --build --json tmp/queue-report.json
 *
 * Exit code 1 when any criterion fails.
 */
import { spawn, spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { CDP } from "./cdp.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const argOf = (name, fallback = "") => {
  const key = String(name).startsWith("--") ? String(name) : `--${name}`;
  const index = argv.indexOf(key);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const has = (name) => argv.includes(String(name).startsWith("--") ? String(name) : `--${name}`);
const DIST = path.resolve(REPO, argOf("--dist", "tmp/dist-vera-queue"));
const VIEWS = argOf("--views", "390x844,390x640,320x568").split(",").filter(Boolean);
const ONLY = argOf("--only", "").split(",").filter(Boolean);
if (has("print-args")) console.log("[queue] argv", JSON.stringify(argv), "views", JSON.stringify(VIEWS), "only", JSON.stringify(ONLY));
const OUT = path.resolve(REPO, argOf("--out", "docs/qa/queue"));
const JSON_OUT = argOf("--json", "");
const PORT = Number(argOf("--port", "0")) || 0;
let FIXTURE_PORT = Number(argOf("--fixture-port", "0")) || 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPEG_2PX = "/9j/4AAQSkZJRgABAQEAeAB4AAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD50ooor8MP9Uz/2Q==";

const results = [];
let currentView = "";
function check(id, pass, detail = "") {
  results.push({ view: currentView, id, pass: Boolean(pass), detail });
  const mark = pass ? "PASS" : "FAIL";
  console.log(`  [${mark}] ${id}${detail ? ` — ${detail}` : ""}`);
}
const ok = (id, detail) => check(id, true, detail);
const fail = (id, detail) => check(id, false, detail);

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

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

function startStatic(root) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      let filePath = path.join(root, decodeURIComponent(url.pathname));
      if (url.pathname === "/" || url.pathname.endsWith("/")) filePath = path.join(filePath, "index.html");
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(path.resolve(root))) {
        res.writeHead(403); res.end("forbidden"); return;
      }
      fs.readFile(resolved, (error, bytes) => {
        if (error) {
          // SPA fallback: the App owns its own routes.
          if (!path.extname(resolved)) {
            fs.readFile(path.join(root, "index.html"), (fallbackError, indexBytes) => {
              if (fallbackError) { res.writeHead(404); res.end("not found"); return; }
              res.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-store" });
              res.end(indexBytes);
            });
            return;
          }
          res.writeHead(404); res.end("not found");
          return;
        }
        res.writeHead(200, { "content-type": MIME[path.extname(resolved).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" });
        res.end(bytes);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
    server.on("error", reject);
  });
}

async function waitForHttp(url, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return response;
    } catch { /* not ready */ }
    await sleep(150);
  }
  throw new Error(`not ready: ${url}`);
}

async function fixture(action, body = {}) {
  const response = await fetch(`http://127.0.0.1:${FIXTURE_PORT}/__qa/control`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  });
  return response.json();
}
async function fixtureState() {
  const response = await fetch(`http://127.0.0.1:${FIXTURE_PORT}/__qa/state`);
  return response.json();
}
async function fixtureRequests() {
  const response = await fetch(`http://127.0.0.1:${FIXTURE_PORT}/__qa/requests`);
  return (await response.json()).requests || [];
}

// ---------------------------------------------------------------------------
// Injected native bridge + in-page QA helpers
// ---------------------------------------------------------------------------
function seedSource(appPort, fixturePort) {
  const registry = {
    version: 3,
    activeMachineId: "qa-queue-machine",
    machines: [{
      machineId: "qa-queue-machine",
      machineName: "QA 队列工作站",
      serverUrl: `http://127.0.0.1:${fixturePort}`,
      machineToken: "qa-machine-token",
      harnesses: [{ id: "codex", name: "Codex Desktop", token: "qa-codex-token", kind: "codex", online: true, defaultHarness: true }],
      defaultHarnessId: "codex",
      lastUsedAt: Date.now() - 60_000,
    }],
  };
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  return `(() => {
  const PREFIX = 'tlq.';
  const store = {
    get: (k) => { try { return localStorage.getItem(PREFIX + k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(PREFIX + k, String(v)); return true; } catch (e) { return false; } },
    del: (k) => { try { localStorage.removeItem(PREFIX + k); return true; } catch (e) { return false; } },
  };
  const toBase64 = (buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  };
  window.__qaCalls = [];
  window.TurnloomNative = {
    secureGet: store.get,
    secureSet: store.set,
    secureRemove: store.del,
    haptic: () => {},
    scanQr: () => {},
    setLightBars: () => {},
    getAppInfo: () => JSON.stringify({ label: 'Codex-Turnloom', version: '2.3.0', versionCode: 98, packageName: 'com.codex.turnloom.app', cameraAvailable: true, updatesAvailable: false }),
    // 2.3.0 native contract: image bodies come back as bodyBase64, text as body.
    request: (requestId, requestJson) => {
      let payload = {};
      try { payload = JSON.parse(requestJson) || {}; } catch (e) {}
      window.__qaCalls.push({ url: payload.url || '', method: payload.method || 'GET', at: Date.now() });
      const done = (result) => { try { window.__turnloomNativeHttpResult(requestId, JSON.stringify(result)); } catch (e) {} };
      fetch(payload.url, { method: payload.method || 'GET', headers: payload.headers || {}, ...(payload.body ? { body: payload.body } : {}) })
        .then(async (response) => {
          const type = String(response.headers.get('content-type') || '');
          if (/^image\\//i.test(type)) {
            const bodyBase64 = toBase64(await response.arrayBuffer());
            done({ status: response.status, body: '', bodyBase64 });
            return;
          }
          done({ status: response.status, body: await response.text() });
        })
        .catch((error) => done({ status: 0, body: '', error: String((error && error.message) || 'transport-error') }));
    },
    cancelRequest: () => {},
    pickAttachments: (requestId, kind) => {
      const isFile = kind === 'file';
      const dataUrl = isFile ? 'data:text/plain;base64,5rWL6K+V6ZmE5Lu25paH5Lu2Cg==' : 'data:image/png;base64,${png}';
      const item = {
        name: isFile ? 'qa-notes.txt' : 'qa-photo.png',
        mimeType: isFile ? 'text/plain' : 'image/png',
        sizeBytes: isFile ? 22 : 68,
        dataUrl,
      };
      setTimeout(() => { try { window.__turnloomNativeAttachmentsResult(requestId, JSON.stringify({ status: 'success', items: [item] })); } catch (e) {} }, 40);
    },
    cancelAttachmentPick: () => {},
  };
  try { localStorage.setItem(PREFIX + 'turnloom.machine.v2', ${JSON.stringify(JSON.stringify(registry))}); } catch (e) {}

  window.__qa = {
    q: (selector, root) => Array.from((root || document).querySelectorAll(selector)),
    txt: (el) => ((el && (el.innerText || el.getAttribute('aria-label'))) || '').replace(/\\s+/g, ' ').trim(),
    visible(el) {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = getComputedStyle(el);
      return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || '1') > 0;
    },
    rect(el) {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right };
    },
    /** A text/aria button (or clickable role) whose label matches exactly / contains. */
    button(label, { exact = true, root, contains = false } = {}) {
      const scope = root || document;
      const nodes = __qa.q('button, [role="button"], a[role="button"]', scope).filter((el) => __qa.visible(el));
      return nodes.find((el) => {
        const text = __qa.txt(el);
        const aria = String(el.getAttribute('aria-label') || '').trim();
        if (exact) return text === label || aria === label;
        return text.includes(label) || aria.includes(label);
      }) || null;
    },
    /** Clickable ancestor of a node (rows are often a button containing text). */
    clickable(el) {
      if (!el) return null;
      return el.closest('button, [role="button"], a') || el;
    },
    /** The visible queue bar (contains "N 条排队"). */
    queueBar() {
      const bar = document.querySelector('.tl-queuebar');
      if (bar && __qa.visible(bar)) return bar;
      const nodes = __qa.q('*').filter((el) => {
        if (!__qa.visible(el) || el.children.length > 7) return false;
        return /\\d+\\s*条排队/.test(__qa.txt(el));
      });
      // deepest / smallest match wins, then take its clickable ancestor
      nodes.sort((a, b) => __qa.txt(a).length - __qa.txt(b).length || (__qa.rect(a).w * __qa.rect(a).h) - (__qa.rect(b).w * __qa.rect(b).h));
      return nodes.length ? __qa.clickable(nodes[0]) : null;
    },
    /** Newest visible Vaul drawer. */
    drawer() {
      const rows = __qa.q('[data-vaul-drawer]').filter(__qa.visible);
      return rows.length ? rows[rows.length - 1] : null;
    },
    /** Actual hit span around a control, measured with elementFromPoint (0.5px ruler). */
    hitSpan(el) {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const owns = (x, y, target) => {
        const found = document.elementFromPoint(x, y);
        return Boolean(found && (found === target || target.contains(found)));
      };
      let top = r.top, bottom = r.bottom;
      for (let y = r.top - 0.5; y >= r.top - 48; y -= 0.5) { if (owns(cx, y, el)) top = y; else break; }
      for (let y = r.bottom + 0.5; y <= r.bottom + 48; y += 0.5) { if (owns(cx, y, el)) bottom = y; else break; }
      let left = r.left, right = r.right;
      for (let x = r.left - 0.5; x >= r.left - 48; x -= 0.5) { if (owns(x, cy, el)) left = x; else break; }
      for (let x = r.right + 0.5; x <= r.right + 48; x += 0.5) { if (owns(x, cy, el)) right = x; else break; }
      return { top, bottom, left, right, h: bottom - top, w: right - left };
    },
    overflow() {
      return {
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        scrollHeight: document.documentElement.scrollHeight,
        innerHeight: window.innerHeight,
      };
    },
    composer() {
      return document.querySelector('.tl-composer-card') || document.querySelector('form.tl-composer') || document.querySelector('textarea.tl-composer-input, textarea[aria-label="消息"]')?.closest('form') || null;
    },
    input() {
      return document.querySelector('textarea.tl-composer-input, textarea[aria-label="消息"]');
    },
    fill(value) {
      const el = __qa.input();
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    },
    scrollable(el) {
      return Boolean(el && el.scrollHeight > el.clientHeight + 4);
    },
  };
})();`;
}

// ---------------------------------------------------------------------------
// Phase helpers
// ---------------------------------------------------------------------------
let cdp = null;
let shotSeq = 0;
let viewDir = "";

async function shot(name) {
  shotSeq += 1;
  const file = path.join(viewDir, `${String(shotSeq).padStart(2, "0")}-${name}.png`);
  await cdp.screenshot(file);
  return file;
}

async function openChat() {
  await cdp.navigate(`http://127.0.0.1:${APP_PORT}/index.html`);
  try {
    await cdp.waitFor(".tl-thread-screen, .tl-chat-list", { timeoutMs: 20_000 });
  } catch (error) {
    const body = await cdp.eval(`(document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 500)`).catch(() => "");
    await shot("open-failed").catch(() => {});
    throw new Error(`${error.message}; body=${JSON.stringify(body)}`);
  }
  await sleep(400);
  // 2.3.0 defaults to the project grouping; collapsed groups hide the row.
  // Switch to the flat time list so the target row is visible without guessing
  // which project group it belongs to.
  if (!(await cdp.eval(`Boolean(document.querySelector('.tl-chat-list'))`))) {
    await cdp.eval(`(() => {
      const tab = Array.from(document.querySelectorAll('[role="tab"], .tl-filter-chip, button')).find((el) => (el.innerText || '').trim() === '按时间');
      if (tab) tab.click();
      return Boolean(tab);
    })()`);
    await sleep(700);
  }
  // The time view still renders a collapsed "运行中" group. Without opening it
  // there is no .tl-thread-row in the DOM, and every phase below dies waiting.
  if (!(await cdp.eval(`Boolean(document.querySelector('.tl-thread-row'))`))) {
    await cdp.eval(`(() => {
      const expand = Array.from(document.querySelectorAll('button')).find((el) => (el.innerText || '').trim() === '展开');
      if (expand) { expand.click(); return true; }
      const group = document.querySelector('.tl-group-head');
      if (group) { group.click(); return true; }
      return false;
    })()`);
    await sleep(600);
  }
  try {
    await cdp.waitFor(".tl-thread-row, .tl-chat-list", { timeoutMs: 15_000 });
  } catch (error) {
    const body = await cdp.eval(`(document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 500)`).catch(() => "");
    await shot("open-failed").catch(() => {});
    throw new Error(`${error.message}; body=${JSON.stringify(body)}`);
  }
  const opened = await cdp.eval(`(() => {
    if (document.querySelector('.tl-chat-list')) return 'already-open';
    const row = Array.from(document.querySelectorAll('button.tl-thread-row, button')).find((el) => (el.innerText || '').includes('排队一条消息'))
      || document.querySelector('button.tl-thread-row');
    if (!row) return false;
    row.click();
    return 'clicked';
  })()`);
  if (!opened) throw new Error("thread row not found");
  await cdp.waitFor(".tl-chat-list", { timeoutMs: 15_000 });
  await sleep(1400); // first messages poll + composer mount
}

async function openQueueSheet() {
  const clicked = await cdp.eval(`(() => {
    const bar = document.querySelector('.tl-queuebar-main') || __qa.queueBar();
    if (!bar) return false;
    bar.click();
    return true;
  })()`);
  if (!clicked) throw new Error("queue bar not found");
  await cdp.waitFor("[data-vaul-drawer]", { timeoutMs: 8_000 });
  await sleep(600);
}

async function openRow(label) {
  const clicked = await cdp.eval(`(() => {
    const drawer = __qa.drawer();
    if (!drawer) return false;
    const row = Array.from(drawer.querySelectorAll('.tl-queue-row, button, [role="button"]')).find((el) => (__qa.txt(el) || '').includes(${JSON.stringify(label)}));
    if (!row) return false;
    row.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`queue row not found: ${label}`);
  await sleep(700);
}

async function clickAction(label) {
  const clicked = await cdp.eval(`(() => {
    const details = Array.from(document.querySelectorAll('.tl-queue-detail')).filter(__qa.visible);
    const root = details.length ? details[details.length - 1] : document;
    const actions = Array.from(root.querySelectorAll('.tl-queue-action')).filter(__qa.visible);
    const btn = actions.find((el) => {
      const text = (el.innerText || '').replace(/\\s+/g, ' ').trim();
      const aria = String(el.getAttribute('aria-label') || '');
      return text === ${JSON.stringify(label)} || text.startsWith(${JSON.stringify(label)}) || aria === ${JSON.stringify(label)} || aria.startsWith(${JSON.stringify(label)} + '（');
    });
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`action not found: ${label}`);
  await sleep(700);
}

async function actionMatrix() {
  return cdp.eval(`(() => {
    const details = Array.from(document.querySelectorAll('.tl-queue-detail')).filter(__qa.visible);
    const root = details.length ? details[details.length - 1] : document;
    return Array.from(root.querySelectorAll('.tl-queue-action')).map((el) => ({
      label: (el.querySelector('.tl-queue-action-text > span')?.textContent || '').trim(),
      disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
      reason: (el.querySelector('.tl-queue-action-reason')?.textContent || '').trim(),
    }));
  })()`);
}

/** Confirm cards are their own surface; never let the action row behind answer. */
async function clickConfirm(label) {  const clicked = await cdp.eval(`(() => {
    const cards = Array.from(document.querySelectorAll('.tl-queue-confirm')).filter(__qa.visible);
    const scope = cards.length ? cards[cards.length - 1] : document;
    const btn = __qa.button(${JSON.stringify(label)}, { root: scope, exact: true });
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`confirm button not found: ${label}`);
  await sleep(700);
}

function queueOrderFromState(state) {
  return (state.queue || []).map((item) => item.text);
}

async function waitForText(text, timeoutMs = 8_000) {
  await cdp.waitForText(text, { timeoutMs });
  await sleep(250);
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------
const PHASES = [];
const phase = (name, fn) => PHASES.push({ name, fn });

phase("composer", async () => {
  await fixture("reset");
  await openChat();

  const base = await cdp.eval(`(() => {
    const send = document.querySelector('button[aria-label="排队发送"]');
    const stop = document.querySelector('button[aria-label="停止"]');
    const input = __qa.input();
    return {
      send: Boolean(send), stop: Boolean(stop),
      sendRect: __qa.rect(send), stopRect: __qa.rect(stop),
      sendHit: send ? __qa.hitSpan(send) : null,
      stopHit: stop ? __qa.hitSpan(stop) : null,
      enterKeyHint: input ? input.getAttribute('enterkeyhint') : null,
      bar: Boolean(__qa.queueBar()),
    };
  })()`);
  check("composer.stop.present", base.stop, "aria-label=停止");
  check("composer.running.empty.only.stop", !base.send && base.stop, `send=${base.send} stop=${base.stop}`);
  check("composer.enterKeyHint.send", base.enterKeyHint === "send", String(base.enterKeyHint));
  check("composer.empty.bar.absent", !base.bar);

  await cdp.eval(`__qa.fill('排队 A · 390')`);
  await sleep(300);
  const withText = await cdp.eval(`(() => {
    const send = document.querySelector('button[aria-label="排队发送"]');
    const stop = document.querySelector('button[aria-label="停止"]');
    const hint = document.body.innerText.includes('本轮运行中，发送会排队，结束后自动发出');
    return {
      send: __qa.rect(send), stop: __qa.rect(stop),
      sendHit: send ? __qa.hitSpan(send) : null, stopHit: stop ? __qa.hitSpan(stop) : null, hint,
      value: __qa.input()?.value ?? null,
      labels: Array.from(document.querySelectorAll('button[aria-label]')).map((el) => el.getAttribute('aria-label')).filter((label) => /发送|停止/.test(label)),
      composerCount: document.querySelectorAll('.tl-composer-card').length,
    };
  })()`);
  check("composer.send.and.stop.44", (withText.sendHit?.h ?? 0) >= 43.5 && (withText.stopHit?.h ?? 0) >= 43.5, `send h=${withText.sendHit?.h} stop h=${withText.stopHit?.h} value=${JSON.stringify(withText.value)} labels=${JSON.stringify(withText.labels)} composers=${withText.composerCount}`);
  check("composer.stop.right.of.send", (withText.stop?.x ?? 0) > (withText.send?.x ?? 0) + 10, `send x=${withText.send?.x} stop x=${withText.stop?.x}`);
  check("composer.running.hint", withText.hint);

  await cdp.eval(`document.querySelector('button[aria-label="排队发送"]')?.click()`);
  await cdp.waitForText("1 条排队", { timeoutMs: 8_000 });
  await sleep(500);
  const afterSend = await cdp.eval(`(() => {
    const bar = document.querySelector('.tl-queuebar');
    const main = document.querySelector('.tl-queuebar-main') || bar;
    const input = __qa.input();
    const composer = __qa.composer();
    const barRect = __qa.rect(bar);
    const composerRect = __qa.rect(composer);
    const notice = document.body.innerText.includes('已排队');
    return {
      bar: Boolean(bar), barRect, composerRect, notice,
      value: input ? input.value : null,
      barHit: main ? __qa.hitSpan(main) : null,
      noticeText: (document.body.innerText.match(/已排队[^\\n]*/) || [''])[0],
    };
  })()`);
  check("send.queues.bar", afterSend.bar);
  check("send.clears.input", afterSend.value === "", JSON.stringify(afterSend.value));
  check("send.notice.count", afterSend.notice && /已排队/.test(afterSend.noticeText), afterSend.noticeText);
  check("bar.above.composer", (afterSend.barRect?.bottom ?? 1e9) <= (afterSend.composerRect?.y ?? 0) + 1, `bar bottom=${afterSend.barRect?.bottom} composer top=${afterSend.composerRect?.y}`);
  check("bar.hit.44", (afterSend.barHit?.h ?? 0) >= 43.5, `hit h=${afterSend.barHit?.h}`);
  const requests = await fixtureRequests();
  const sendReq = requests.find((row) => row.path === "/api/send" && row.body?.mode === "queue");
  check("send.mode.queue.on.wire", Boolean(sendReq), sendReq ? "POST /api/send mode=queue" : "no request");
  await shot("queued-390");
});

phase("sheet", async () => {
  // continues from composer state (1 item), but re-seed for isolation
  await fixture("reset");
  await fixture("seed-queue", { items: [{ text: "第一条排队消息", images: [{ name: "a.png", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" }], files: [{ name: "log.txt", mimeType: "text/plain", data: "aGVsbG8=" }] }] });
  await openChat();
  await openQueueSheet();

  const sheet = await cdp.eval(`(() => {
    const drawer = __qa.drawer();
    const title = document.body.innerText.includes('排队消息');
    const subtitle = document.body.innerText.includes('本轮结束后按顺序发送');
    const row = Array.from(drawer.querySelectorAll('button, [role="button"]')).find((el) => (__qa.txt(el) || '').includes('第一条排队消息'));
    const badge = document.body.innerText.includes('排队中');
    const meta = document.body.innerText.includes('图片 1');
    return {
      title, subtitle, row: Boolean(row), rowRect: row ? __qa.rect(row) : null, badge, meta,
      scrollable: __qa.scrollable(drawer),
      overflow: __qa.overflow(),
    };
  })()`);
  check("sheet.title", sheet.title);
  check("sheet.subtitle.normal", sheet.subtitle);
  check("sheet.row.present", sheet.row);
  check("sheet.row.height.56", (sheet.rowRect?.h ?? 0) >= 55, `h=${sheet.rowRect?.h}`);
  check("sheet.badge.queued", sheet.badge);
  check("sheet.meta.attachments", sheet.meta);
  check("sheet.drawer.scrollable", sheet.scrollable);
  check("sheet.no.horizontal.overflow", sheet.overflow.scrollWidth <= sheet.overflow.innerWidth + 1, JSON.stringify(sheet.overflow));
  await shot("sheet-390");

  await openRow("第一条排队消息");
  const detail = await cdp.eval(`(() => {
    const rows = Array.from(document.querySelectorAll('.tl-queue-action')).map((el) => ({
      label: (el.querySelector('.tl-queue-action-text > span')?.textContent || '').trim(),
      present: __qa.visible(el),
      rect: __qa.rect(el),
      hit: __qa.hitSpan(el),
      disabled: el.disabled === true,
    }));
    return {
      title: document.body.innerText.includes('排队消息 1'),
      rows,
      back: Boolean(document.querySelector('.tl-queue-back')),
      imageText: document.body.innerText.includes('图片 1'),
      fileText: document.body.innerText.includes('log.txt'),
      overflow: __qa.overflow(),
    };
  })()`);
  check("detail.title", detail.title);
  check("detail.back.visible", detail.back);
  check("detail.actions.44", detail.rows.length >= 4 && detail.rows.every((row) => row.present && (row.hit?.h ?? 0) >= 43.5), JSON.stringify(detail.rows.map((r) => [r.label, r.present, Math.round(r.hit?.h || 0)])));
  check("detail.attachment.meta", detail.imageText && detail.fileText, `image=${detail.imageText} file=${detail.fileText}`);
  await shot("detail-390");

  await clickAction("取回编辑");
  await sleep(800);
  const taken = await cdp.eval(`(() => ({
    value: __qa.input() ? __qa.input().value : null,
    bar: Boolean(__qa.queueBar()),
    attachmentText: document.body.innerText.includes('a.png') || document.body.innerText.includes('图片 1') || document.body.innerText.includes('log.txt'),
  }))()`);
  check("edit.returns.text", taken.value === "第一条排队消息", JSON.stringify(taken.value));
  check("edit.clears.queue", !taken.bar);
  check("edit.returns.attachments", taken.attachmentText);
  const requests = await fixtureRequests();
  check("edit.cancel.edit.on.wire", requests.some((row) => row.path === "/api/queue/cancel" && row.body?.edit === true));
});

phase("images", async () => {
  await fixture("reset");
  await fixture("seed-queue", { items: [{
    text: "JPEG 和 PNG 各一张",
    images: [
      { name: "pixel.png", mimeType: "image/png", data: PNG_1PX },
      { name: "photo-red.jpg", mimeType: "image/jpeg", data: JPEG_2PX },
    ],
  }] });
  await openChat();
  await openQueueSheet();
  await openRow("JPEG 和 PNG 各一张");
  await sleep(1500); // data: URL fetch + decode
  const queueImages = await cdp.eval(`(() => {
    const imgs = Array.from(document.querySelectorAll('.tl-queue-detail img'));
    return {
      count: imgs.length,
      rows: imgs.map((img) => ({ src: String(img.src || '').slice(0, 32), loaded: img.complete && img.naturalWidth > 0 })),
      fallback: document.body.innerText.includes('图片 2 张'),
    };
  })()`);
  check("images.queue.detail.render", queueImages.count >= 2 && queueImages.rows.every((row) => row.loaded), JSON.stringify(queueImages));
  const png = queueImages.rows.find((row) => row.src.startsWith('data:image/png'));
  const jpeg = queueImages.rows.find((row) => row.src.startsWith('data:image/jpeg'));
  check("images.queue.detail.mime", Boolean(png) && Boolean(jpeg), JSON.stringify(queueImages.rows));

  // The old broken-photo bug: a sent chat photo must render from a data: URL,
  // with the message's own MIME (JPEG here) — not a default image/png.
  const chatImage = await cdp.eval(`(() => {
    const img = document.querySelector('.tl-chat-attachment img');
    return img ? { src: String(img.src || '').slice(0, 40), loaded: img.complete && img.naturalWidth > 0 } : null;
  })()`);
  check("images.chat.jpeg.render", Boolean(chatImage && chatImage.loaded && chatImage.src.startsWith('data:image/jpeg')), JSON.stringify(chatImage));
  await shot("images-390");
});

phase("drain", async () => {
  await fixture("reset");
  await fixture("seed-queue", { items: [{ text: "本轮结束后自动发送" }] });
  await openChat();
  await cdp.waitForText("1 条排队", { timeoutMs: 8_000 });
  await fixture("finish-turn", { drain: "ok", delayMs: 300 });
  await sleep(5200); // 300ms + 420ms + status poll (3s) + repaint
  const state = await fixtureState();
  check("drain.queue.empty", state.queue.length === 0, JSON.stringify(queueOrderFromState(state)));
  check("drain.sent.once", state.messages.filter((row) => row.content === "本轮结束后自动发送").length === 1, String(state.messages.filter((row) => row.content === "本轮结束后自动发送").length));
  const ui = await cdp.eval(`(() => ({
    bar: Boolean(document.querySelector('.tl-queuebar')),
    bubble: Array.from(document.querySelectorAll('.tl-chat-bubble')).some((el) => (el.innerText || '').includes('本轮结束后自动发送')),
    running: Boolean(document.querySelector('button[aria-label="停止"]')),
  }))()`);
  check("drain.bar.gone", !ui.bar);
  check("drain.message.visible", ui.bubble);
  check("drain.turn.ended.ui", !ui.running);
});

phase("reload", async () => {
  await fixture("reset");
  await fixture("seed-queue", { items: [{ text: "刷新保留 1" }, { text: "刷新保留 2" }, { text: "刷新保留 3" }] });
  await openChat();
  await cdp.waitForText("3 条排队", { timeoutMs: 8_000 });
  await openQueueSheet();
  const before = await cdp.eval(`(() => Array.from(document.querySelectorAll('.tl-queue-row')).map((el) => (el.querySelector('.tl-queue-row-preview')?.textContent || '').trim()))()`);
  check("reload.before", JSON.stringify(before) === JSON.stringify(["刷新保留 1", "刷新保留 2", "刷新保留 3"]), JSON.stringify(before));
  await openChat(); // navigate away and back: a real reload, not a local cache
  await cdp.waitForText("3 条排队", { timeoutMs: 10_000 });
  await openQueueSheet();
  const after = await cdp.eval(`(() => Array.from(document.querySelectorAll('.tl-queue-row')).map((el) => (el.querySelector('.tl-queue-row-preview')?.textContent || '').trim()))()`);
  check("reload.after", JSON.stringify(after) === JSON.stringify(before), JSON.stringify(after));
});

phase("limit", async () => {
  await fixture("reset");
  await fixture("seed-queue", { items: Array.from({ length: 19 }, (_, index) => ({ text: `容量消息 ${index + 1}` })) });
  await openChat();
  await cdp.waitForText("19 条排队", { timeoutMs: 8_000 });
  await cdp.eval(`__qa.fill('第 20 条')`);
  await sleep(300);
  await cdp.eval(`document.querySelector('button[aria-label="排队发送"]')?.click()`);
  await cdp.waitForText("20 条排队", { timeoutMs: 8_000 });
  await sleep(400);
  await cdp.eval(`__qa.fill('第 21 条')`);
  await sleep(300);
  await cdp.eval(`document.querySelector('button[aria-label="排队发送"]')?.click()`);
  await sleep(1200);
  const limit = await cdp.eval(`(() => ({
    alert: Array.from(document.querySelectorAll('[role="alert"]')).map((el) => __qa.txt(el)).join(' | '),
    value: __qa.input()?.value ?? null,
  }))()`);
  const state = await fixtureState();
  check("limit.error.copy", /队列已满/.test(limit.alert), JSON.stringify(limit));
  check("limit.draft.kept", limit.value === "第 21 条", JSON.stringify(limit.value));
  check("limit.queue.20", state.queue.length === 20, String(state.queue.length));
  await openQueueSheet();
  const note = await cdp.eval(`document.body.innerText.includes('最多 20 条')`);
  check("limit.note.visible", note);
});

phase("normal-send", async () => {
  await fixture("reset");
  await fixture("set", { thinking: false, interactionRequired: false });
  await openChat();
  await cdp.eval(`__qa.fill('本轮已结束的普通发送')`);
  await sleep(300);
  const button = await cdp.eval(`Boolean(document.querySelector('button[aria-label="发送"]'))`);
  check("normal.send.button", button);
  await cdp.eval(`document.querySelector('button[aria-label="发送"]')?.click()`);
  await sleep(1200);
  const requests = await fixtureRequests();
  const sendReq = requests.filter((row) => row.path === "/api/send").at(-1);
  check("normal.send.mode.start", sendReq?.body?.mode === "start", JSON.stringify(sendReq?.body));
  const state = await fixtureState();
  check("normal.send.arrives", state.messages.some((row) => row.content === "本轮已结束的普通发送"), String(state.messages.length));
  const bar = await cdp.eval(`Boolean(document.querySelector('.tl-queuebar'))`);
  check("normal.send.no.bar", !bar);
});

phase("reorder", async () => {
  await fixture("reset");
  await fixture("seed-queue", { items: [{ text: "A 第一条" }, { text: "B 第二条" }, { text: "C 第三条" }] });
  await openChat();
  await openQueueSheet();
  const order0 = await cdp.eval(`(() => Array.from(document.querySelectorAll('.tl-queue-row')).map((el) => (el.querySelector('.tl-queue-row-preview')?.textContent || '').trim()))()`);
  check("reorder.initial.order", JSON.stringify(order0) === JSON.stringify(["A 第一条", "B 第二条", "C 第三条"]), JSON.stringify(order0));

  await openRow("B 第二条");
  await clickAction("上移");
  await sleep(900);
  let state = await fixtureState();
  check("reorder.up.persisted", JSON.stringify(queueOrderFromState(state)) === JSON.stringify(["B 第二条", "A 第一条", "C 第三条"]), JSON.stringify(queueOrderFromState(state)));

  // detail still open; go back then open C and move to top
  await cdp.eval(`document.querySelector('.tl-queue-back')?.click()`);
  await sleep(500);
  await openRow("C 第三条");
  await clickAction("移到队首");
  await sleep(900);
  state = await fixtureState();
  check("reorder.top.persisted", JSON.stringify(queueOrderFromState(state)) === JSON.stringify(["C 第三条", "B 第二条", "A 第一条"]), JSON.stringify(queueOrderFromState(state)));
  const requests = await fixtureRequests();
  check("reorder.api.called", requests.filter((row) => row.path === "/api/queue/reorder").length >= 2, `${requests.filter((row) => row.path === "/api/queue/reorder").length} calls`);
});

phase("delete", async () => {
  await fixture("reset");
  await fixture("seed-queue", { items: [{ text: "要删除的消息" }, { text: "保留的消息" }] });
  await openChat();
  await openQueueSheet();
  await openRow("要删除的消息");
  await clickAction("删除");
  const confirm = await cdp.eval(`(() => ({
    text: document.body.innerText.includes('删除这条排队消息？'),
    dialog: Boolean(document.querySelector('.tl-confirm-card, [role="alertdialog"], [role="dialog"]')),
  }))()`);
  check("delete.confirm.copy", confirm.text, JSON.stringify(confirm));
  await clickConfirm("删除");
  await sleep(900);
  const state = await fixtureState();
  check("delete.removes.one", state.queue.length === 1 && state.queue[0].text === "保留的消息", JSON.stringify(queueOrderFromState(state)));

  // sending item: all actions disabled, including delete
  await fixture("reset");
  await fixture("seed-queue", { items: [{ text: "发送中的消息", deliveryState: "sending" }] });
  await openChat();
  await openQueueSheet();
  await openRow("发送中的消息");
  const locked = await cdp.eval(`(() => {
    const rows = Array.from(document.querySelectorAll('.tl-queue-action')).map((el) => ({
      label: (el.querySelector('.tl-queue-action-text > span')?.textContent || '').trim(),
      present: __qa.visible(el),
      disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true' || /is-disabled/.test(el.className),
    }));
    return { text: document.body.innerText.includes('正在发送，暂时不能修改'), disabled: rows };
  })()`);
  check("detail.sending.locked.copy", locked.text);
  check("detail.sending.all.disabled", locked.disabled.length >= 4 && locked.disabled.every((row) => row.present && row.disabled), JSON.stringify(locked.disabled));
});

phase("pause", async () => {
  await fixture("reset");
  await fixture("seed-queue", { items: [{ text: "暂停保留 1" }, { text: "暂停保留 2" }] });
  await openChat();
  await cdp.eval(`document.querySelector('button[aria-label="停止"]')?.click()`);
  await waitForText("已暂停");
  const paused = await cdp.eval(`(() => {
    const bar = document.querySelector('.tl-queuebar');
    const main = document.querySelector('.tl-queuebar-main');
    const resume = document.querySelector('.tl-queuebar-resume');
    return {
      bar: Boolean(bar), resume: Boolean(resume),
      resumeRect: resume ? __qa.rect(resume) : null,
      resumeHit: resume ? __qa.hitSpan(resume) : null,
      chevron: Boolean(main && main.querySelector('svg.lucide-chevron-right')),
      text: (bar && __qa.txt(bar)) || '',
    };
  })()`);
  check("pause.bar.paused", paused.bar && /已暂停/.test(paused.text), paused.text);
  check("pause.bar.resume.44", paused.resume && (paused.resumeHit?.h ?? 0) >= 43.5, `hit=${paused.resumeHit?.h}`);
  check("pause.bar.no.chevron", !paused.chevron);
  await shot("paused-390");
  await sleep(2200);
  const still = await fixtureState();
  check("pause.no.silent.send", still.queue.length === 2, `queue=${still.queue.length}`);

  await cdp.eval(`document.querySelector('.tl-queuebar-resume')?.click()`);
  await sleep(1200);
  const resumed = await fixtureState();
  check("resume.clears.pause", resumed.paused === false);
  const requests = await fixtureRequests();
  check("pause.interrupt.on.wire", requests.some((row) => row.path === "/api/interrupt"));
  check("pause.resume.on.wire", requests.some((row) => row.path === "/api/queue/resume"));
});

phase("failed", async () => {
  await fixture("reset");
  await fixture("seed-queue", { items: [
    { text: "失败的消息", deliveryState: "failed", lastError: "电脑端连接中断：send failed（QA 故障注入）" },
    { text: "后面的消息" },
  ] });
  await openChat();
  const bar = await cdp.eval(`(() => {
    const el = __qa.queueBar();
    return { text: (el && __qa.txt(el)) || '', color: el ? getComputedStyle(el).color : '' };
  })()`);
  check("failed.bar.copy", /队首发送失败/.test(bar.text), bar.text);
  await openQueueSheet();
  const direct = await cdp.eval(`(() => ({
    detail: document.body.innerText.includes('排队消息 1'),
    reason: document.body.innerText.includes('QA 故障注入'),
    retry: Boolean(__qa.button('重试')),
  }))()`);
  check("failed.bar.opens.detail", direct.detail);
  check("failed.reason.visible", direct.reason);
  check("failed.retry.visible", direct.retry);
  await shot("failed-390");

  // The failed item's action matrix is read BEFORE retry: retrying turns the
  // item into a normal queued row, where the order group is supposed to return.
  const failedActions = await cdp.eval(`(() => {
    const detail = Array.from(document.querySelectorAll('.tl-queue-detail')).filter(__qa.visible).at(-1);
    const rows = Array.from((detail || document).querySelectorAll('.tl-queue-action')).map((el) => (el.querySelector('.tl-queue-action-text > span')?.textContent || '').trim());
    return { rows, reason: document.body.innerText.includes('不能调整顺序') };
  })()`);
  check("failed.reorder.hidden", !failedActions.rows.some((label) => ['移到队首', '上移', '下移'].includes(label)), JSON.stringify(failedActions.rows));
  check("failed.reorder.reason", failedActions.reason, JSON.stringify(failedActions));

  // The list state is its own evidence: subtitle, failed badge, both rows. The
  // bar opens the failed detail directly, so step back once.
  await cdp.eval(`document.querySelector('.tl-queue-back')?.click()`);
  await sleep(600);
  const failedList = await cdp.eval(`(() => ({
    subtitle: document.body.innerText.includes('队首消息发送失败'),
    badge: Array.from(document.querySelectorAll('.tl-queue-badge')).some((el) => (el.innerText || '').trim() === '失败'),
    rows: document.querySelectorAll('.tl-queue-row').length,
  }))()`);
  check("failed.list.subtitle", failedList.subtitle, JSON.stringify(failedList));
  check("failed.list.badge", failedList.badge, JSON.stringify(failedList));
  check("failed.list.rows", failedList.rows === 2, String(failedList.rows));
  await shot("failed-sheet-390");

  await openRow("失败的消息");
  await clickAction("重试");
  await sleep(900);
  const state = await fixtureState();
  check("failed.retry.requeues", state.queue[0].deliveryState === "queued" && state.queue[0].lastError === null, JSON.stringify(state.queue[0]));
  check("failed.retry.on.wire", (await fixtureRequests()).some((row) => row.path === "/api/queue/retry"));
});

phase("capabilities", async () => {
  // PI-native shape: steer only raises priority, queued files are refused.
  await fixture("reset");
  await fixture("set-capabilities", { capabilities: { turnSteer: false, queueFiles: false } });
  await fixture("seed-queue", { items: [{ text: "PI 队首" }, { text: "PI 第二条" }] });
  await openChat();
  const paperclip = await cdp.eval(`(() => {
    const btn = document.querySelector('button[aria-label*="附件"]');
    return { present: Boolean(btn), label: btn?.getAttribute('aria-label') || '', disabled: btn?.getAttribute('aria-disabled') === 'true', hit: btn ? __qa.hitSpan(btn) : null };
  })()`);
  check("pi.files.button.44", paperclip.present && (paperclip.hit?.h ?? 0) >= 43.5, JSON.stringify(paperclip));
  check("pi.files.button.explains", /不支持排队文件/.test(paperclip.label) && paperclip.disabled, JSON.stringify(paperclip));
  await cdp.eval(`document.querySelector('button[aria-label*="附件"]')?.click()`);
  await sleep(400);
  const blockedHint = await cdp.eval(`document.body.innerText.includes('当前后端不支持把文件排进队列')`);
  check("pi.files.tap.hint", blockedHint);

  await openQueueSheet();
  await openRow("PI 队首");
  let rows = await actionMatrix();
  check("pi.steer.label", rows.some((row) => row.label === '优先下一条') && !rows.some((row) => row.label === '插入本轮'), JSON.stringify(rows));
  check("pi.reorder.hidden", !rows.some((row) => ['移到队首', '上移', '下移'].includes(row.label)), JSON.stringify(rows));
  await cdp.eval(`document.querySelector('.tl-queue-back')?.click()`);
  await sleep(400);
  await openRow("PI 第二条");
  rows = await actionMatrix();
  const priority = rows.find((row) => row.label === '优先下一条');
  check("pi.priority.enabled.behind", Boolean(priority) && !priority.disabled, JSON.stringify(rows));
  await cdp.eval(`document.querySelector('.tl-queue-back')?.click()`);
  await shot("pi-capabilities-390");

  // Failed head with three rows: order rules are column-wide, not per-row.
  await fixture("reset");
  await fixture("seed-queue", { items: [
    { text: "失败队首", deliveryState: "failed", lastError: "电脑端连接中断" },
    { text: "紧随其后", },
    { text: "第三行", },
  ] });
  await openChat();
  await openQueueSheet();
  rows = await actionMatrix();
  check("failed.head.order.hidden", !rows.some((row) => ['移到队首', '上移', '下移'].includes(row.label)), JSON.stringify(rows));
  const failedNote = await cdp.eval(`document.body.innerText.includes('这条发送失败，先重试、编辑或删除；不能调整顺序')`);
  check("failed.head.item.note", failedNote);
  await cdp.eval(`document.querySelector('.tl-queue-back')?.click()`);
  await sleep(400);
  const listWarning = await cdp.eval(`document.body.innerText.includes('处理前不能越过它排序')`);
  check("failed.head.list.warning", listWarning);
  await openRow("紧随其后");
  rows = await actionMatrix();
  const secondTop = rows.find((row) => row.label === '移到队首');
  const secondUp = rows.find((row) => row.label === '上移');
  const secondDown = rows.find((row) => row.label === '下移');
  check("failed.head.index1.top.disabled", Boolean(secondTop?.disabled));
  check("failed.head.index1.up.disabled", Boolean(secondUp?.disabled));
  check("failed.head.index1.down.enabled", Boolean(secondDown) && !secondDown.disabled, JSON.stringify(rows));
  check("failed.head.index1.order.note", await cdp.eval(`document.body.innerText.includes('处理前不能越过它排序')`));
  await cdp.eval(`document.querySelector('.tl-queue-back')?.click()`);
  await sleep(400);
  await openRow("第三行");
  rows = await actionMatrix();
  const thirdTop = rows.find((row) => row.label === '移到队首');
  const thirdUp = rows.find((row) => row.label === '上移');
  const thirdDown = rows.find((row) => row.label === '下移');
  check("failed.head.index2.top.disabled", Boolean(thirdTop?.disabled));
  check("failed.head.index2.up.enabled", Boolean(thirdUp) && !thirdUp.disabled, JSON.stringify(rows));
  check("failed.head.index2.down.disabled.tail", Boolean(thirdDown?.disabled) && /队尾/.test(thirdDown?.reason || ''), JSON.stringify(rows));
  await shot("failed-head-actions-390");
});

phase("steer", async () => {
  await fixture("reset");
  await fixture("seed-queue", { items: [{ text: "插入本轮的正文" }] });
  await openChat();
  await openQueueSheet();
  await openRow("插入本轮的正文");
  await clickAction("插入本轮");
  await sleep(900);
  let state = await fixtureState();
  check("steer.removes.item", state.queue.length === 0, JSON.stringify(queueOrderFromState(state)));
  check("steer.api.called", (await fixtureRequests()).some((row) => row.path === "/api/queue/steer"));

  // 409 path: item must stay and the button must not turn into another action
  await fixture("reset");
  await fixture("seed-queue", { items: [{ text: "409 保留的消息" }] });
  await fixture("fail-next", { what: "steer" });
  await openChat();
  await openQueueSheet();
  await openRow("409 保留的消息");
  await clickAction("插入本轮");
  await sleep(900);
  const conflict = await cdp.eval(`(() => ({
    error: document.body.innerText.includes('本轮已结束') || document.body.innerText.includes('消息仍在队列里'),
    stillThere: document.body.innerText.includes('409 保留的消息'),
  }))()`);
  state = await fixtureState();
  check("steer.409.copy", conflict.error);
  check("steer.409.keeps.item", state.queue.length === 1);
});

phase("enqueue-failure", async () => {
  await fixture("reset");
  await fixture("fail-next", { what: "enqueue" });
  await openChat();
  await cdp.eval(`__qa.fill('断网入队失败的草稿')`);
  await sleep(350);
  const beforeClick = await cdp.eval(`(() => ({
    send: Boolean(document.querySelector('button[aria-label="排队发送"], button[aria-label="发送"]')),
    disabled: document.querySelector('button[aria-label="排队发送"], button[aria-label="发送"]')?.disabled ?? null,
    value: __qa.input()?.value,
  }))()`);
  const requestsBefore = (await fixtureRequests()).length;
  await cdp.eval(`document.querySelector('button[aria-label="排队发送"], button[aria-label="发送"]')?.click()`);
  await sleep(1400);
  const requestsAfter = (await fixtureRequests()).length;
  const failure = await cdp.eval(`(() => {
    const alerts = Array.from(document.querySelectorAll('[role="alert"]')).map((el) => __qa.txt(el)).filter(Boolean);
    const err = document.querySelector('.tl-composer-error');
    const input = __qa.input();
    return {
      alert: alerts.length > 0, alertText: alerts.join(' | '),
      errorNode: err ? __qa.txt(err) : '',
      bodyHasCopy: document.body.innerText.includes('无法写入队列'),
      value: input ? input.value : null,
      bar: Boolean(document.querySelector('.tl-queuebar')),
      offline: document.body.innerText.includes('离线'),
      calls: (window.__qaCalls || []).map((row) => row.method + ' ' + row.url).slice(-6),
    };
  })()`);
  check("enqueue.failure.visible", failure.alert && /无法写入队列|失败/.test(failure.alertText), JSON.stringify({ beforeClick, requestsBefore, requestsAfter, ...failure }));
  check("enqueue.failure.keeps.draft", failure.value === "断网入队失败的草稿", JSON.stringify(failure.value));
  check("enqueue.failure.no.bar", !failure.bar);
  check("enqueue.failure.not.offline", !failure.offline);
  await shot("enqueue-failure-390");
});

phase("empty", async () => {
  await fixture("reset");
  await fixture("seed-queue", { items: [{ text: "最后一条" }] });
  await openChat();
  await openQueueSheet();
  // Remove it through the server while the sheet stays open: the empty state
  // must be reachable without a reload (the bar disappears in the same poll).
  await fixture("seed-queue", { items: [] });
  await sleep(4500);
  const empty = await cdp.eval(`(() => ({
    copy: document.body.innerText.includes('没有排队消息'),
    hint: document.body.innerText.includes('发送的消息会排在这里'),
    bar: Boolean(document.querySelector('.tl-queuebar')),
  }))()`);
  check("empty.sheet.copy", empty.copy && empty.hint, JSON.stringify(empty));
  check("empty.bar.gone", !empty.bar);
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
let APP_PORT = 0;
let staticServer = null;

async function runViewport(view) {
  const [width, height] = view.split("x").map(Number);
  currentView = view;
  viewDir = path.join(OUT, view);
  fs.mkdirSync(viewDir, { recursive: true });
  shotSeq = 0;
  console.log(`\n== ${view} ==`);

  cdp = new CDP({ port: await freePort(), headless: true, width, height, scale: 2 });
  await cdp.launch();
  await cdp.setViewport(width, height, 2);
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: seedSource(APP_PORT, FIXTURE_PORT) });
  try {
    if (ONLY.length) {
      for (const one of PHASES.filter((row) => ONLY.includes(row.name))) {
        console.log(`\n-- ${one.name} --`);
        try { await one.fn(); } catch (error) { fail(`${one.name}.threw`, error.message); await shot(`threw-${one.name}`).catch(() => {}); }
      }
    } else {
      // The three visual sizes share the same functional phases; the phase set
      // is deliberately run in full on 390×844, and geometry-only re-checks run
      // on the shorter/wider sizes.
      const functional = view === "390x844" || ONLY.length;
      for (const one of PHASES) {
        if (!functional && one.name !== "composer" && one.name !== "sheet" && one.name !== "pause") continue;
        console.log(`\n-- ${one.name} --`);
        try { await one.fn(); } catch (error) { fail(`${one.name}.threw`, error.message); await shot(`threw-${one.name}`).catch(() => {}); }
      }
    }
    // Geometry pass: composer / bar / drawer at this viewport.
    await fixture("reset");
    await fixture("seed-queue", { items: [{ text: "几何检查的消息 A" }, { text: "几何检查的消息 B" }] });
    await openChat();
    await cdp.waitFor(".tl-composer-input", { timeoutMs: 8_000 });
    await cdp.eval(`__qa.fill('几何检查')`);
    await sleep(500);
    const geometry = await cdp.eval(`(() => {
      const send = document.querySelector('button[aria-label="排队发送"], button[aria-label="发送"]');
      const stop = document.querySelector('button[aria-label="停止"]');
      const bar = document.querySelector('.tl-queuebar');
      const composer = __qa.composer();
      const input = __qa.input();
      return {
        overflow: __qa.overflow(),
        inputValue: input ? input.value : null,
        sendPresent: Boolean(send),
        send: __qa.rect(send), stop: __qa.rect(stop),
        sendHit: send ? __qa.hitSpan(send) : null,
        stopHit: stop ? __qa.hitSpan(stop) : null,
        bar: __qa.rect(bar), barHit: bar ? __qa.hitSpan(bar.querySelector('.tl-queuebar-main') || bar) : null,
        composer: __qa.rect(composer),
        oneRow: send && stop && Math.abs(send.getBoundingClientRect().y - stop.getBoundingClientRect().y) < 4,
      };
    })()`);
    check(`geometry.no.overflow.${view}`, geometry.overflow.scrollWidth <= geometry.overflow.innerWidth + 1, JSON.stringify(geometry.overflow));
    check(`geometry.buttons.44.${view}`, (geometry.sendHit?.h ?? 0) >= 43.5 && (geometry.stopHit?.h ?? 0) >= 43.5, `send=${geometry.sendHit?.h} stop=${geometry.stopHit?.h} value=${JSON.stringify(geometry.inputValue)} sendPresent=${geometry.sendPresent}`);
    check(`geometry.stop.right.${view}`, (geometry.stop?.x ?? 0) > (geometry.send?.x ?? 0) + 10);
    check(`geometry.buttons.one.row.${view}`, geometry.oneRow);
    check(`geometry.bar.above.composer.${view}`, (geometry.bar?.bottom ?? 1e9) <= (geometry.composer?.y ?? 0) + 1, `bar=${geometry.bar?.bottom} composer=${geometry.composer?.y}`);
    check(`geometry.bar.hit.44.${view}`, (geometry.barHit?.h ?? 0) >= 43.5, `hit=${geometry.barHit?.h}`);
    await shot(`geometry-${view}`);

    if (height <= 640) {
      // Keyboard: focusing the composer must keep it (and the bar) inside the viewport.
      await cdp.eval(`__qa.input()?.focus()`);
      await sleep(600);
      const keyboard = await cdp.eval(`(() => {
        const composer = __qa.rect(__qa.composer());
        const bar = __qa.rect(__qa.queueBar());
        return { composer, bar, innerHeight: window.innerHeight };
      })()`);
      check(`geometry.keyboard.composer.visible.${view}`, (keyboard.composer?.bottom ?? 1e9) <= keyboard.innerHeight + 1, JSON.stringify(keyboard));
      check(`geometry.keyboard.bar.visible.${view}`, (keyboard.bar?.y ?? -1) >= 0 && (keyboard.bar?.bottom ?? 1e9) <= keyboard.innerHeight + 1, JSON.stringify(keyboard.bar));
    }
  } finally {
    await cdp.close();
    cdp = null;
  }
}

async function main() {
  if (has("build")) {
    const vite = path.join(REPO, "app", "node_modules", "vite", "bin", "vite.js");
    if (!fs.existsSync(vite)) {
      console.error(`[queue] no vite at ${vite} — run npm ci in app/ first`);
      process.exit(2);
    }
    const built = spawnSync(process.execPath, [vite, "build", "--outDir", DIST, "--emptyOutDir"], {
      cwd: path.join(REPO, "app"), stdio: "inherit", windowsHide: true,
    });
    if (built.status !== 0) {
      console.error("[queue] build failed");
      process.exit(2);
    }
  }
  if (!fs.existsSync(path.join(DIST, "index.html"))) {
    console.error(`[queue] no bundle at ${DIST} — pass --build`);
    process.exit(2);
  }

  FIXTURE_PORT = FIXTURE_PORT || await freePort();
  const fixtureProc = spawn(process.execPath, [path.join(REPO, "tools/qa/queue-fixture.mjs")], {
    cwd: REPO, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    env: { ...process.env, QA_QUEUE_PORT: String(FIXTURE_PORT) },
  });
  let fixtureLog = "";
  fixtureProc.stdout.on("data", (chunk) => { fixtureLog += chunk.toString(); });
  fixtureProc.stderr.on("data", (chunk) => { fixtureLog += chunk.toString(); });
  try {
    await waitForHttp(`http://127.0.0.1:${FIXTURE_PORT}/__qa/state`, 20_000);
    const staticStack = await startStatic(DIST);
    staticServer = staticStack.server;
    APP_PORT = staticStack.port;
    console.log(`[queue] app ${APP_PORT} · fixture ${FIXTURE_PORT} · bundle ${path.relative(REPO, DIST)}`);
    fs.mkdirSync(OUT, { recursive: true });
    for (const view of VIEWS) await runViewport(view);
  } finally {
    try { staticServer?.close(); } catch { /* ignore */ }
    try { fixtureProc.kill(); } catch { /* ignore */ }
    await sleep(200);
  }

  const failed = results.filter((row) => !row.pass);
  const assetsDir = path.join(DIST, "assets");
  const assetRow = fs.existsSync(assetsDir)
    ? fs.readdirSync(assetsDir)
        .filter((name) => name.startsWith("index-") && name.endsWith(".js"))
        .map((name) => {
          const bytes = fs.readFileSync(path.join(assetsDir, name));
          return { name, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
        })
        .sort((a, b) => b.bytes - a.bytes)[0] || null
    : null;
  let head = "";
  try { head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim(); } catch { /* not a git checkout */ }
  const report = {
    generatedAt: new Date().toISOString(),
    head,
    bundle: path.relative(REPO, DIST),
    asset: assetRow,
    fixture: "tools/qa/queue-fixture.mjs",
    views: VIEWS,
    pass: results.length - failed.length,
    fail: failed.length,
    results,
  };
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2), "utf8");
  if (JSON_OUT) fs.writeFileSync(path.resolve(REPO, JSON_OUT), JSON.stringify(report, null, 2), "utf8");
  console.log(`\n[queue] ${report.pass} PASS / ${report.fail} FAIL · report ${path.relative(REPO, path.join(OUT, "report.json"))}`);
  if (fixtureLog.trim()) console.log(fixtureLog.trim().split("\n").slice(-3).join("\n"));
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 2;
});
