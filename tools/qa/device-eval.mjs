#!/usr/bin/env node
/**
 * Evaluate one JavaScript expression inside the running app's WebView on a
 * device, and print the JSON result.
 *
 * Why this exists: a screenshot proves what a page looked like at that moment;
 * it cannot prove that a header stayed put while the list scrolled, that the
 * hit target is 44 CSS px, or that the count on screen equals the JSON the
 * server sent. Those need the live DOM, and the WebView is reachable over the
 * same DevTools protocol a desktop Chrome is.
 *
 * The app only opens WebView debugging when launched with
 * `--ez turnloom.qaDebug true`, and adb must forward the socket first:
 *
 *   adb -s emulator-5554 shell am start -n com.codex.turnloom.app/.MainActivity \
 *     --ez turnloom.qaDebug true
 *   adb -s emulator-5554 shell "cat /proc/net/unix | grep webview_devtools"
 *   adb -s emulator-5554 forward tcp:9222 localabstract:webview_devtools_remote_<pid>
 *   node tools/qa/device-eval.mjs --expr "document.title"
 *
 * Exit code 1 on any protocol error, so a shell can gate on it.
 */
import process from "node:process";

function parseArgs(argv) {
  const out = { port: 9222, expr: "", timeoutMs: 15000, json: false, all: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port") out.port = Number(argv[++i]);
    else if (arg === "--expr") out.expr = argv[++i];
    else if (arg === "--file") out.file = argv[++i];
    else if (arg === "--timeout") out.timeoutMs = Number(argv[++i]);
    else if (arg === "--all") out.all = true;
    else if (arg === "--json") out.json = true;
    else if (arg === "-h" || arg === "--help") out.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      last = new Error(`HTTP ${response.status} for ${url}`);
    } catch (error) {
      last = error;
    }
    await sleep(150);
  }
  throw new Error(`CDP endpoint not ready: ${last?.message || "timeout"}`);
}

class Socket {
  constructor(url) {
    this.url = url;
    this.seq = 0;
    this.pending = new Map();
  }

  async open() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("websocket open timeout")), 10000);
      this.ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener("error", (event) => {
        clearTimeout(timer);
        reject(new Error(`websocket error: ${event?.message || "unknown"}`));
      }, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      let payload = null;
      try {
        payload = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
      } catch {
        return;
      }
      if (!payload || payload.id === undefined) return;
      const entry = this.pending.get(payload.id);
      if (!entry) return;
      this.pending.delete(payload.id);
      if (payload.error) entry.reject(new Error(payload.error.message || "CDP error"));
      else entry.resolve(payload.result);
    });
  }

  send(method, params = {}, timeoutMs = 15000) {
    const id = (this.seq += 1);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try { this.ws?.close(); } catch { /* ignore */ }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("usage: node tools/qa/device-eval.mjs --expr <js> [--port 9222] [--json]");
    process.exit(0);
  }
  const targets = await fetchJson(`http://127.0.0.1:${args.port}/json/list`, args.timeoutMs);
  const pages = targets.filter((target) => target.type === "page" && target.webSocketDebuggerUrl);
  if (!pages.length) throw new Error("no debuggable page target (relaunch with turnloom.qaDebug)");
  const target = args.all ? pages[pages.length - 1] : pages[0];

  const socket = new Socket(target.webSocketDebuggerUrl);
  await socket.open();
  try {
    if (args.expr) {
      const result = await socket.send("Runtime.evaluate", {
        expression: args.expr,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
      });
      if (result.exceptionDetails) {
        const text = result.exceptionDetails.exception?.description
          || result.exceptionDetails.text
          || "evaluation threw";
        console.error(text);
        process.exitCode = 1;
        return;
      }
      const value = result.result?.value;
      console.log(JSON.stringify(value, null, args.json ? 2 : 0));
      return;
    }
  } finally {
    socket.close();
  }
}

main().catch((error) => {
  console.error(`device-eval: ${error.message}`);
  process.exit(1);
});
