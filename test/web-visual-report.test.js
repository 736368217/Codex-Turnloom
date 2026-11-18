/**
 * Regression guards for the Web UI visual audit.
 *
 * The public/ companion page is loaded by the real 8787 dispatcher. These
 * checks are static (no browser needed in CI) but mirror the measured defects:
 * a light-blue "switch computer" button with 1.06:1 text, a model panel whose
 * last row sat under the composer textarea, a thread list covered by the
 * sidebar footer, an auth gate that still laid out the whole chat shell and
 * fired 401s, centered modals with no grabber, missing safe-area manifest
 * metadata, and a 391 KB history response containing two inline base64 images.
 */
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  capMessagesResponseForClient,
  compactOversizedMessageContent,
  offloadInlineImageForClient
} from "../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(path.join(ROOT, relative), "utf8");
const html = read("public/index.html");
const css = read("public/styles.app.css");
const app = read("public/app.js");
const server = read("server.js");
const manifest = read("public/site.webmanifest");

test("Web UI declares safe-area viewport, theme color and a light standalone manifest", () => {
  assert.match(html, /name="viewport" content="[^"]*viewport-fit=cover/);
  assert.match(html, /name="theme-color" content="#F2F2F7"/);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /rel="manifest" href="\/site\.webmanifest"/);
  assert.match(server, /"\.webmanifest":\s*"application\/manifest\+json; charset=utf-8"/);
  const parsed = JSON.parse(manifest);
  assert.equal(parsed.theme_color, "#F2F2F7");
  assert.equal(parsed.background_color, "#F2F2F7");
  assert.equal(parsed.display, "standalone");
  assert.equal(parsed.icons[0].src, "/assets/companion-mark.svg");
  assert.ok(statSync(path.join(ROOT, "public", "assets", "companion-mark.svg")).size > 0);
  // Bare href without a query keeps the server's cache-busting stamp working.
  assert.doesNotMatch(html, /site\.webmanifest\?/);
});

test("every secondary surface is a bottom sheet with a 36x6 grabber", () => {
  for (const id of ["hostSheet", "goalEditDialog", "appDialog", "messageActionSheet", "welcomeDialog"]) {
    // Look at the first 400 chars after the id: nested backdrops/card wrappers
    // close before the grabber, so a generic `<\/div>` regex would stop early.
    const block = new RegExp(`id="${id}"[\\s\\S]{0,400}class="sheet-grabber"`).exec(html);
    assert.ok(block, `${id} needs a grabber near its opening markup`);
  }
  assert.match(css, /\.sheet-grabber\s*\{[^}]*width:\s*36px/s);
  assert.match(css, /\.sheet-grabber\s*\{[^}]*height:\s*6px/s);
  assert.match(css, /\.sheet-grabber\s*\{[^}]*border-radius:\s*3px/s);
  assert.match(css, /\.welcome-dialog,\s*\.goal-edit-dialog\s*\{[^}]*align-items:\s*flex-end/s);
  assert.match(css, /#shell \.host-sheet-card\s*\{[^}]*background:\s*#FFFFFF/s);
  assert.doesNotMatch(css.slice(css.indexOf("Web UI 视觉检定修复层")), /host-sheet-card[^{]*\{[^}]*background:\s*#171a21/s);
});

test("switch-computer text is readable on the light More sheet", () => {
  const fixLayer = css.slice(css.indexOf("Web UI 视觉检定修复层"));
  assert.match(fixLayer, /#shell \.host-sheet-card button\.host-switch-computer\s*\{[^}]*color:\s*#1D4ED8/s);
  assert.match(fixLayer, /#shell \.host-sheet-card button\.host-switch-computer\s*\{[^}]*background:\s*#E8F0FF/s);
  // #1D4ED8 on #E8F0FF is 5.85:1; the old #F4F6FB on #E8F0FF was 1.06:1.
  assert.match(css, /#shell \.host-switch-computer\s*\{[^}]*min-height:\s*44px/s);
});

test("model panel is clipped above the composer and the thread list clears the footer", () => {
  const fixLayer = css.slice(css.indexOf("Web UI 视觉检定修复层"));
  assert.match(fixLayer, /#shell \.model-panel\s*\{[^}]*bottom:\s*calc\(100% \+ 10px\)/s);
  assert.match(fixLayer, /#shell \.model-panel\s*\{[^}]*max-height:\s*min\(360px,\s*calc\(100dvh - var\(--composer-height/s);
  assert.match(fixLayer, /#shell \.model-panel\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(fixLayer, /#shell \.model-list\s*\{[^}]*max-height:\s*180px/s);
  assert.match(fixLayer, /#shell \.thread-list\s*\{[^}]*padding-bottom:\s*88px\s*!important/s);
  assert.match(fixLayer, /#shell \.sidebar-footer\s*\{[^}]*min-height:\s*62px/s);
  assert.match(fixLayer, /#shell \.thread-list::-webkit-scrollbar[\s\S]*?display:\s*none/s);
});

test("secondary ink, type scale, focus ring and touch targets meet the audit floor", () => {
  const fixLayer = css.slice(css.indexOf("Web UI 视觉检定修复层"));
  assert.match(fixLayer, /--app-ink-3:\s*#5A6B80/);
  assert.match(fixLayer, /--t-11:\s*13px/);
  assert.match(fixLayer, /--composer-height:\s*141px/);
  assert.match(fixLayer, /outline:\s*3px solid #1D4ED8\s*!important/);
  assert.match(fixLayer, /#shell \.thread-more-button[\s\S]{0,400}min-height:\s*44px/s);
  assert.match(fixLayer, /#shell input\[type="checkbox"\][\s\S]{0,300}min-width:\s*24px/s);
  assert.match(fixLayer, /#shell \.conversation-title > h2\s*\{[^}]*text-overflow:\s*ellipsis/s);
  assert.match(fixLayer, /max-width:\s*1400px/);
  assert.match(html, /id="drawerOverlay"[^>]*tabindex="-1"/);
  assert.match(app, /sidebar\.inert = Boolean\(state\.sidebarCollapsed\)/);
});

test("auth gate removes the chat shell from layout, focus and initial requests", () => {
  assert.match(app, /function setShellAuthLocked\(locked\)/);
  assert.match(app, /shell\.inert = Boolean\(locked\)/);
  assert.match(app, /document\.body\.classList\.add\("auth-locked"\)/);
  assert.match(css, /body\.auth-locked #shell\s*\{\s*display:\s*none\s*!important/s);
  assert.match(app, /function startBackgroundServices\(\)/);
  assert.match(app, /if \(state\.authLocked \|\| !state\.config\) return;/);
  assert.match(app, /async function bootstrap[\s\S]*startBackgroundServices\(\);/);
  // The old bootstrap unconditionally fired /api/projects even when locked.
  const bootstrap = /async function bootstrap\(\)[\s\S]*?\n}/.exec(app)?.[0] || "";
  assert.doesNotMatch(bootstrap, /loadProjects\(\)/);
  assert.match(app, /if \(state\.messageStreamController === controller\) state\.messageStreamController = null/);
});

test("large histories show elapsed loading and are capped before JSON serialization", () => {
  assert.match(app, /loadingElapsed:\s*"仍在加载（已 \{seconds\}s）"/);
  assert.match(app, /loadingElapsed:\s*"Still loading \(\{seconds\}s elapsed\)"/);
  assert.match(app, /function stopMessageLoadingFeedback/);
  assert.match(app, /data-message-loading-text/);
  assert.match(app, /stopMessageLoadingFeedback\(\);\s*\}/s);
  assert.match(app, /pickThread:\s*"点左上角打开对话列表"/);
  assert.match(html, /点左上角打开对话列表/);
  assert.match(app, /document\.documentElement\.style\.setProperty\("--composer-height", value\)/);

  assert.match(server, /const MAX_CLIENT_INLINE_IMAGE_CHARS = 16 \* 1024/);
  assert.match(server, /function offloadInlineImageForClient/);
  assert.match(server, /function compactOversizedMessageContent/);
  assert.match(server, /return capMessagesResponseForClient\(result, threadId\)/);
  assert.match(server, /sendJson\(res, 200, capMessagesResponseForClient\(data, threadId\)\)/);
  assert.match(server, /CLIENT_INLINE_IMAGE_TEXT/);
});

test("payload cap offloads real inline images while keeping prose and message shape", () => {
  const inline = `data:image/png;base64,${"Q".repeat(20000)}`;
  const small = "data:image/png;base64,AAAA";
  const longProse = "工作记录 ".repeat(3000);
  const response = {
    messages: [
      { id: "a", role: "user", content: "短消息", images: [inline] },
      { id: "b", role: "assistant", content: longProse, images: [small] }
    ],
    meta: { session_id: "abc", base_instructions: { text: "x".repeat(3000) } },
    status: { thinking: false }
  };
  const before = JSON.stringify(response).length;
  const capped = capMessagesResponseForClient(response, "fixture-thread-1");
  const after = JSON.stringify(capped).length;
  assert.ok(after < before);
  assert.equal(capped.messages.length, 2, "message count is unchanged");
  assert.equal(capped.messages[0].content, "短消息", "short content is untouched");
  assert.equal(capped.messages[1].content, longProse, "long plain prose stays lossless");
  assert.equal(capped.messages[1].images[0], small, "small inline images stay inline");
  const offloaded = capped.messages[0].images[0];
  assert.equal(offloaded.offloadedImage, true);
  assert.match(offloaded.url, /^\/api\/thread-image\?threadId=fixture-thread-1&name=turnloom-client-[a-f0-9]+\.png$/);
  assert.equal(offloaded.dataUrl, offloaded.url, "client renders from the server URL");
  assert.equal(typeof capped.meta.base_instructions, "string", "oversized meta field is bounded");
  assert.equal(capped.meta.session_id, "abc", "small meta fields survive");
  assert.equal(capped.status.thinking, false);

  // No data:image blobs are left in serialized client payloads.
  assert.doesNotMatch(JSON.stringify(capped), /base64,Q{100}/);
  assert.equal(capped.clientPayloadBytesSaved > 0, true);
  assert.equal(offloadInlineImageForClient("not-an-image", "fixture-thread-1", 0).savedChars, 0);
  assert.equal(compactOversizedMessageContent("x".repeat(24000)).value.length, 24000);
  assert.match(compactOversizedMessageContent(`前缀 data:image/png;base64,${"Q".repeat(30000)}`).value, /内联图片已移出正文/);
});

test("README stays a product document and no audit artifacts enter the repository", () => {
  const readme = read("README.md");
  assert.doesNotMatch(readme, /visual-audit-2026|VISUAL_AUDIT|README_ASSETS|验收报告|视觉审查报告|docs\/visual-report/);
  assert.doesNotMatch(html, /visual-audit-2026|visual-report/);
  assert.doesNotMatch(css, /visual-audit-2026|visual-report/);
});
