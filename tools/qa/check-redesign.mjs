/**
 * 2.2.6 重设计的验收器：分段控件的「滑动」必须能被量出来，而不是靠眼看。
 *
 *   node tools/qa/check-redesign.mjs               # 夹具自证 + 真 bundle（UI 未落地 → SKIP）
 *   node tools/qa/check-redesign.mjs --fixture-only
 *   node tools/qa/check-redesign.mjs --require     # UI 必须在；缺了算失败（发版门禁用）
 *   node tools/qa/check-redesign.mjs --out .scratch/qa/redesign
 *
 * 为什么先有验收器：图 1 要的是「药丸滑过去」，瞬移和滑动在截图上完全一样。
 * 所以判据走时间轴 —— 切换后逐帧采样指示器的 x，要求它在中途被看见。
 *
 * 契约（不绑定类名，只绑用户看得见的东西）：
 *   1. 视图切换是 role="tablist"，里面是 role="tab"，文字是「按时间」「按项目」；
 *   2. tablist 里有一个绝对定位的指示器，命中 data-seg-thumb / .tl-seg-pill /
 *      .tl-seg-thumb / class 里带 thumb|indicator|pill 的任一选择器；
 *      没有指示器 = 这一版还是两个独立按钮（2.2.5 的 .tl-filter-chip），记为 SKIP。
 *
 * 自证：同一个测量函数跑两份夹具（240ms transition 与 0ms 瞬移），
 * 滑动夹具必须 PASS、瞬移夹具必须被同一条判据判 FAIL —— 否则测的是空气。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CDP } from "./cdp.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const APP = path.join(ROOT, "app");
const argv = process.argv.slice(2);
const flag = (name, fallback = "") => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);
const OUT = path.resolve(ROOT, flag("out", ".scratch/qa/redesign"));
const REQUIRE = has("require");
const FIXTURE_ONLY = has("fixture-only");

const lines = [];
const log = (line) => { lines.push(line); console.log(line); };
let failures = 0;
// 夹具里那份「瞬移」实现本来就该被判失败；用这个开关把「预期失败」和真失败分开，
// 否则日志里躺着几条 FAIL，读的人会以为验收挂了。
let expectingFailure = false;
let expectedFailHits = 0;
const check = (ok, label, detail = "") => {
  if (expectingFailure) {
    if (!ok) { expectedFailHits += 1; log(`EXPECTED-FAIL ${label}${detail ? ` · ${detail}` : ""}`); }
    else log(`PASS(应失败) ${label}${detail ? ` · ${detail}` : ""}`);
    return;
  }
  log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` · ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const skip = (label, detail = "") => log(`SKIP ${label}${detail ? ` · ${detail}` : ""}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const response = await fetch(url); if (response.ok) return; } catch { /* not up yet */ }
    await sleep(120);
  }
  throw new Error(`preview did not answer: ${url}`);
}

/* ---------------------------------------------------------------- fixtures */

/** The same DOM contract as the real control, so the measurement is proven
 *  against a page whose behaviour is known: `slide` transitions, `snap` jumps. */
function fixtureHtml(mode) {
  const transition = mode === "snap" ? "none" : "transform 240ms cubic-bezier(.22,1,.36,1), width 240ms cubic-bezier(.22,1,.36,1)";
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { margin: 0; background: #f2f2f7; font: 600 14px -apple-system, "Segoe UI", sans-serif; }
  .track { position: relative; display: inline-flex; margin: 40px 16px; padding: 3px; border-radius: 999px; background: #efeff4; }
  .thumb { position: absolute; top: 3px; bottom: 3px; left: 0; border-radius: 999px; background: #fff;
           box-shadow: 0 3px 8px rgba(0,0,0,.12); transition: ${transition}; }
  .seg { position: relative; z-index: 1; min-width: 88px; min-height: 44px; padding: 0 18px; border: 0;
         border-radius: 999px; background: transparent; color: #8e8e93; font: inherit; }
  .seg[aria-selected="true"] { color: #1c1c1e; }
</style>
<div class="track" role="tablist" aria-label="会话视图">
  <span class="thumb" data-seg-thumb aria-hidden="true"></span>
  <button class="seg" role="tab" aria-selected="true">按时间</button>
  <button class="seg" role="tab" aria-selected="false">按项目</button>
</div>
<script>
  const track = document.querySelector('.track');
  const thumb = document.querySelector('.thumb');
  const segs = [...track.querySelectorAll('[role="tab"]')];
  function place() {
    const active = segs.find((el) => el.getAttribute('aria-selected') === 'true');
    thumb.style.width = active.offsetWidth + 'px';
    thumb.style.transform = 'translateX(' + active.offsetLeft + 'px)';
  }
  segs.forEach((seg) => seg.addEventListener('click', () => {
    segs.forEach((el) => el.setAttribute('aria-selected', String(el === seg)));
    place();
  }));
  addEventListener('resize', place);
  place();
</script>`;
}

/* ------------------------------------------------------------ measurement */

/**
 * Click the segment whose text is `toText` and record the indicator's x on
 * every animation frame until it settles. Runs inside the page.
 */
const traceSwitch = ({ fromText, toText }) => `(async () => {
  const text = (el) => (el.textContent || '').trim();
  const lists = [...document.querySelectorAll('[role="tablist"]')];
  const list = lists.find((el) => /按时间|按项目/.test(el.textContent || ''));
  if (!list) return JSON.stringify({ error: 'no-tablist' });
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  const to = tabs.find((el) => text(el) === ${JSON.stringify(toText)});
  const thumb = list.querySelector('[data-seg-thumb], .tl-seg-pill, .tl-seg-thumb, [class*="thumb" i], [class*="indicator" i], [class*="pill" i]');
  if (!thumb) return JSON.stringify({ error: 'no-thumb', tabs: tabs.map(text) });
  if (!tabs.length) return JSON.stringify({ error: 'no-tabs' });
  if (!to) return JSON.stringify({ error: 'no-target', tabs: tabs.map(text) });
  const before = { thumbs: thumb.getBoundingClientRect().toJSON(), list: list.getBoundingClientRect().toJSON() };
  const startLeft = before.thumbs.left;
  const t0 = performance.now();
  to.click();
  const frames = [];
  await new Promise((resolve) => {
    const tick = () => {
      const now = performance.now();
      const rect = thumb.getBoundingClientRect();
      frames.push({ t: Math.round(now - t0), x: Math.round((rect.left - startLeft) * 10) / 10, w: Math.round(rect.width) });
      if (now - t0 < 700) requestAnimationFrame(tick); else resolve();
    };
    requestAnimationFrame(tick);
  });
  const active = tabs.find((el) => el.getAttribute('aria-selected') === 'true');
  const thumbRect = thumb.getBoundingClientRect();
  const targetRect = to.getBoundingClientRect();
  const activeRect = (active || to).getBoundingClientRect();
  return JSON.stringify({
    frames,
    startLeft: Math.round(startLeft * 10) / 10,
    targetOffset: Math.round((targetRect.left - startLeft) * 10) / 10,
    coverDx: Math.round((thumbRect.left - activeRect.left) * 10) / 10,
    coverDw: Math.round(thumbRect.width - activeRect.width),
    // 指示器必须完整落在选中段落的盒子里；留 1–2px 内缩是 iOS 的正常样子，
    // 但不能越出边界（越界就是「选中块跑到隔壁」）。
    insideLeft: Math.round((thumbRect.left - targetRect.left) * 10) / 10,
    insideRight: Math.round((targetRect.right - thumbRect.right) * 10) / 10,
    // 中心对齐才是「看起来对」：允许 1–2px 内缩（iOS 的 thumb 本来就比段落窄一点），
    // 但中心偏了就是偏了。
    centerDx: Math.round(((thumbRect.left + thumbRect.width / 2) - (activeRect.left + activeRect.width / 2)) * 10) / 10,
    thumbHeight: Math.round(thumbRect.height),
    tabHeight: Math.round(to.getBoundingClientRect().height),
    selected: active ? text(active) : '',
    tabs: tabs.map(text),
    trackRight: Math.round(list.getBoundingClientRect().right),
    viewport: window.innerWidth,
    docWidth: document.scrollingElement.scrollWidth,
    thumbCount: list.querySelectorAll('[data-seg-thumb], .tl-seg-pill, .tl-seg-thumb, [class*="thumb" i], [class*="indicator" i], [class*="pill" i]').length,
  });
})()`;

/** Judge one trace. Returns facts, not opinions. */
function judge(trace, { expectSlide }) {
  const total = trace.targetOffset;
  const direction = total < 0 ? -1 : 1;
  // 归一化到「朝目标方向走了多少」：向左切时 x 是负的，直接比大小会把每一帧都判成越界。
  const progress = (x) => x * direction;
  // 位移区间用「实际走过的距离」而不是「段落边缘差」：指示器本来就在段落里内缩 1–2px，
  // 用边缘差会把静止后的帧也算成「还在路上」。
  const span = Math.abs(trace.frames[trace.frames.length - 1].x);
  const travelled = trace.frames.filter((frame) => {
    const walked = progress(frame.x);
    return walked > 0.5 && walked < span - 0.5;
  });
  const moving = trace.frames.filter((frame, index) => index > 0
    && Math.abs(progress(frame.x) - progress(trace.frames[index - 1].x)) > 0.5);
  const monotonic = travelled.every((frame, index, all) => index === 0 || progress(frame.x) >= progress(all[index - 1].x) - 0.5);
  // A strong ease-out spends its last 5% below the per-frame noise floor, so the
  // honest duration is 5%→95% of the travel, not first→last pixel.
  const at = (ratio) => {
    const hit = trace.frames.find((frame) => progress(frame.x) >= span * ratio);
    return hit ? hit.t : null;
  };
  const t05 = at(0.05);
  const t95 = at(0.95);
  const duration = t05 !== null && t95 !== null ? Math.max(0, t95 - t05) : 0;
  return {
    transitFrames: travelled.length,
    movingFrames: moving.length,
    durationMs: duration,
    monotonic,
    finalDelta: round(trace.frames[trace.frames.length - 1].x - total),
    total,
    direction,
    expectSlide,
  };
}

/** Put the control on `text` and let any crossfade settle, so a trace always
 *  starts from a known resting state (otherwise clicking an already-selected
 *  segment measures a 0px "travel" and every judgement is vacuous). */
async function selectTab(page, text) {
  const clicked = await page.eval(`(() => {
    const list = [...document.querySelectorAll('[role="tablist"]')].find((el) => /按时间|按项目/.test(el.textContent || ''));
    const tab = list && [...list.querySelectorAll('[role="tab"]')].find((el) => (el.textContent || '').trim() === ${JSON.stringify(text)});
    if (!tab) return false;
    tab.click();
    return true;
  })()`);
  await sleep(420);
  return clicked;
}

async function measure(page, { fromText, toText, expectSlide, label }) {
  if (!await selectTab(page, fromText)) {
    skip(label, `没有找到「${fromText}」`);
    return { ok: false, absent: true };
  }
  const raw = await page.eval(traceSwitch({ fromText, toText }));
  let trace;
  try { trace = JSON.parse(raw); } catch { trace = { error: `unreadable trace: ${String(raw).slice(0, 120)}` }; }
  if (trace.error) {
    skip(label, `trace unavailable: ${trace.error}`);
    return { ok: false, absent: trace.error === "no-thumb" || trace.error === "no-tablist", trace };
  }
  const facts = judge(trace, { expectSlide });
  log(`${label} · ${JSON.stringify(facts)}`);
  check(trace.insideLeft >= -0.5 && trace.insideRight >= -0.5, `${label}: 指示器完整落在选中段落内`,
    `内缩 left=${trace.insideLeft} right=${trace.insideRight}`);
  check(Math.abs(trace.centerDx) <= 1.5, `${label}: 静止时指示器中心对准选中标签`, `centerΔ=${trace.centerDx}px widthΔ=${trace.coverDw}px`);
  if (expectSlide) {
    check(facts.transitFrames >= 3, `${label}: 过渡中被采到 ≥3 帧（是滑动不是瞬移）`, `frames=${facts.transitFrames}`);
    check(facts.monotonic, `${label}: 位移单调，不来回抖`);
    check(facts.durationMs >= 60 && facts.durationMs <= 500, `${label}: 可见位移时长 60–500ms`,
      `${facts.durationMs}ms（5%→95%，不是 CSS 里的 duration）`);
  } else {
    check(facts.transitFrames <= 1, `${label}: 减动效时 1 帧内落位`, `frames=${facts.transitFrames}`);
  }
  return { ok: true, facts, trace };
}

async function restFacts(page) {
  return page.eval(`(() => {
    const text = (el) => (el.textContent || '').trim();
    const list = [...document.querySelectorAll('[role="tablist"]')].find((el) => /按时间|按项目/.test(el.textContent || ''));
    if (!list) return JSON.stringify({ error: 'no-tablist' });
    const thumb = list.querySelector('[data-seg-thumb], .tl-seg-pill, .tl-seg-thumb, [class*="thumb" i], [class*="indicator" i], [class*="pill" i]');
    if (!thumb) return JSON.stringify({ error: 'no-thumb' });
    const tabs = [...list.querySelectorAll('[role="tab"]')].map((el) => {
      const rect = el.getBoundingClientRect();
      return { label: text(el), selected: el.getAttribute('aria-selected') === 'true',
        left: Math.round(rect.left), right: Math.round(rect.right), h: Math.round(rect.height) };
    });
    const rect = thumb.getBoundingClientRect();
    const style = getComputedStyle(thumb);
    return JSON.stringify({
      tabs,
      thumb: { left: Math.round(rect.left), width: Math.round(rect.width), h: Math.round(rect.height),
        radius: style.borderRadius, background: style.backgroundColor, position: style.position,
        // 设计基线写的是 thumb 300ms；量出来的是声明值，不是观感值。
        transitionMs: Math.round((parseFloat(String(style.transitionDuration).split(",")[0]) || 0) * 1000),
        transitionProps: style.transitionProperty },
      track: { right: Math.round(list.getBoundingClientRect().right), h: Math.round(list.getBoundingClientRect().height),
        radius: getComputedStyle(list).borderRadius,
        background: getComputedStyle(list).backgroundColor },
      viewport: window.innerWidth,
      docWidth: document.scrollingElement.scrollWidth,
    });
  })()`);
}

/* ------------------------------------------------------------------- main */

const browserScript = `(() => {
  const store = new Map();
  const base = "http://127.0.0.1:8899";
  // 两台电脑：第二台不是当前机。设备树「同时只有一个 data-machine 值」只有在
  // 存得下第二台时才测得出来——一台机器时这条判据是空的。
  store.set("turnloom.machine.v2", JSON.stringify({
    version: 3,
    activeMachineId: "qa-redesign-machine",
    machines: [
      { machineId: "qa-redesign-machine", machineName: "DE 工作站", serverUrl: base,
        machineToken: "qa-machine-token",
        harnesses: [
          { id: "codex", name: "Codex Desktop", token: "qa-codex-token", kind: "codex", defaultHarness: true, online: true },
          { id: "pi", name: "PI-Desktop", token: "qa-pi-token", kind: "pi", online: true },
        ],
        defaultHarnessId: "codex", lastUsedAt: Date.now() },
      { machineId: "qa-second-machine", machineName: "书房笔记本", serverUrl: "http://127.0.0.1:8898",
        machineToken: "qa-second-token",
        harnesses: [
          { id: "codex-b", name: "Codex Desktop", token: "qa-codex-b-token", kind: "codex", defaultHarness: true, online: false },
        ],
        defaultHarnessId: "codex-b", lastUsedAt: Date.now() - 3600 * 1000 },
    ],
  }));
  const threads = [
    { id: "qa-r-a", title: "重设计：分段控件", status: { state: "running", thinking: true }, updatedAtMs: 1700000000000 },
    { id: "qa-r-b", title: "重设计：设备页", project: { key: "project:ui", name: "UI" }, status: { state: "ended" }, updatedAtMs: 1699999000000 },
    { id: "qa-r-c", title: "重设计：撤掉监控 Tab", status: { state: "failed" }, updatedAtMs: 1699998000000 },
    // 再补 9 行，只为让列表真的能滚：控件是否跟着滚走要用滚动的位移量来判。
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
      id: "qa-r-fill-" + n, title: "填充会话 " + n, project: { key: "project:ui", name: "UI" },
      status: { state: "ended" }, updatedAtMs: 1699990000000 - n * 100000,
    })),
  ];
  window.TurnloomNative = {
    secureGet(key) { return store.has(key) ? store.get(key) : null; },
    secureSet(key, value) { store.set(key, String(value)); return true; },
    secureRemove(key) { store.delete(key); return true; },
    haptic() {}, setLightBars() {}, scanQr() {},
    getAppInfo() {
      return JSON.stringify({ label: "Codex-Turnloom", version: "2.2.6", versionCode: 95, packageName: "com.codex.turnloom.app", cameraAvailable: false, updatesAvailable: true });
    },
    request(requestId, payloadJson) {
      let payload = {};
      try { payload = JSON.parse(payloadJson) || {}; } catch { payload = {}; }
      // 停止运行中会话是这轮唯一「从监控页搬到会话页」的动作，必须能看见请求发出去。
      window.__qaRequests = window.__qaRequests || [];
      window.__qaRequests.push({ url: String(payload.url || ""), method: String(payload.method || "GET") });
      const reply = (status, body) => setTimeout(() => window.__turnloomNativeHttpResult?.(requestId, JSON.stringify({ status, body })), 15);
      const route = String(payload.url || "").replace(/^https?:\\/\\/[^/]+/, "").split("?")[0];
      if (route === "/api/threads") return reply(200, JSON.stringify({ threads, total: threads.length, nextCursor: null }));
      if (route === "/api/health") return reply(200, JSON.stringify({ version: "2.2.6", appVersion: "2.2.6", appVersionCode: 95 }));
      if (route === "/api/interrupt") return reply(200, JSON.stringify({ ok: true }));
      if (route === "/api/harnesses") return reply(200, JSON.stringify({
        ok: true, protocol: "codex-turnloom", version: 2, machineId: "qa-redesign-machine", machineName: "DE 工作站",
        defaultHarnessId: "codex",
        harnesses: [
          { id: "codex", name: "Codex Desktop", token: "qa-codex-token", kind: "codex", defaultHarness: true, online: true },
          { id: "pi", name: "PI-Desktop", token: "qa-pi-token", kind: "pi", online: true },
        ],
      }));
      return reply(404, JSON.stringify({ error: "qa-stub" }));
    },
    cancelRequest() {}, downloadUpdate() {}, cancelUpdate() {}, installUpdate() {},
  };
})();`;

let preview = null;
let browser = null;

async function withFixturePage(page, mode, body) {
  const file = path.join(OUT, `fixture-${mode}.html`);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(file, fixtureHtml(mode), "utf8");
  await page.navigate(`file:///${file.replace(/\\/g, "/")}`);
  await sleep(150);
  return body();
}

const HAS_VIEW_TABLIST = `(() => Boolean([...document.querySelectorAll('[role="tablist"]')].find((el) => /按时间|按项目/.test(el.textContent || ''))))()`;

const PAIR_SCRIPT = `(() => {
  const url = document.querySelector('#connection-url');
  const code = document.querySelector('#connection-code');
  if (!url || !code) return 'no-form';
  const set = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set(url, 'http://127.0.0.1:8899');
  set(code, 'qa-code');
  const submit = document.querySelector('.tl-connect-submit');
  if (!submit) return 'no-submit';
  submit.click();
  return 'submitted';
})()`;

/** 每次导航都会拿到一份全新的 stub store，所以「直接恢复会话」这一步不保证；
 *  进不去就走手动配对表单，再等外壳出现。返回一句能写进报告的事实。 */
async function bootInto(base, label) {
  const waitForShell = async (ms) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (await browser.eval(HAS_VIEW_TABLIST).catch(() => false)) return true;
      await sleep(150);
    }
    return false;
  };
  await browser.navigate(base);
  if (await waitForShell(4_000)) return `${label}: 直接恢复会话`;
  const paired = await browser.eval(PAIR_SCRIPT).catch((error) => `eval-error:${error.message}`);
  if (paired !== "submitted") return `${label}: 配对入口不可用（${paired}）`;
  return (await waitForShell(25_000)) ? `${label}: 手动配对后进入` : `${label}: 配对后仍未进入`;
}

/** 设备面板：电脑 → 平台 → harness 三级。今天只有一台电脑、可能只有一个平台，
 *  所以判据不是「卡片有几张」，而是三条结构性事实：
 *  1) 带 data-machine 的节点同时只有一个值（跨机器串台是这类面板最容易出的错）；
 *  2) 平台卡在电脑卡之下可见；
 *  3) harness 行只在选中平台之后出现（选中前不预渲染，图 2 的「选了才露出」）。
 *  面板不存在时整段 SKIP —— 不拿「没有主语」的格子当绿。 */
/** 展开状态的行：平台卡用 aria-expanded，行容器用 data-open；两种都算。 */
const PANEL_STATE = `(() => {
  const platformCards = [...document.querySelectorAll('[data-plat], [data-platform], .plat')].map((el) => ({
    key: el.getAttribute('data-plat') || el.getAttribute('data-platform') || '',
    open: el.getAttribute('aria-expanded') === 'true' || el.getAttribute('data-open') === 'true',
    text: (el.textContent || '').trim().slice(0, 16),
  }));
  const openContainers = [...document.querySelectorAll('[data-open="true"]')];
  // 行只有在「最近的 data-open 祖先」是打开的时候才算露出来：分支容器本身是
  // 打开的，所以不能只看容器里有没有行，否则收起平台的行走廊也会被算进来。
  const rows = [...new Set([...document.querySelectorAll('[data-harness]')]
    .filter((el) => {
      const holder = el.closest('[data-open]');
      return !holder || holder.getAttribute('data-open') === 'true';
    })
    .map((el) => el.getAttribute('data-harness')))];
  const machines = [...document.querySelectorAll('[data-machine]')].map((el) => el.getAttribute('data-machine'));
  // 值对了不等于挂对了：契约 §4 要求属性只挂在 .tl-platblock 上。这里只**记录**
  // 宿主，不在这里判红——那条判据归 Vera 的 check-device-panel.mjs，两处各写一份会漂。
  const machineHosts = [...document.querySelectorAll('[data-machine]')].map((el) => (
    el.closest('.tl-platblock') ? 'platblock' : String(el.className || el.tagName).split(/\\s+/)[0]));
  const deviceCards = [...document.querySelectorAll('.tl-devcard, [data-devcard]')].map((el) => ({
    active: el.getAttribute('data-active') === 'true',
    text: (el.textContent || '').trim().slice(0, 20),
  }));
  return JSON.stringify({
    machines, machineHosts, uniqueMachines: [...new Set(machines)], deviceCards,
    platforms: platformCards, openPlatforms: platformCards.filter((entry) => entry.open).length,
    rows, scoped: rows.length > 0 && Boolean(document.querySelector('[data-open]')),
    text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 180),
  });
})()`;

// 2.2.7 第 4 项：一个图标家族、一套尺寸阶梯、一条线宽、与文字同轴。
// 品牌 logo（.tl-brand）是产品标记，不在规则内；其余 svg 一律按 Lucide 的
// 14/16/20/22、stroke 2 来审，尺寸用渲染后的短边而不是声明值。
const ICON_AUDIT = `(() => {
  const svgs = [...document.querySelectorAll('svg')].filter((s) => !s.closest('.tl-brand'));
  const strokes = new Set(); const sizes = new Set(); const mismatched = [];
  let counted = 0;
  for (const s of svgs) {
    const cs = getComputedStyle(s);
    const sw = Number(s.getAttribute('stroke-width') || cs.strokeWidth || 0);
    if (sw) strokes.add(Math.round(sw * 10) / 10);
    const r = s.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    counted += 1;
    sizes.add(Math.round(Math.min(r.width, r.height)));
    const row = s.closest('button, a, [role="button"], .tl-current-device, .tl-runstrip-head, .tl-hrow, .tl-platcard');
    if (!row) continue;
    const rr = row.getBoundingClientRect();
    if (rr.height > 64) continue; // multi-line rows: the label is not one baseline
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    let textTop = null, textBottom = null;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.nodeValue || !node.nodeValue.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const tr = range.getBoundingClientRect();
      if (!tr.width || !tr.height) continue;
      textTop = textTop === null ? tr.top : Math.min(textTop, tr.top);
      textBottom = textBottom === null ? tr.bottom : Math.max(textBottom, tr.bottom);
    }
    if (textTop === null) continue;
    // Icon-above-label (the bottom tab bar) is a deliberate stack, not a
    // misalignment: only compare when the label actually sits beside the icon.
    if (textTop >= r.bottom - 1 || textBottom <= r.top + 1) continue;
    const d = Math.round(((r.top + r.height / 2) - (textTop + textBottom) / 2) * 10) / 10;
    if (Math.abs(d) > 1) mismatched.push({ d, cls: String(row.className).slice(0, 26), size: Math.round(Math.min(r.width, r.height)) });
  }
  return { icons: counted, strokes: [...strokes].sort((a, b) => a - b), sizes: [...sizes].sort((a, b) => a - b), mismatched };
})()`;

async function auditIcons(screenLabel) {
  const facts = await browser.eval(ICON_AUDIT);
  if (!facts.icons) { skip(`图标体系:${screenLabel}`, "这一屏没有可见 svg"); return; }
  check(facts.strokes.every((s) => s === 2), `图标线宽统一 2（${screenLabel}）`, `strokes=${facts.strokes.join(",")}`);
  check(facts.sizes.every((s) => [14, 16, 20, 22].includes(s)), `图标尺寸只取 14/16/20/22（${screenLabel}）`, `sizes=${facts.sizes.join(",")}`);
  check(facts.mismatched.length === 0, `图标与标签垂直中心差 ≤1px（${screenLabel}）`,
    facts.mismatched.length ? JSON.stringify(facts.mismatched.slice(0, 3)) : `${facts.icons} 个图标`);
  // 文字字形不是图标：`›`、`⌄`、`⌕`、`✓` 这类是 NB3 在报告里清掉的那一类，
  // 屏幕上也一样要求。终端提示符 `>_` 不在字符集里，不会被误判。
  const glyphs = await browser.eval(`(() => {
    const bad = [];
    for (const el of document.querySelectorAll('*')) {
      if (el.children.length) continue;
      const t = (el.textContent || '').trim();
      if (/^[›‹»«‣→⌄⌕✓✔]$/.test(t)) bad.push({ t, cls: String(el.className).slice(0, 30) });
    }
    return bad;
  })()`);
  check(glyphs.length === 0, `没有拿文字字形当图标（${screenLabel}）`, JSON.stringify(glyphs.slice(0, 4)));
}

async function probeDevicePanel() {
  // 入口可能是底栏「设备」，也可能是会话页头部的常驻设备卡——两种都认。
  const entry = await browser.eval(`(() => {
    const tab = [...document.querySelectorAll('[role="tab"], .tl-tabbar button')]
      .find((el) => (el.textContent || '').trim() === '设备');
    if (tab) { tab.click(); return 'tab'; }
    const card = document.querySelector('[data-qa="device-panel"], [data-qa="device"], [class*="devbar"], [aria-label*="设备"]');
    if (card) { card.click(); return 'card'; }
    return '';
  })()`);
  if (!entry) {
    skip("设备面板", "还没有入口（底栏无「设备」、头部无设备卡）");
    return;
  }
  await sleep(800);

  const facts = JSON.parse(await browser.eval(PANEL_STATE));
  log(`设备面板（入口=${entry}）· ${JSON.stringify(facts)}`);

  if (facts.machines.length === 0) {
    skip("设备面板:data-machine", "面板里没有 data-machine 节点（控件未落地）");
  } else {
    check(facts.uniqueMachines.length === 1, "设备面板：data-machine 同时只有一个值",
    `${facts.uniqueMachines.join(",")} · 宿主 ${[...new Set(facts.machineHosts)].join("/")}（挂对位置由 check-device-panel.mjs 判）`);
  }
  // 夹具里存了两台电脑：两张卡都在，但只有当前那台渲染平台。
  check(facts.deviceCards.length >= 2, "设备面板：记得住第二台电脑（卡片 ≥2）",
    facts.deviceCards.map((card) => `${card.text.split("\\n")[0]}${card.active ? "(当前)" : ""}`).join(" / ") || "0 张");
  if (facts.platforms.length === 0) {
    skip("设备面板:平台卡", "没有平台卡（data-plat / data-platform / .plat）");
    return;
  }
  check(facts.platforms.length >= 1, "设备面板：至少一张平台卡", facts.platforms.map((entry2) => entry2.text).join(" / "));
  // 「选了才露出」的正确形状：同时最多一个平台展开；当前平台默认展开是合理设计。
  check(facts.openPlatforms <= 1, "设备面板：同时最多一个平台展开 harness", `open=${facts.openPlatforms}/${facts.platforms.length}`);
  check(facts.rows.length > 0, "设备面板：展开的平台下看得见 harness 行", `rows=${facts.rows.join(",") || "none"}`);

  if (facts.platforms.length < 2) {
    skip("设备面板:换平台", "只有一张平台卡（单平台是常态），换平台不可测");
    await browser.screenshot(path.join(OUT, "device-panel.png"));
    return;
  }
  const opened = await browser.eval(`(() => {
    const cards = [...document.querySelectorAll('[data-plat], [data-platform], .plat')];
    const closed = cards.find((el) => el.getAttribute('aria-expanded') !== 'true' && el.getAttribute('data-open') !== 'true');
    if (!closed) return '';
    closed.click();
    return closed.getAttribute('data-plat') || closed.getAttribute('data-platform') || 'clicked';
  })()`);
  await sleep(800);
  const after = JSON.parse(await browser.eval(PANEL_STATE));
  log(`设备面板 · 换到「${opened}」后 · ${JSON.stringify({ open: after.openPlatforms, rows: after.rows })}`);
  check(Boolean(opened), "设备面板：另一张平台卡可点", String(opened));
  check(after.openPlatforms <= 1, "设备面板：换平台后仍只有一个平台展开", `open=${after.openPlatforms}`);
  check(after.rows.length > 0 && after.rows.join(",") !== facts.rows.join(","),
    "设备面板：换平台后行换成了那一家的", `${facts.rows.join(",") || "none"} → ${after.rows.join(",") || "none"}`);
  await browser.screenshot(path.join(OUT, "device-panel.png"));
}
async function main() {
  const cdpPort = Number(flag("cdp-port", "0")) || await freePort();
  browser = await new CDP({ port: cdpPort, width: 390, height: 844, scale: 3 }).launch();

  // ---- 1. 夹具自证：同一个测量函数必须能区分滑动与瞬移 ------------------
  log("== 夹具自证 ==");
  await withFixturePage(browser, "slide", async () => {
    await measure(browser, { fromText: "按时间", toText: "按项目", expectSlide: true, label: "fixture/slide" });
  });
  expectingFailure = true;
  expectedFailHits = 0;
  await withFixturePage(browser, "snap", async () => {
    await measure(browser, { fromText: "按时间", toText: "按项目", expectSlide: true, label: "fixture/snap" });
  });
  expectingFailure = false;
  check(expectedFailHits > 0, "夹具自证：瞬移夹具被同一条判据判失败（判据有牙齿）", `expectedFails=${expectedFailHits}`);

  if (!FIXTURE_ONLY) {
    const distIndex = path.join(APP, "dist", "index.html");
    if (has("build")) {
      // 发版门禁用：先把当前源码打成 bundle，免得量的是上一轮的 dist。
      log("building app/dist from source …");
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(APP, "node_modules/vite/bin/vite.js"), "build"], { cwd: APP, stdio: "ignore", windowsHide: true });
        child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`vite build exited ${code}`))));
        child.on("error", reject);
      });
    }
    if (!fs.existsSync(distIndex)) {
      skip("app bundle", "app/dist 不存在 —— 先 npm run app:build");
    } else {
      log(`bundle: app/dist built ${new Date(fs.statSync(distIndex).mtimeMs).toISOString()}${has("build") ? " (just rebuilt)" : ""}`);
      // Vera 00:37 的教训：同一个 report.json 混进过别人 00:27 的 WIP build。
      // 证据里必须钉住 asset 文件名与字节数，否则「我这边过了」过的是别的包。
      const distHtml = fs.readFileSync(distIndex, "utf8");
      const assetName = (distHtml.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/) || [])[1] || "(unknown)";
      const assetPath = path.join(APP, "dist", "assets", assetName);
      log(`asset: ${assetName} · ${fs.existsSync(assetPath) ? fs.statSync(assetPath).size : "?"} B`);
      log("== 真 bundle ==");
      const port = await freePort();
      preview = spawn(process.execPath, [
        path.join(APP, "node_modules/vite/bin/vite.js"), "preview",
        "--port", String(port), "--strictPort", "--host", "127.0.0.1",
      ], { cwd: APP, stdio: "ignore", windowsHide: true });
      const base = `http://127.0.0.1:${port}/`;
      await waitForHttp(base);
      const seedScript = await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: browserScript });

      const viewports = [390, 360, 320];
      for (const width of viewports) {
        await browser.setViewport(width, 844, 2);
        await browser.clearStorage(base);
        log(await bootInto(base, `${width}px`));

        const label = `${width}px`;
        const segmentPresent = await browser.eval(`Boolean(document.querySelector('[role="tablist"]'))`);
        const thumbPresent = await browser.eval(`(() => {
          const list = [...document.querySelectorAll('[role="tablist"]')].find((el) => /按时间|按项目/.test(el.textContent || ''));
          if (!list) return false;
          return Boolean(list.querySelector('[data-seg-thumb], .tl-seg-pill, .tl-seg-thumb, [class*="thumb" i], [class*="indicator" i], [class*="pill" i]'));
        })()`);
        if (!segmentPresent || !thumbPresent) {
          const why = !segmentPresent ? "没有 role=tablist" : "tablist 里没有滑动指示器（仍是 .tl-filter-chip 两个独立按钮）";
          if (REQUIRE) check(false, `${label}: 分段控件未落地`, why);
          else skip(`${label}: 分段控件未落地`, why);
          continue;
        }

        // 列表默认落在「按项目」（分组收起），平铺的「按时间」才看得全行；
        // 滚动探针与后面的采样都从那里开始。
        await selectTab(browser, "按时间");
        const restFactsRaw = JSON.parse(await restFacts(browser));
        log(`${label} · rest · ${JSON.stringify(restFactsRaw)}`);
        // 盒子高不等于可点：38px 的按钮躺在 44px 的轨道里，上下的 padding 属于轨道，
        // 点在那里不会选中。这条带子要用两把尺子同时量，少一把就会重犯上一轮的错误：
        //   声明值 —— rect + ::before 的 inset，这是 CSS 契约，精确到 0.1px；
        //   实测值 —— elementFromPoint 逐 0.1px 扫出首末行，这是手指真的能点到的范围。
        // 这台 headless 的命中测试把每个盒子的上沿都提前 ~0.95px（连 300px 处的纯黑
        // div 也一样），所以实测边界只能和**同一把尺子量的轨道**比，不能和 rect 比；
        // 拿 rect 当基准会把健康实现判成「冒出 1px」。
        const band = JSON.parse(await browser.eval(`(() => {
          const list = [...document.querySelectorAll('[role="tablist"]')].find((el) => /按时间|按项目/.test(el.textContent || ''));
          const tabs = [...list.querySelectorAll('[role="tab"]')];
          const track = list.getBoundingClientRect();
          const STEP = 0.1;
          const out = tabs.map((tab) => {
            const rect = tab.getBoundingClientRect();
            const cx = Math.round(rect.left + rect.width / 2);
            const owns = (hit) => Boolean(hit && (hit === tab || tab.contains(hit) || hit.closest('[role="tab"]') === tab));
            // 轨道自己也不是矩形：两端是半径 22 的胶囊，按中心 x 扫出来的首末行
            // 就是「整条轨道」的上沿下沿，和单元格用的是同一个 y、同一把尺子。
            const scan = (predicate) => {
              let first = null;
              let last = null;
              for (let y = track.top - 6; y <= track.bottom + 6; y += STEP) {
                if (predicate(document.elementFromPoint(cx, y))) {
                  if (first === null) first = y;
                  last = y;
                }
              }
              return { first: first === null ? null : Math.round(first * 100) / 100,
                last: last === null ? null : Math.round((last + STEP) * 100) / 100 };
            };
            const band = scan(owns);
            // 清掉单元格的 ::before 再扫一次：这时同一列最上面的是轨道本身。
            const style = document.createElement('style');
            style.textContent = '*::before{content:none!important}';
            document.head.appendChild(style);
            const rail = scan((hit) => Boolean(hit && (hit === list || list.contains(hit))));
            style.remove();
            const bandTop = band.first;
            const bandBottom = band.last;
            const railTop = rail.first;
            const railBottom = rail.last;
            const outsideTop = owns(document.elementFromPoint(cx, (railTop ?? track.top) - 1.2));
            const outsideBottom = owns(document.elementFromPoint(cx, (railBottom ?? track.bottom) + 1.2));
            // ::before 补的命中带必须留在轨道里：越出 1px，就会盖住轨道外的
            // 兄弟元素（列表、标题行），点轨道边缘会命中一整段看不见的东西。
            const pseudo = getComputedStyle(tab, '::before');
            const hasPseudo = pseudo.content && pseudo.content !== 'none';
            const insetTop = hasPseudo ? (parseFloat(pseudo.top) || 0) : 0;
            const insetBottom = hasPseudo ? (parseFloat(pseudo.bottom) || 0) : 0;
            const cssTop = rect.top + insetTop;
            const cssBottom = rect.bottom - insetBottom;
            const probes = [bandTop + 0.5, track.top + track.height / 2, bandBottom - 0.5]
              .map((y) => owns(document.elementFromPoint(cx, y)));
            return { label: (tab.textContent || '').trim(), boxH: Math.round(rect.height), probes,
              bandTop, bandBottom, bandH: bandTop === null ? null : Math.round((bandBottom - bandTop) * 10) / 10,
              railTop, railBottom, railH: railTop === null ? null : Math.round((railBottom - railTop) * 10) / 10,
              outsideTop, outsideBottom,
              cssTop: Math.round(cssTop * 10) / 10, cssBottom: Math.round(cssBottom * 10) / 10,
              overflowTop: Math.round((track.top - cssTop) * 10) / 10,
              overflowBottom: Math.round((cssBottom - track.bottom) * 10) / 10 };
          });
          return JSON.stringify({ trackH: Math.round(track.height), trackTop: Math.round(track.top * 10) / 10,
            trackBottom: Math.round(track.bottom * 10) / 10, step: STEP, out });
        })()`));
        const bandText = band.out.map((tab) => `${tab.label}: ${tab.bandTop}–${tab.bandBottom}（高 ${tab.bandH}）`).join(" / ");
        const railText = band.out.map((tab) => `${tab.railTop}–${tab.railBottom}（高 ${tab.railH}）`).join(" / ");
        const trackText = `轨道 rect ${band.trackTop}–${band.trackBottom}（高 ${band.trackH}）`;
        // 口径（NB3 01:03）：带高 44，且整条不越出轨道。声明值先说死。
        check(band.out.every((tab) => tab.overflowTop <= 0.1 && tab.overflowBottom <= 0.1
          && Math.abs((tab.cssBottom - tab.cssTop) - 44) <= 0.1),
          `${label}: 声明命中带 44 且与轨道同界（::before −3px）`,
          band.out.map((tab) => `${tab.label}: ${tab.cssTop}–${tab.cssBottom} · 越出 上${tab.overflowTop}/下${tab.overflowBottom}`).join(" / "));
        // 实测：同一个 y 上，单元格的首末行必须和轨道自己的首末行对齐。
        check(band.out.every((tab) => tab.bandTop !== null && tab.railTop !== null
          && Math.abs(tab.bandTop - tab.railTop) <= 0.15 && Math.abs(tab.bandBottom - tab.railBottom) <= 0.15),
          `${label}: 实测命中带 ≡ 轨道（同一把尺子逐 0.1px 扫）`,
          `带 ${bandText} · 轨道 ${railText} · 边界差 ${band.out.map((tab) => `${Math.round((tab.bandTop - tab.railTop) * 100) / 100}/${Math.round((tab.bandBottom - tab.railBottom) * 100) / 100}`).join(",")}`);
        check(band.out.every((tab) => !tab.outsideTop && !tab.outsideBottom),
          `${label}: 轨道外 1.2px 不可点（没有看不见的可点区域）`,
          band.out.map((tab) => `${tab.label}:上${tab.outsideTop ? "命中" : "空"}/下${tab.outsideBottom ? "命中" : "空"}`).join(" "));
        check(band.out.every((tab) => tab.probes.every(Boolean)),
          `${label}: 带子首/中/尾都归这一段`, band.out.map((tab) => `${tab.label}:h${tab.boxH}:${tab.probes.map((hit) => (hit ? 1 : 0)).join("")}`).join(" "));
        log(`${label} · 边界 · ${trackText} · 实测命中带 ${bandText}`);
        // UI_SPEC 0.4：正文最小 11px，新设计不得再往下压。只量这轮动过的表面
        //（分段控件 / 运行条 / 设备树）——底栏 10px 是 2.2.5 就有的，不该记在 2.2.6 账上。
        const typeFacts = JSON.parse(await browser.eval(`(() => {
          const scope = '[class*="tl-segmented"], [class*="tl-run"], [class*="tl-dev"], [class*="tl-harness"], [class*="tl-branch"]';
          const sizes = [];
          let globalMin = null;
          for (const el of document.querySelectorAll('body *')) {
            if (!el.childNodes || !el.childNodes.length) continue;
            const hasText = [...el.childNodes].some((node) => node.nodeType === 3 && (node.textContent || '').trim());
            if (!hasText) continue;
            const style = getComputedStyle(el);
            if (style.visibility === 'hidden' || style.display === 'none') continue;
            const size = parseFloat(style.fontSize) || 0;
            globalMin = globalMin === null ? size : Math.min(globalMin, size);
            if (!el.closest(scope)) continue;
            sizes.push({ size, text: (el.textContent || '').trim().slice(0, 14), cls: String(el.className || '').slice(0, 28) });
          }
          const small = sizes.filter((entry) => entry.size < 11 - 0.01);
          return JSON.stringify({ smallest: sizes.length ? Math.min(...sizes.map((entry) => entry.size)) : null,
            globalMin, count: sizes.length, small: small.slice(0, 6) });
        })()`));
        check(typeFacts.small.length === 0, `${label}: 重设计表面没有小于 11px 的文字（UI_SPEC）`,
          `scope最小=${typeFacts.smallest}px 共${typeFacts.count}段` + (typeFacts.small.length ? ` · ${typeFacts.small.map((entry) => `${entry.text}@${entry.size}`).join(",")}` : "") + ` · 全屏最小=${typeFacts.globalMin}px`);
        check(Math.abs(restFactsRaw.thumb.transitionMs - 300) <= 1, `${label}: thumb 过渡 300ms（报告基线）`,
          `${restFactsRaw.thumb.transitionMs}ms · ${restFactsRaw.thumb.transitionProps}`);
        // 基线（NB3 00:48 裁定）：胶囊 999/999，不是圆角矩形。等价判据是半径 ≥ 自身高度的一半。
        const radiusPx = (value) => parseFloat(String(value)) || 0;
        check(radiusPx(restFactsRaw.track.radius) >= restFactsRaw.track.h / 2 - 0.5
          && radiusPx(restFactsRaw.thumb.radius) >= restFactsRaw.thumb.h / 2 - 0.5,
          `${label}: 轨道与 thumb 都是胶囊（半径 ≥ 高度一半）`,
          `track=${restFactsRaw.track.radius}/${restFactsRaw.track.h}px thumb=${restFactsRaw.thumb.radius}/${restFactsRaw.thumb.h}px`);
        check(restFactsRaw.docWidth <= restFactsRaw.viewport + 0.5 && restFactsRaw.track.right <= restFactsRaw.viewport + 0.5,
          `${label}: 无横向溢出`, `doc=${restFactsRaw.docWidth} viewport=${restFactsRaw.viewport} track.right=${restFactsRaw.track.right}`);
        check(restFactsRaw.thumb.position === "absolute", `${label}: 指示器是绝对定位的独立层`, restFactsRaw.thumb.position);
        check(restFactsRaw.thumb.h >= 32 && restFactsRaw.thumb.h <= restFactsRaw.track.h - 2,
          `${label}: 指示器高度落在轨道内`, `thumb=${restFactsRaw.thumb.h} track=${restFactsRaw.track.h}`);

        // Vera 判据 5：控件在滚动容器里，翻到列表中段就切不了视图。量位移，不靠看。
        // 不猜滚动宿主：把最后一行滚进视野，再看控件跟着走了多少。
        const pinBefore = JSON.parse(await browser.eval(`(() => {
          const list = [...document.querySelectorAll('[role="tablist"]')].find((el) => /按时间|按项目/.test(el.textContent || ''));
          if (!list) return JSON.stringify({ error: 'no-tablist' });
          const before = Math.round(list.getBoundingClientRect().top);
          const rows = [...document.querySelectorAll('[data-thread-id]')];
          const last = rows[rows.length - 1];
          if (last) last.scrollIntoView({ block: 'end', behavior: 'instant' });
          const moved = [];
          for (const el of document.querySelectorAll('*')) {
            if (el.scrollTop > 0) moved.push(String(el.className || el.tagName).slice(0, 40) + ':' + Math.round(el.scrollTop));
          }
          return JSON.stringify({ before, rows: rows.length, moved, docY: Math.round(window.scrollY) });
        })()`));
        await sleep(300);
        const pinAfter = await browser.eval(`(() => {
          const list = [...document.querySelectorAll('[role="tablist"]')].find((el) => /按时间|按项目/.test(el.textContent || ''));
          return list ? Math.round(list.getBoundingClientRect().top) : null;
        })()`);
        if (pinBefore.error) {
          skip(`${label}: 控件是否随列表滚走`, pinBefore.error);
        } else {
          // NB3 00:50：先证明被测对象有被测量的余地。列表只挪了 20px 就断言「控件没动」
          // 是空话，记 inconclusive，不记 PASS。
          const scrolledPx = Math.max(pinBefore.docY || 0, ...(pinBefore.moved || []).map((entry) => Number(String(entry).split(":").pop()) || 0));
          if (scrolledPx < 100) {
            skip(`${label}: 控件不随列表滚走`, `inconclusive：列表实际只滚了 ${scrolledPx}px（rows=${pinBefore.rows}）`);
          } else {
            check(pinAfter !== null && Math.abs(pinAfter - pinBefore.before) <= 1,
              `${label}: 控件不随列表滚走（Vera 判据 5）`,
              `top ${pinBefore.before} → ${pinAfter}，列表滚了 ${scrolledPx}px`);
          }
        }
        await browser.eval(`(() => {
          window.scrollTo({ top: 0, behavior: 'instant' });
          for (const el of document.querySelectorAll('*')) if (el.scrollTop > 0) el.scrollTop = 0;
        })()`);
        await sleep(200);

        await measure(browser, { fromText: "按时间", toText: "按项目", expectSlide: true, label: `${label} 按时间→按项目` });
        await measure(browser, { fromText: "按项目", toText: "按时间", expectSlide: true, label: `${label} 按项目→按时间` });
        await browser.screenshot(path.join(OUT, `segmented-${width}.png`));
      }

      // ---- 撤监控 Tab 的门禁：会话页必须能「不打开会话就停止」运行中的会话 --
      // 监控页唯一独占的动作就是这一条。先删 Tab 后补入口 = 真机少一个能用的动作，
      // 所以只要「N 运行中」入口出现了，就同时要求监控 Tab 已经不在了。
      await browser.setViewport(390, 844, 2);
      await browser.clearStorage(base);
      log(await bootInto(base, "running-stop"));
      await selectTab(browser, "按时间");
      const runningEntry = await browser.eval(`(() => {
        const nodes = [...document.querySelectorAll('button, [role="button"], [role="tab"]')];
        const hit = nodes.find((el) => /(\\d+)\\s*运行中|运行中\\s*\\d+/.test((el.textContent || "").trim()));
        return hit ? (hit.textContent || "").trim().slice(0, 24) : null;
      })()`);
      if (!runningEntry) {
        skip("运行中入口", "会话页还没有「N 运行中」入口（监控页尚未撤，门禁暂不触发）");
      } else {
        log(`运行中入口 · 「${runningEntry}」`);
        check(/\b1\b/.test(runningEntry), "运行中入口的计数 = 夹具里运行中的条数", runningEntry);
        const monitorTab = await browser.eval(`Boolean(document.querySelector('button[aria-label="监控"]'))`);
        check(!monitorTab, "监控 Tab 已撤（只在运行中入口已落地时才要求）");
        // 2.4.0：头部拆成两个独立胶囊（运行中 / 待你处理），命中带从「头盒」
        // 下放到每个胶囊：34px 胶囊 + 上下各 5px = 44，且带不出条盒、不压上方的
        // 分段控件与下方的运行行。两把尺子都在同一页同一位置扫，避免 rect 与
        // elementFromPoint 的 0.9px 偏差被算成越界。
        const strip = await browser.eval(`(() => {
          const head = document.querySelector('.tl-runstrip-head');
          const pill = document.querySelector('.tl-runstrip-pill[data-kind="running"]') || document.querySelector('.tl-runstrip-pill');
          if (!head || !pill) return { found: false };
          const wrap = head.closest('.tl-runstrip') || head.parentElement;
          const pb = pill.getBoundingClientRect();
          const cx = pb.left + pb.width / 2;
          const scan = (from, to, match) => {
            let top = null, bottom = null;
            for (let y = from; y <= to; y += 0.1) {
              const el = document.elementFromPoint(cx, y);
              if (el && match(el)) { if (top === null) top = Math.round(y * 10) / 10; bottom = Math.round(y * 10) / 10; }
            }
            return { top, bottom };
          };
          const kill = document.createElement('style');
          kill.textContent = '.tl-runstrip-pill::before{content:none!important}';
          document.head.appendChild(kill);
          const own = scan(pb.top - 20, pb.bottom + 20, (el) => el === pill || pill.contains(el));
          kill.remove();
          const band = scan(pb.top - 20, pb.bottom + 20, (el) => el === pill || pill.contains(el));
          const wrapOwn = scan(pb.top - 20, pb.bottom + 20, (el) => el === wrap || wrap.contains(el));
          const rows = [...document.querySelectorAll('.tl-runrow-open, .tl-runrow-stop')].map((el) => el.getBoundingClientRect());
          const overlaps = rows.filter((r) => r.bottom > band.top + 0.2 && r.top < band.bottom - 0.2).length;
          const track = document.querySelector('.tl-segmented');
          const tb = track ? track.getBoundingClientRect() : null;
          const round = (value) => Math.round(value * 10) / 10;
          return { found: true, band, own, wrapOwn, rows: rows.length, rowOverlaps: overlaps,
            trackBottom: tb ? round(tb.bottom) : null,
            pillBox: { top: round(pb.top), bottom: round(pb.bottom), h: round(pb.height) } };
        })()`);
        check(strip.found, "运行条头部在页面上（命中带可量）");
        if (strip.found) {
          const span = (box) => (box.top === null ? 0 : Math.round((box.bottom - box.top + 0.1) * 10) / 10);
          const bandH = span(strip.band);
          const ownH = span(strip.own);
          const wrapH = span(strip.wrapOwn);
          // Same ruler on both sides: the band must fill the strip box exactly.
          const bandOk = Math.abs(bandH - wrapH) <= 0.2 && Math.abs(bandH - 44) <= 1;
          // 34px pill is scaled by the same 0.9px scan bias; the 5px collar on
          // each side is what the band adds, and that difference is bias-free.
          const pillOk = Math.abs(ownH - 34) <= 1 && Math.abs((bandH - ownH) - 10) <= 0.5;
          const insideOk = strip.band.top !== null && strip.wrapOwn.top !== null
            && strip.band.top >= strip.wrapOwn.top - 0.2 && strip.band.bottom <= strip.wrapOwn.bottom + 0.2;
          const rowsOk = strip.rowOverlaps === 0;
          const noStealAbove = strip.trackBottom === null || strip.band.top === null || strip.band.top >= strip.trackBottom - 0.2;
          check(bandOk && pillOk && insideOk && rowsOk && noStealAbove, "运行条命中带 44±0.2 · 胶囊自身 34 · 带不出条盒 · 不压分段控件 · 不压运行行",
            `带=${bandH} (${strip.band.top}–${strip.band.bottom}) · 胶囊=${ownH} (${strip.pillBox.top}–${strip.pillBox.bottom}) · 条盒=${strip.wrapOwn.top}–${strip.wrapOwn.bottom} (${wrapH}) · 分段底=${strip.trackBottom} · 行重叠=${strip.rowOverlaps}/${strip.rows}`);
        }
        // 2.2.7 第 4 项：胶囊要有 chevron，展开时转 180°——「展开/收起」纯文字
        // 是 NB3 7 屏复核里的同类问题。量完点两下复位，不影响后面的停止流程。
        const chevron = await browser.eval(`(async () => {
          const pill = document.querySelector('.tl-runstrip-pill[data-kind="running"]') || document.querySelector('.tl-runstrip-pill');
          if (!pill) return { found: false };
          const svg = pill.querySelector('svg');
          if (!svg) { pill.click(); await new Promise((r) => setTimeout(r, 400)); return { found: true, chevron: false }; }
          const collapsed = getComputedStyle(svg).transform;
          pill.click();
          await new Promise((r) => setTimeout(r, 400));
          const open = { transform: getComputedStyle(svg).transform, expanded: pill.getAttribute('aria-expanded') };
          pill.click();
          await new Promise((r) => setTimeout(r, 400));
          return { found: true, chevron: true, collapsed, open };
        })()`);
        if (chevron.found) {
          check(chevron.chevron, "运行条头部有 chevron（不是只有「展开/收起」文字）");
          if (chevron.chevron) {
            check(Boolean(chevron.open) && chevron.open.expanded === 'true' && /-1/.test(chevron.open.transform),
              "展开时 chevron 旋转 180°", `transform=${chevron.open && chevron.open.transform}`);
          }
        }
        await browser.eval(`(() => {
          const nodes = [...document.querySelectorAll('button, [role="button"], [role="tab"]')];
          const hit = nodes.find((el) => /(\\d+)\\s*运行中|运行中\\s*\\d+/.test((el.textContent || "").trim()));
          hit?.click();
        })()`);
        await sleep(600);
        const stopControl = await browser.eval(`(() => {
          const nodes = [...document.querySelectorAll('button, [role="button"]')];
          const stop = nodes.find((el) => /停止/.test(el.getAttribute('aria-label') || '') || /^停止$/.test((el.textContent || "").trim()));
          if (!stop) return 'missing';
          stop.click();
          return (stop.textContent || '').trim().slice(0, 12) || 'clicked';
        })()`);
        await sleep(900);
        const interrupt = JSON.parse(await browser.eval(`JSON.stringify((window.__qaRequests || []).filter((r) => /\\/api\\/interrupt/.test(r.url)))`));
        check(stopControl !== "missing", "运行中列表里有可点的停止入口", String(stopControl));
        check(interrupt.length > 0, "点停止真的发出 /api/interrupt", `requests=${interrupt.length}`);
      }
      await browser.screenshot(path.join(OUT, "running-entry-390.png"));

      await browser.clearStorage(base);
      log(await bootInto(base, "device-panel"));
      await probeDevicePanel();

      // ---- 2.2.8：连接页首屏 + 固定区瘦身 --------------------------------
      // The seed script re-inserts a paired registry on every new document, so
      // the connect screen needs it temporarily out of the way.
      await browser.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: seedScript.identifier });
      for (const [w, h] of [[390, 844], [320, 568]]) {
        await browser.setViewport(w, h, 2);
        await browser.clearStorage(base);
        await browser.navigate(base);
        const connect = await browser.eval(`(async () => {
          const end = Date.now() + 6000;
          while (Date.now() < end && !/扫码连接|正在连接/.test(document.body.innerText || '')) await new Promise((r) => setTimeout(r, 150));
          const primary = [...document.querySelectorAll('button')].find((el) => /扫码连接|正在连接/.test((el.textContent || '').trim()));
          if (!primary) return { found: false, text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 120) };
          const r = primary.getBoundingClientRect();
          const hero = document.querySelector('img[src*="connect-hero"], .tl-connect-hero');
          const img = hero && hero.tagName === 'IMG' ? hero : (hero ? hero.querySelector('img') || hero : null);
          const box = img ? img.getBoundingClientRect() : null;
          return { found: true, top: Math.round(r.top), bottom: Math.round(r.bottom), viewport: window.innerHeight,
            hero: Boolean(hero),
            heroH: box ? Math.round(box.height) : null,
            heroCentreOffset: box ? Math.round(((box.left + box.right) / 2 - window.innerWidth / 2) * 10) / 10 : null,
            overflow: document.documentElement.scrollWidth > window.innerWidth };
        })()`);
        check(connect.found && connect.bottom <= connect.viewport, `${w}px 连接页：主按钮在首屏内`, JSON.stringify(connect));
        if (connect.found) {
          // max-height:540 hides the hero by design (a short real screen keeps the
          // primary button in the first viewport); that counts as a pass, not as a
          // missing image. Above 540 the picture itself must be 90–121 and centred.
          const heroByDesign = !connect.hero && connect.viewport <= 540;
          check(heroByDesign || (connect.hero && connect.heroH !== null && connect.heroH >= 90 && connect.heroH <= 121 && Math.abs(connect.heroCentreOffset) <= 1),
            `${w}px 连接页：插图 90–121 高且居中`,
            heroByDesign ? `viewport=${connect.viewport} ≤540，插图按 max-height 规则隐藏` : `h=${connect.heroH} centreΔ=${connect.heroCentreOffset}`);
          check(!connect.overflow, `${w}px 连接页：插图不撑出横向滚动`);
        }
        await browser.screenshot(path.join(OUT, `connect-${w}.png`));
      }

      await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: browserScript });
      await browser.setViewport(390, 844, 2);
      await browser.clearStorage(base);
      log(await bootInto(base, "fixed-region"));
      const fixedRegion = await browser.eval(`(() => {
        const row = document.querySelector('.tl-current-device');
        const head = document.querySelector('.tl-thread-head');
        if (!row || !head) return { found: false };
        const rb = row.getBoundingClientRect();
        const hb = head.getBoundingClientRect();
        const cx = rb.left + rb.width / 2;
        let top = null, bottom = null;
        for (let y = rb.top - 18; y <= rb.bottom + 18; y += 0.1) {
          const el = document.elementFromPoint(cx, y);
          if (el && (el === row || row.contains(el))) { if (top === null) top = Math.round(y * 10) / 10; bottom = Math.round(y * 10) / 10; }
        }
        const scroller = document.querySelector('.tl-thread-scroll');
        const first = scroller ? scroller.querySelector('button, [role="button"], a') : null;
        const fr = first ? first.getBoundingClientRect() : null;
        return { found: true, drawn: Math.round(rb.height * 10) / 10,
          band: top === null ? 0 : Math.round((bottom - top + 0.1) * 10) / 10, bandTop: top, bandBottom: bottom,
          headTop: Math.round(hb.top * 10) / 10, headBottom: Math.round(hb.bottom * 10) / 10,
          firstRowTop: fr ? Math.round(fr.top * 10) / 10 : null };
      })()`);
      if (!fixedRegion.found) {
        skip("固定区:设备行", "会话页没有当前设备行（未进 shell）");
      } else {
        check(fixedRegion.drawn <= 32, "当前设备行绘制 ≤32px（瘦身后）", `drawn=${fixedRegion.drawn}`);
        check(fixedRegion.band >= 43.5, "当前设备行命中带 44±0.5", `band=${fixedRegion.band}`);
        check(fixedRegion.bandTop >= fixedRegion.headTop - 0.2 && fixedRegion.bandBottom <= fixedRegion.headBottom + 0.2,
          "命中带不越出固定区", `band=${fixedRegion.bandTop}–${fixedRegion.bandBottom} 固定区=${fixedRegion.headTop}–${fixedRegion.headBottom}`);
        check(fixedRegion.firstRowTop === null || fixedRegion.bandBottom <= fixedRegion.firstRowTop + 0.05,
          "命中带不压列表首行", `bandBottom=${fixedRegion.bandBottom} firstRow=${fixedRegion.firstRowTop}`);
      }
      // 320×568 is where the list actually overflows — the pinned check runs there.
      // 按项目视图默认折叠分组，列表不满一屏，先切到按时间（平铺）再滚。
      await browser.setViewport(320, 568, 2);
      await selectTab(browser, "按时间");
      await sleep(400);
      const pinned = await browser.eval(`(async () => {
        const at = (el) => (el ? Math.round(el.getBoundingClientRect().top * 10) / 10 : null);
        const pick = () => ({
          title: at(document.querySelector('.tl-thread-nav h1, .tl-thread-nav')),
          row: at(document.querySelector('.tl-current-device')),
          seg: at(document.querySelector('.tl-segmented')),
        });
        const sc = document.querySelector('.tl-thread-scroll');
        if (!sc) return { room: 0, scrolled: 0, before: pick(), after: pick(), note: 'no .tl-thread-scroll' };
        const room = Math.max(0, sc.scrollHeight - sc.clientHeight);
        const before = pick();
        sc.scrollTop = Math.min(600, room);
        await new Promise((r) => setTimeout(r, 350));
        const after = pick();
        const scrolled = sc.scrollTop;
        sc.scrollTop = 0;
        return { room, scrolled, before, after };
      })()`);
      if (pinned.room < 100) {
        skip("固定区:滚动不动", `列表无可滚动余量（room=${pinned.room}），这一格量不了`);
      } else {
        check(pinned.scrolled >= Math.min(600, pinned.room) - 1
          && ["title", "row", "seg"].every((k) => pinned.before[k] !== null && pinned.after[k] !== null && Math.abs(pinned.after[k] - pinned.before[k]) <= 1),
          "滚到底时标题 / 设备行 / 分段仍在固定区", JSON.stringify(pinned));
      }

      // ---- 2.2.7 第 4 项：图标体系（会话 / 设备 / 设置各审一遍）----------
      await browser.setViewport(390, 844, 2);
      await browser.clearStorage(base);
      log(await bootInto(base, "icon-system"));
      await auditIcons("会话");
      const goTab = async (name) => {
        await browser.eval(`(() => {
          const tab = [...document.querySelectorAll('[role="tab"], .tl-tabbar button')].find((el) => (el.textContent || '').trim() === ${JSON.stringify(name)});
          tab && tab.click();
        })()`);
        await sleep(700);
      };
      await goTab("设备");
      await auditIcons("设备");
      await goTab("设置");
      await auditIcons("设置");
      await browser.screenshot(path.join(OUT, "icon-system-390.png"));
      // 320 也要一对：窄档最容易把「图标 + 标签」挤成换行或错轴。
      await browser.setViewport(320, 568, 2);
      await goTab("会话");
      await auditIcons("会话320");
      await browser.screenshot(path.join(OUT, "icon-system-320.png"));

      // ---- reduced motion: the same tap must land in one frame -----------
      await browser.setViewport(390, 844, 2);
      await browser.clearStorage(base);
      log(await bootInto(base, "reduced-motion"));
      await browser.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
      await sleep(250);
      if (await browser.eval(`(() => {
        const list = [...document.querySelectorAll('[role="tablist"]')].find((el) => /按时间|按项目/.test(el.textContent || ''));
        return Boolean(list && list.querySelector('[data-seg-thumb], .tl-seg-pill, .tl-seg-thumb, [class*="thumb" i]'));
      })()`)) {
        await measure(browser, { fromText: "按时间", toText: "按项目", expectSlide: false, label: "reduced-motion" });
      } else if (REQUIRE) {
        check(false, "reduced-motion: 分段控件未落地");
      } else {
        skip("reduced-motion", "分段控件未落地");
      }
      await browser.send("Emulation.setEmulatedMedia", { features: [] });

      // ---- device tab: only report what exists, no verdict yet -----------
      await browser.clearStorage(base);
      log(await bootInto(base, "device-probe"));
      const deviceProbe = await browser.eval(`(() => {
        const tabs = [...document.querySelectorAll('[role="tab"], .tl-tabbar button')].map((el) => (el.textContent || '').trim());
        return JSON.stringify({ tabs, hasDeviceTab: tabs.includes('设备'), hasMonitorTab: tabs.includes('监控') });
      })()`);
      log(`tab bar · ${deviceProbe}`);
    }
  }
}

try {
  await main();
} catch (error) {
  check(false, "harness", error.message);
  try { log(`page text: ${String(await browser?.eval("document.body.innerText.slice(0, 300)")).replace(/\s+/g, " ")}`); } catch { /* page gone */ }
} finally {
  try { await browser?.close(); } catch { /* ignore */ }
  try { preview?.kill(); } catch { /* ignore */ }
  await sleep(150);
}

log(failures === 0 ? "RESULT: PASS" : `RESULT: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
