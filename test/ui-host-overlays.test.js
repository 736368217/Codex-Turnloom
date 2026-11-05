import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../public/styles.app.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("hidden overlays stay hidden: CSS must not override [hidden]", () => {
  // 真机事故：#shell .host-sheet { display:flex } 覆盖了 [hidden] 的
  // display:none，结果页面一加载就被全屏 backdrop 盖住，点哪里都没反应。
  const block = css.match(/#shell \.host-sheet\[hidden\][\s\S]*?\{([^}]*)\}/);
  assert.ok(block, "missing [hidden] guard for #hostSheet");
  assert.match(block[1], /display:\s*none\s*!important/);
  assert.match(css, /#shell \.host-sheet:not\(\[hidden\]\)\s*\{\s*display:\s*flex/);
  for (const selector of [
    "#shell .approval-banner[hidden]",
    "#shell .thread-context-menu[hidden]",
    "#shell .goal-edit-dialog[hidden]",
    "#shell .app-dialog[hidden]",
    "#shell .app-dialog-backdrop[hidden]"
  ]) {
    assert.ok(css.includes(selector), `missing hidden guard: ${selector}`);
  }
});

test("host sheet markup starts hidden and has a backdrop + close buttons", () => {
  assert.match(html, /id="hostSheet"[^>]*\shidden/);
  assert.match(html, /id="approvalBanner"[^>]*\shidden/);
  assert.match(html, /data-host-sheet-close/g);
  assert.match(html, /id="hostToolsButton"/);
  assert.match(html, /id="threadHideAction"/);
  assert.match(html, /id="threadDeleteAction"/);
});

test("host sheet has explicit high-contrast colors and bounded code preview", () => {
  // 真机截图：深色卡片 + inherit 深色文字，整块面板几乎看不见。
  assert.match(css, /#shell \.host-sheet-card,\s*#shell \.host-sheet-card button[\s\S]*?color:\s*#f4f6fb/);
  assert.match(css, /#shell \.host-sheet-card\s*\{[^}]*background:\s*#171a21/s);
  assert.match(css, /max-height:\s*46vh/);
  assert.match(css, /contain:\s*content/);
  // 20 万字符 <pre> 会卡住 WebView；客户端必须限制。
  assert.match(app, /slice\(0, 12 \* 1024\)/);
});

test("all eight host tools are wired to real handlers", () => {
  for (const name of ["files", "usage", "notifications", "scheduled", "commands", "providers", "browser", "hidden"]) {
    assert.match(app, new RegExp(`data-host-tool="${name}"`), `missing tool button: ${name}`);
    assert.match(app, new RegExp(`name === "${name}"`), `missing tool handler: ${name}`);
  }
  for (const id of [
    "threadRenameAction",
    "threadCompactAction",
    "threadUsageAction",
    "threadFilesAction",
    "threadRevisionsAction",
    "threadOpenAction",
    "threadHideAction",
    "threadDeleteAction"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing context menu item: ${id}`);
    assert.match(app, new RegExp(`${id}:`), `missing action binding: ${id}`);
  }
});

test("mobile session removal uses server soft-delete, not desktop-confirmed host delete", () => {
  assert.match(app, /hideCurrentThread[\s\S]*?\/api\/host\/session\/hide/);
  assert.match(app, /deleteCurrentThread[\s\S]*?session\/delete/);
  assert.match(app, /showHiddenSessions[\s\S]*?\/api\/host\/hidden/);
  assert.match(app, /\/api\/host\/session\/restore/);
});

test("keyboard state pins the composer inside the visible viewport", () => {
  // 视觉检定：layout 765px / 可视 420px 时发送键曾落到 y=708（不可见）。
  assert.match(css, /html\.keyboard-open #shell \{[\s\S]*?height:\s*var\(--app-visible-height/);
  assert.match(css, /html\.keyboard-open #shell \.conversation \{[\s\S]*?flex-direction:\s*column/);
  assert.match(css, /html\.keyboard-open #shell \.composer \{[\s\S]*?margin-top:\s*auto/);
  assert.match(css, /html\.keyboard-open #shell \.host-sheet-card[\s\S]*?max-height:\s*min\(88%/);
});

test("new users get a visible more button and thread action button", () => {
  assert.match(html, /id="hostToolsButton"[^>]*class="[^"]*host-tools-button/);
  assert.match(html, /<span>更多<\/span>/);
  assert.match(app, /data-thread-more=/);
  assert.match(app, /const more = event\.target\.closest\("\[data-thread-more\]"\)/);
  assert.match(css, /#shell \.thread-more-button/);
});