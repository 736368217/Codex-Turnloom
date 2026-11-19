/**
 * Entry-level regression for the unpaired connect screen's update path.
 *
 * Why this exists: 2.2.4 shipped a 「查看并安装」 button that called
 * openSheet('update') on a screen with no CupertinoSheetHost — the state
 * changed and nothing rendered, so a physical tap did nothing (Rhea,
 * emulator-5554, 2026-11-19T16:00). The unit tests were green throughout,
 * because the defect lives in the wiring between a button and its host.
 *
 * This runs the REAL built bundle (app/dist) in headless Edge with a native
 * bridge stub that answers the public manifest with a newer version, so the
 * whole path is exercised as the phone does it:
 *
 *   unpaired boot -> 检查应用更新（公开通道） -> 发现新版本 -> 查看并安装
 *   -> bottom sheet 「应用更新」 -> 「下载新版本」
 *
 * It fails if any step is silent (no state text / no sheet / no manifest call).
 *
 * Usage:
 *   npm run app:build
 *   node tools/qa/check-connect-update.mjs [--cdp-port 9333] [--out .scratch/qa/connect-update.png]
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
const OUT = path.resolve(ROOT, flag("out", ".scratch/qa/connect-update.png"));

const MANIFEST = {
  version: "9.9.9",
  versionCode: 999,
  apk: "turnloom/Codex-Turnloom-9.9.9.apk",
  size: 1024,
  sha256: "9".repeat(64),
  publishedAt: "2026-11-19T10:00:00Z",
  notes: "qa fixture: newer than the installed build",
};

const lines = [];
const log = (line) => { lines.push(line); console.log(line); };

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
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`preview did not answer: ${url}`);
}

/** The Android bridge, minus the Android: HTTP becomes fetch, storage is a Map. */
function bridgeSource(manifest) {
  return `(() => {
  const store = new Map();
  const manifest = ${JSON.stringify(manifest)};
  window.__qaNativeCalls = [];
  window.__qaInstallCalls = 0;
  window.TurnloomNative = {
    secureGet(key) { return store.has(key) ? store.get(key) : null; },
    secureSet(key, value) { store.set(key, String(value)); return true; },
    secureRemove(key) { store.delete(key); return true; },
    haptic() {}, setLightBars() {}, scanQr() {},
    getAppInfo() {
      return JSON.stringify({
        label: "Codex-Turnloom", version: "2.2.4", versionCode: 93,
        packageName: "com.codex.turnloom.app",
        cameraAvailable: false, updatesAvailable: true,
      });
    },
    request(requestId, payloadJson) {
      let payload = {};
      try { payload = JSON.parse(payloadJson) || {}; } catch { payload = {}; }
      const url = String(payload.url || "");
      window.__qaNativeCalls.push(url);
      const reply = (status, body, error) => setTimeout(
        () => window.__turnloomNativeHttpResult?.(requestId, JSON.stringify({ status, body, error })),
        20,
      );
      if (url.includes("/turnloom/latest.json")) return reply(200, JSON.stringify(manifest));
      return reply(0, "", "qa-no-backend");
    },
    cancelRequest() {},
    downloadUpdate() {},
    cancelUpdate() {},
    installUpdate() { window.__qaInstallCalls += 1; },
  };
})();`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let preview = null;
let browser = null;
let failures = 0;

function check(ok, label, detail = "") {
  log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` · ${detail}` : ""}`);
  if (!ok) failures += 1;
}

try {
  if (!fs.existsSync(path.join(APP, "dist", "index.html"))) {
    throw new Error("app/dist is missing — run `npm run app:build` first");
  }
  const port = await freePort();
  preview = spawn(process.execPath, [
    path.join(APP, "node_modules/vite/bin/vite.js"), "preview",
    "--port", String(port), "--strictPort", "--host", "127.0.0.1",
  ], { cwd: APP, stdio: "ignore", windowsHide: true });
  const base = `http://127.0.0.1:${port}/`;
  await waitForHttp(base);

  browser = await new CDP({ port: CDP_PORT, width: 390, height: 844, scale: 3 }).launch();
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: bridgeSource(MANIFEST) });
  await browser.navigate(base);
  await browser.waitForText("连接电脑", { timeoutMs: 15_000 });
  check(true, "unpaired boot reaches ConnectScreen");

  const checkButton = await browser.eval(`(() => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('检查应用更新'));
    if (!el) return null;
    el.click();
    return { text: el.textContent.trim(), disabled: el.disabled };
  })()`);
  check(Boolean(checkButton), "the public-channel check button exists");

  await browser.waitForText(`检查中`, { timeoutMs: 3_000 }).catch(() => {});
  const available = await browser.waitForText(`发现新版本 ${MANIFEST.version}`, { timeoutMs: 8_000 })
    .then(() => true).catch(() => false);
  check(available, "the tap reports a newer version instead of staying silent");

  const calls = await browser.eval("window.__qaNativeCalls.slice()");
  check(calls.some((url) => url.includes("/turnloom/latest.json")),
    "the check really asked the public manifest", calls.join(", ") || "(none)");

  const installButton = await browser.eval(`(() => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('查看并安装'));
    if (!el) return 'missing';
    const r = el.getBoundingClientRect();
    el.click();
    return JSON.stringify({ w: Math.round(r.width), h: Math.round(r.height) });
  })()`);
  check(installButton !== "missing", "「查看并安装」 is rendered for the available state", installButton);

  // The defect: the sheet state changed but no host rendered it. Assert pixels.
  const sheetOpen = await browser.waitFor("[data-vaul-drawer]", { timeoutMs: 3_000 })
    .then(() => true).catch(() => false);
  check(sheetOpen, "「查看并安装」 opens a bottom sheet (not a dead tap)");

  if (sheetOpen) {
    // The panel runs its own background check on mount; wait for it to settle
    // instead of sampling the 检查中 frame.
    await browser.waitForText("下载新版本", { timeoutMs: 6_000 }).catch(() => {});
    const sheetText = await browser.eval(`(() => {
      const el = document.querySelector('[data-vaul-drawer]');
      const r = el.getBoundingClientRect();
      return JSON.stringify({ text: el.innerText.replace(/\\s+/g, ' ').slice(0, 240), w: Math.round(r.width), h: Math.round(r.height) });
    })()`);
    const sheet = JSON.parse(sheetText);
    check(sheet.text.includes("应用更新"), "the sheet is the update panel", sheet.text.slice(0, 80));
    check(sheet.text.includes("下载新版本"), "the sheet offers the download action", sheet.text.slice(0, 80));
    const source = await browser.eval(`(() => document.querySelector('[data-qa="update-source"]')?.textContent || '')()`);
    check(String(source).includes("公网"), "the panel names the public source", String(source).slice(0, 80));
  }

  await browser.screenshot(OUT);
  log(`screenshot ${OUT}`);
} catch (error) {
  check(false, "harness", error.message);
} finally {
  try { await browser?.close(); } catch { /* ignore */ }
  try { preview?.kill(); } catch { /* ignore */ }
  await sleep(200);
}

log(failures === 0 ? "RESULT: PASS" : `RESULT: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
