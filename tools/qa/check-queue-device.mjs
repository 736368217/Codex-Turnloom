#!/usr/bin/env node
/**
 * 2.3.0 queue acceptance on the real Android WebView (emulator-5554).
 *
 * The App is the built APK; only the backend is the deterministic 7813 queue
 * fixture. Pairing is seeded into the debug build's SharedPreferences, then the
 * activity is started with `--ez turnloom.qaDebug true` so the WebView exposes
 * DevTools. All assertions run in the real WebView, including the native
 * `bodyBase64` image path.
 *
 * Emulator is shared: run this only inside your announced window.
 *
 *   node tools/qa/check-queue-device.mjs --apk dist-app/Codex-Turnloom-2.3.0-app-debug.apk
 *
 * Exit code 1 when any criterion fails.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const argOf = (name, fallback = "") => {
  const key = String(name).startsWith("--") ? String(name) : `--${name}`;
  const index = argv.indexOf(key);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const has = (name) => argv.includes(String(name).startsWith("--") ? String(name) : `--${name}`);
const APK = path.resolve(REPO, argOf("--apk", "dist-app/Codex-Turnloom-2.3.0-app-debug.apk"));
const SERIAL = argOf("--serial", "emulator-5554");
const FIXTURE_PORT = Number(argOf("--fixture-port", "7813"));
const OUT = path.resolve(REPO, argOf("--out", "docs/qa/queue-final/device"));
const CDP_PORT = Number(argOf("--cdp-port", "9335"));
const PACKAGE = "com.codex.turnloom.app";
const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPEG_2PX = "/9j/4AAQSkZJRgABAQEAeAB4AAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD50ooor8MP9Uz/2Q==";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ADB = [
  path.join(process.env.USERPROFILE || "", "tools", "platform-tools", "adb.exe"),
  path.join(process.env.ANDROID_HOME || "", "platform-tools", "adb.exe"),
  path.join(process.env.LOCALAPPDATA || "", "Android", "Sdk", "platform-tools", "adb.exe"),
].find((candidate) => candidate && fs.existsSync(candidate));
if (!ADB) {
  console.error("[device] adb.exe not found");
  process.exit(2);
}

const results = [];
function check(id, pass, detail = "") {
  results.push({ id, pass: Boolean(pass), detail });
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${id}${detail ? ` — ${detail}` : ""}`);
}

function adb(...args) {
  return execFileSync(ADB, ["-s", SERIAL, ...args], { encoding: "utf8", windowsHide: true });
}
function adbBuffer(...args) {
  return execFileSync(ADB, ["-s", SERIAL, ...args], { encoding: "buffer", windowsHide: true });
}
function shot(name) {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, adbBuffer("exec-out", "screencap", "-p"));
  return file;
}

const PREFS_PATH = `/data/data/${PACKAGE}/shared_prefs/turnloom_native_secure_v1.xml`;
let prefsBackup = null;
let hadPrefs = false;

function backupPairing() {
  try {
    prefsBackup = adbBuffer("shell", "run-as", PACKAGE, "cat", PREFS_PATH);
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, "prefs-backup.xml"), prefsBackup);
    hadPrefs = true;
  } catch {
    hadPrefs = false;
  }
}

function restorePairing() {
  try {
    adb("shell", "am", "force-stop", PACKAGE);
    if (hadPrefs && prefsBackup) {
      const local = path.join(OUT, "prefs-backup.xml");
      adb("push", local, "/data/local/tmp/turnloom-prefs-restore.xml");
      adb("shell", "run-as", PACKAGE, "cp", "/data/local/tmp/turnloom-prefs-restore.xml", PREFS_PATH);
    } else {
      adb("shell", "run-as", PACKAGE, "rm", "-f", PREFS_PATH);
    }
  } catch {
    // Best effort: the emulator is disposable, but never leave QA pairing
    // silently behind if the normal path fails.
  }
}

// ---------------------------------------------------------------------------
// Pairing: point the debug build at the queue fixture without tapping the QR UI.
// ---------------------------------------------------------------------------
function seedPairing() {
  backupPairing();
  const registry = {
    version: 3,
    activeMachineId: "qa-queue-machine",
    machines: [{
      machineId: "qa-queue-machine",
      machineName: "QA 队列工作站",
      serverUrl: `http://10.0.2.2:${FIXTURE_PORT}`,
      machineToken: "qa-machine-token",
      harnesses: [{ id: "codex", name: "Codex Desktop", token: "qa-codex-token", kind: "codex", online: true, defaultHarness: true }],
      defaultHarnessId: "codex",
      lastUsedAt: Date.now(),
    }],
  };
  const esc = (value) => String(value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  const xml = `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
  <string name="turnloom.serverUrl">${esc(`http://10.0.2.2:${FIXTURE_PORT}`)}</string>
  <string name="turnloom.machine.v2">${esc(JSON.stringify(registry))}</string>
</map>`;
  const local = path.join(OUT, "turnloom_native_secure_v1.xml");
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(local, xml, "utf8");
  adb("push", local, "/data/local/tmp/turnloom_native_secure_v1.xml");
  adb("shell", "am", "force-stop", PACKAGE);
  adb("shell", "run-as", PACKAGE, "mkdir", "-p", `/data/data/${PACKAGE}/shared_prefs`);
  adb("shell", "run-as", PACKAGE, "cp", "/data/local/tmp/turnloom_native_secure_v1.xml", `/data/data/${PACKAGE}/shared_prefs/turnloom_native_secure_v1.xml`);
  adb("shell", "run-as", PACKAGE, "chmod", "660", `/data/data/${PACKAGE}/shared_prefs/turnloom_native_secure_v1.xml`);
}

// ---------------------------------------------------------------------------
// Minimal CDP client for the WebView socket
// ---------------------------------------------------------------------------
class Cdp {
  constructor(url) { this.url = url; this.seq = 0; this.pending = new Map(); }
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
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
  }
  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 30_000).unref?.();
    });
  }
  async eval(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  }
  close() { try { this.ws?.close(); } catch { /* ignore */ } }
}

const HELPERS = `(() => {
  window.__qa = {
    q: (selector, root) => Array.from((root || document).querySelectorAll(selector)),
    txt: (el) => ((el && (el.innerText || el.getAttribute('aria-label'))) || '').replace(/\\s+/g, ' ').trim(),
    visible(el) { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; },
    rect(el) { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom }; },
    input() { return document.querySelector('textarea.tl-composer-input, textarea[aria-label="消息"]'); },
    fill(value) {
      const el = __qa.input(); if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set;
      setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); return true;
    },
    hitSpan(el) {
      if (!el) return null;
      const r = el.getBoundingClientRect(); const cx = r.left + r.width / 2;
      const owns = (x, y) => { const found = document.elementFromPoint(x, y); return Boolean(found && (found === el || el.contains(found))); };
      let top = r.top, bottom = r.bottom;
      for (let y = r.top - 0.5; y >= r.top - 48; y -= 0.5) { if (owns(cx, y)) top = y; else break; }
      for (let y = r.bottom + 0.5; y <= r.bottom + 48; y += 0.5) { if (owns(cx, y)) bottom = y; else break; }
      return { h: bottom - top };
    },
    drawer() { const rows = __qa.q('[data-vaul-drawer]').filter(__qa.visible); return rows.length ? rows[rows.length - 1] : null; },
  };
})();`;

async function waitText(cdp, text, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdp.eval(`document.body.innerText.includes(${JSON.stringify(text)})`)) return true;
    await sleep(200);
  }
  throw new Error(`text not found: ${text}`);
}

async function openChat(cdp) {
  await sleep(800);
  if (!(await cdp.eval(`Boolean(document.querySelector('.tl-chat-list'))`))) {
    // The project grouping is collapsed by default; switch to the flat list.
    await cdp.eval(`(() => {
      const tab = Array.from(document.querySelectorAll('[role="tab"], button')).find((el) => (el.innerText || '').trim() === '按时间');
      if (tab) tab.click();
    })()`);
    await sleep(600);
    await cdp.eval(`(() => {
      const row = Array.from(document.querySelectorAll('button.tl-thread-row')).find((el) => (el.innerText || '').includes('排队一条消息'))
        || document.querySelector('button.tl-thread-row');
      if (row) row.click();
    })()`);
  }
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await cdp.eval(`Boolean(document.querySelector('.tl-chat-list'))`)) break;
    await sleep(250);
  }
  await sleep(1200);
}

async function main() {
  if (!fs.existsSync(APK)) {
    console.error(`[device] APK not found: ${APK}`);
    process.exit(2);
  }
  const devices = adb("devices");
  if (!devices.includes(SERIAL)) {
    console.error(`[device] ${SERIAL} not attached`);
    process.exit(2);
  }
  adb("install", "-r", APK);
  seedPairing();
  adb("shell", "am", "force-stop", PACKAGE);
  await sleep(400);
  adb("shell", "am", "start", "-n", `${PACKAGE}/.MainActivity`, "--ez", "turnloom.qaDebug", "true");
  await sleep(3000);

  const unix = adb("shell", "cat", "/proc/net/unix");
  const socket = (unix.match(/webview_devtools_remote_\d+/) || [])[0];
  if (!socket) {
    console.error("[device] no WebView DevTools socket — was the activity started with turnloom.qaDebug?");
    process.exit(2);
  }
  adb("forward", `tcp:${CDP_PORT}`, `localabstract:${socket}`);
  const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const page = list.find((row) => /android_asset/.test(row.url)) || list[0];
  if (!page) {
    console.error("[device] no WebView page");
    process.exit(2);
  }
  const cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send("Runtime.enable");
  await cdp.eval(HELPERS);

  // Wait for the real bundle to mount against the fixture.
  const ready = await cdp.eval(`(async () => {
    for (let i = 0; i < 60; i += 1) {
      if (document.querySelector('.tl-thread-screen, .tl-chat-list')) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  })()`);
  check("device.app.mounted", ready, await cdp.eval(`document.body.innerText.slice(0, 120)`));
  await shot("01-launch");

  await openChat(cdp);
  const state = await cdp.eval(`(() => ({
    chat: Boolean(document.querySelector('.tl-chat-list')),
    stop: Boolean(document.querySelector('button[aria-label="停止"]')),
    send: Boolean(document.querySelector('button[aria-label="排队发送"]')),
    queueBar: Boolean(document.querySelector('.tl-queuebar')),
    body: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 200),
  }))()`);
  check("device.chat.open", state.chat, JSON.stringify(state));
  check("device.stop.visible", state.stop);

  // Queue one message through the real UI.
  await cdp.eval(`__qa.fill('真机排队验收')`);
  await sleep(400);
  const before = await cdp.eval(`(() => {
    const send = document.querySelector('button[aria-label="排队发送"]');
    const stop = document.querySelector('button[aria-label="停止"]');
    return { send: __qa.rect(send), stop: __qa.rect(stop), sendHit: send ? __qa.hitSpan(send) : null, stopHit: stop ? __qa.hitSpan(stop) : null };
  })()`);
  check("device.send.and.stop.44", (before.sendHit?.h ?? 0) >= 43 && (before.stopHit?.h ?? 0) >= 43, JSON.stringify(before));
  check("device.stop.right", (before.stop?.x ?? 0) > (before.send?.x ?? 0) + 8);
  await shot("02-composer");
  await cdp.eval(`document.querySelector('button[aria-label="排队发送"]')?.click()`);
  await waitText(cdp, '1 条排队', 12_000);
  await sleep(500);
  check("device.queued.bar", await cdp.eval(`Boolean(document.querySelector('.tl-queuebar'))`));
  await shot("03-queued");

  // Replace the queue snapshot with an item carrying both image types, so the
  // detail exercises the native `bodyBase64` path for PNG and JPEG on-device.
  await fetch(`http://127.0.0.1:${FIXTURE_PORT}/__qa/control`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "seed-queue", items: [{
      text: "真机排队验收",
      images: [
        { name: "pixel.png", mimeType: "image/png", data: PNG_1PX },
        { name: "photo-red.jpg", mimeType: "image/jpeg", data: JPEG_2PX },
      ],
    }] }),
  });
  await sleep(400);

  await cdp.eval(`document.querySelector('.tl-queuebar-main')?.click()`);
  await sleep(900);
  check("device.sheet.open", await cdp.eval(`Boolean(__qa.drawer())`));
  await shot("04-sheet");

  await cdp.eval(`(() => {
    const drawer = __qa.drawer();
    const row = drawer ? Array.from(drawer.querySelectorAll('.tl-queue-row')).find((el) => (el.innerText || '').includes('真机排队验收')) : null;
    if (row) row.click();
  })()`);
  await sleep(1200);
  check("device.detail.open", await cdp.eval(`Boolean(document.querySelector('.tl-queue-detail'))`));
  await shot("05-detail");

  const images = await cdp.eval(`(() => {
    const chat = Array.from(document.querySelectorAll('.tl-chat-attachment img')).map((img) => ({ src: String(img.src).slice(0, 24), loaded: img.complete && img.naturalWidth > 0 }));
    const queue = Array.from(document.querySelectorAll('.tl-queue-detail img')).map((img) => ({ src: String(img.src).slice(0, 24), loaded: img.complete && img.naturalWidth > 0 }));
    return { chat, queue };
  })()`);
  check("device.chat.jpeg.loaded", images.chat.some((row) => row.loaded && row.src.startsWith('data:image/jpeg')), JSON.stringify(images.chat));
  check("device.queue.png.loaded", images.queue.some((row) => row.loaded && row.src.startsWith('data:image/png')), JSON.stringify(images.queue));
  check("device.queue.jpeg.loaded", images.queue.some((row) => row.loaded && row.src.startsWith('data:image/jpeg')), JSON.stringify(images.queue));

  // Close detail then drawer with the real BACK key before stopping.
  adb("shell", "input", "keyevent", "4");
  await sleep(400);
  adb("shell", "input", "keyevent", "4");
  await sleep(600);

  // Stop -> pause, no silent send.
  await cdp.eval(`document.querySelector('button[aria-label="停止"]')?.click()`);
  await waitText(cdp, '已暂停', 12_000).catch(() => {});
  await sleep(500);
  const paused = await cdp.eval(`(() => ({
    bar: (document.querySelector('.tl-queuebar')?.innerText || '').replace(/\\s+/g, ' ').trim(),
    resume: Boolean(document.querySelector('.tl-queuebar-resume')),
  }))()`);
  check("device.pause.bar", /已暂停/.test(paused.bar) && paused.resume, JSON.stringify(paused));
  await shot("06-paused");

  fs.mkdirSync(OUT, { recursive: true });
  const report = { generatedAt: new Date().toISOString(), serial: SERIAL, apk: path.relative(REPO, APK), pass: results.filter((row) => row.pass).length, fail: results.filter((row) => !row.pass).length, results };
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(`\n[device] ${report.pass} PASS / ${report.fail} FAIL · ${path.relative(REPO, path.join(OUT, "report.json"))}`);
  cdp.close();
  restorePairing();
  process.exitCode = report.fail ? 1 : 0;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  try { shot("99-failure"); } catch { /* ignore */ }
  try { restorePairing(); } catch { /* ignore */ }
  process.exitCode = 2;
});
