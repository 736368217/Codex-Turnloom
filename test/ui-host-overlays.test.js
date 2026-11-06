import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../public/styles.app.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const bridge = readFileSync(new URL("../third-party/turnloom-pidesktop/plugin/main.js", import.meta.url), "utf8");

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
  // 小扳手不再占顶栏；工具开关收进「更多」。
  assert.doesNotMatch(html, /id="toolToggle"/);
  assert.doesNotMatch(html, /class="toggle"/);
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

test("status badge has its own row and never covers the toolbar", () => {
  // 真机截图：大字模式下「2 疑似停滞 · 1 运行中」压到工具栏和消息列表上。
  assert.match(html, /<\/header>\s*<div id="approvalBanner"[^>]*><\/div>\s*<div class="conversation-status-row"/);
  assert.match(html, /id="headerStatusButton"[^>]*hidden/);
  assert.match(css, /#shell \.conversation-status-row\s*\{[^}]*flex:\s*0 0 auto/s);
  assert.match(css, /#shell \.conversation-status-row\[hidden\]\s*\{\s*display:\s*none\s*!important/s);
  assert.match(css, /#shell \.conversation-header\s*\{[^}]*flex-wrap:\s*nowrap/s);
  assert.match(css, /#shell \.host-tools-button span\s*\{[^}]*writing-mode:\s*horizontal-tb/s);
  assert.match(app, /statusRow\.hidden = headerBtn\.hidden/);
});

test("typing after image upload keeps the attachment thumbnail visible", () => {
  // 旧 CSS 无条件 `html.keyboard-open .attachment-tray { display:none }`；
  // 用户先选图再点输入框，图片就凭空消失。
  assert.match(app, /composerForm\.classList\.toggle\("has-attachments", hasAttachments\)/);
  assert.match(app, /attachedImages/);
  assert.match(css, /html\.keyboard-open #shell \.composer\.has-attachments \.attachment-tray\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /html\.keyboard-open #shell \.composer\.has-attachments \.attachment-item img\s*\{[^}]*width:\s*52px/s);
  assert.match(css, /#shell \.composer\.has-attachments \.attachment-tray\s*\{[^}]*order:\s*-1/s);
});

test("model summary shows a readable card and effort badge, not a bare slug", () => {
  assert.match(app, /friendlyName[\s\S]*modelTitle\.split\(":"\)\[1\]\?\.toUpperCase/);
  assert.match(app, /t\("modelSettings"\)/);
  assert.match(css, /#shell \.model-summary\s*\{[^}]*border:\s*1px solid #D8E1EF\s*!important/s);
  assert.match(css, /#shell \.model-summary\s*\{[^}]*background:\s*#F8FAFE\s*!important/s);
  assert.match(css, /#shell \.model-effort\s*\{[^}]*border-radius:\s*999px/s);
  assert.match(css, /#shell \.model-summary::after\s*\{\s*display:\s*none\s*!important/s);
  assert.match(css, /html\.keyboard-open #shell \.model-summary\s*\{[^}]*height:\s*40px\s*!important/s);
});

test("queued messages collapse to one compact row by default", () => {
  assert.match(html, /id="queueToggleButton"/);
  assert.match(app, /queueExpanded: safeStorageGet\(localStorage, "codex-queue-expanded"\)/);
  assert.match(app, /queueToggleButton\?\.addEventListener\("click"/);
  assert.match(app, /els\.queueStatusList\.hidden = !expanded \|\| count <= 0/);
  assert.match(css, /#shell \.queue-status-bar\s*\{[^}]*max-height:\s*44px/s);
  assert.match(css, /html\.keyboard-open #shell \.queue-status-bar\s*\{[^}]*display:\s*flex/s);
});
test("switching conversations keeps drafts and attachments per thread", () => {
  assert.match(app, /threadDrafts: \{\}/);
  assert.match(app, /function saveCurrentThreadDraft/);
  assert.match(app, /function restoreThreadDraft/);
  assert.match(app, /saveCurrentThreadDraft\(\);[\s\S]{0,500}restoreThreadDraft\(nextId\)/);
  assert.match(app, /renderImageAttachments\(\);[\s\S]{0,120}autoResizeComposerInput\(\)/);
});

test("model panel separates provider/model and effort, and balances composer controls", () => {
  assert.match(html, /model-step-title[\s\S]*<b>1<\/b><span>供应商<\/span>/);
  assert.match(html, /model-step-title[\s\S]*思考强度/);
  assert.match(css, /#shell \.model-row\s*\{[^}]*grid-template-areas/s);
  assert.match(css, /#shell \.model-row-capability\s*\{[^}]*margin-left:\s*0\s*!important/s);
  assert.match(css, /html\.keyboard-open #shell \.effort-chip\s*\{[^}]*min-width:\s*56px/s);
  assert.match(css, /#shell \.composer-left \.icon-button\.attach-button[\s\S]{0,220}width:\s*40px/s);
});

test("hidden model panel is invisible on initial load and never eats the center tap", () => {
  assert.match(html, /id="modelPanel"[^>]*hidden/);
  assert.match(css, /#shell \[hidden\]\s*\{\s*display:\s*none\s*!important/s);
  assert.match(css, /#shell \.model-panel\[hidden\][\s\S]{0,500}display:\s*none\s*!important/s);
  assert.match(app, /els\.modelPanel\.hidden = !state\.modelPanelOpen/);
  assert.match(app, /state\.modelPanelOpen = !state\.modelPanelOpen/);
  // 空模型目录 / health 失败时不能因为提前 return 而留下打开的弹层。
  assert.match(app, /function syncModelPanelDisclosure[\s\S]*els\.modelPanel\.hidden = !state\.modelPanelOpen/);
  assert.match(app, /function renderModelSettings\(\) \{\s*syncModelPanelDisclosure\(\);\s*const models = availableModels\(\);\s*if \(!models\.length\) return;/);
});

test("three-level model chooser filters models by provider, not by changing the model", () => {
  assert.match(html, /id="modelPanel"[\s\S]*id="providerChips"[\s\S]*id="modelList"[\s\S]*id="effortChips"/);
  assert.match(html, /id="providerFilterNote"[^>]*hidden>搜索会跨全部供应商显示匹配模型/);
  assert.match(html, /<b>2<\/b><span>模型<\/span>/);
  assert.match(html, /<b>3<\/b><span>思考强度<\/span>/);
  assert.match(app, /modelProvider: "all"/);
  assert.match(app, /function modelProviderName[\s\S]* · [\s\S]*model\?\.provider[\s\S]*lastIndexOf\("\/"\)/);
  assert.match(app, /function providerFilteredModels[\s\S]*models\.filter\(\(model\) => matchesProvider/);
  assert.match(app, /function filteredModels[\s\S]*搜索永远跨供应商[\s\S]*providerName/);
  assert.match(app, /providerFilteredModels\(filteredModels\(scoped, state\.modelFilter, state\.modelProvider\)\)/);
  assert.match(app, /function selectProvider\(key\)[\s\S]*state\.modelProvider = providerKey\(key\)/);
  assert.match(app, /function selectProvider\(key\)[\s\S]*renderModelSettings\(\)[\s\S]*saveCurrentThreadDraft\(\)/);
  assert.match(app, /providerChips\?\.addEventListener\("click"[\s\S]*data-provider/);
  assert.match(app, /modelProvider: providerKey\(state\.modelProvider\)/);
  assert.match(app, /function adoptSelectedThreadModel[\s\S]*thread\?\.model \|\| state\.model/);
  assert.match(app, /function renderProviderChips[\s\S]*\["all", "全部"\]/);
  assert.doesNotMatch(app, /return row;\s*return row;/);
  assert.match(css, /#shell \.provider-chips\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(css, /#shell \.provider-chip\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /html\.large-text #shell \.provider-chips[\s\S]*overflow-x:\s*auto/);
  assert.match(css, /html\.keyboard-open #shell \.provider-chips[\s\S]*overflow-x:\s*auto/);
  assert.match(css, /#shell \[hidden\]\s*\{\s*display:\s*none\s*!important/);
});

test("thread drafts persist safely across pagehide and visibility changes", () => {
  assert.match(app, /const THREAD_DRAFTS_STORAGE_KEY = "codex-thread-drafts-v1"/);
  assert.match(app, /THREAD_DRAFTS_MAX_BYTES = 1\.5 \* 1024 \* 1024/);
  assert.match(app, /THREAD_DRAFTS_MAX_THREADS = 30/);
  assert.match(app, /THREAD_DRAFT_IMAGE_MAX_BYTES = 300 \* 1024/);
  assert.match(app, /function loadPersistedThreadDrafts[\s\S]*safeStorageGet\(localStorage, THREAD_DRAFTS_STORAGE_KEY\)/);
  assert.match(app, /function loadPersistedThreadDrafts[\s\S]*try \{[\s\S]*JSON\.parse[\s\S]*catch/);
  assert.match(app, /function compactDraftImage[\s\S]*dataUrl\.length > THREAD_DRAFT_IMAGE_MAX_BYTES[\s\S]*name[\s\S]*mimeType[\s\S]*size/);
  assert.match(app, /function persistThreadDrafts[\s\S]*JSON\.stringify\(bounded\)[\s\S]*safeStorageSet\(localStorage, THREAD_DRAFTS_STORAGE_KEY/);
  assert.match(app, /function saveCurrentThreadDraft[\s\S]*persistThreadDrafts\(\)/);
  assert.match(app, /window\.addEventListener\("pagehide", saveCurrentThreadDraft\)/);
  assert.match(app, /document\.addEventListener\("visibilitychange"[\s\S]*document\.hidden[\s\S]*saveCurrentThreadDraft\(\)/);
  assert.match(app, /async function bootstrap[\s\S]*loadPersistedThreadDrafts\(\);[\s\S]*restoreThreadDraft\(state\.selectedId\)[\s\S]*adoptSelectedThreadModel\(\)/);
  assert.match(app, /modelExplicit: previous\.modelExplicit === true/);
  assert.match(app, /draft\?\.modelExplicit && draft\.model/);
  assert.match(app, /forgetThreadDraft\(sentThreadId\)/);
});

test("web views pop one layer at a time with chat as the root", () => {
  assert.match(app, /viewStack: \[\]/);
  assert.match(app, /function viewLayerActive[\s\S]*case "hostSheet"[\s\S]*case "modelPanel"[\s\S]*case "goalEditDialog"[\s\S]*case "queueExpanded"[\s\S]*case "sidebar"/);
  assert.match(app, /function pushViewLayer[\s\S]*removeViewLayer\(id\)[\s\S]*viewStack\.push/);
  assert.match(app, /function popViewLayer[\s\S]*viewLayerActive\(layer\.id\)[\s\S]*layer\.close\(\)/);
  assert.match(app, /globalThis\.codexPocketHandleBack = \(\) => popViewLayer\(\)/);
  assert.match(app, /pushViewLayer\("hostSheet"[\s\S]*closeHostSheet/);
  assert.match(app, /pushViewLayer\("modelPanel"[\s\S]*closeModelPanel/);
  assert.match(app, /pushViewLayer\("queueExpanded"[\s\S]*collapseQueueLayer/);
  assert.match(app, /pushViewLayer\("threadContextMenu"/);
  assert.match(app, /pushViewLayer\("imagePickerMenu"/);
  assert.match(app, /pushViewLayer\("mentionMenu"/);
  assert.match(app, /pushViewLayer\("sidebar"/);
  assert.doesNotMatch(app, /history\.pushState\([^\n]*viewStack/);
});

test("queued failures expose the reason, retry time and an explicit retry action", () => {
  assert.match(app, /failedCount = queuedMessages\.filter\(\(item\) => item\.deliveryState === "failed"\)\.length/);
  assert.match(app, /queueStatusBar\.classList\.toggle\("has-failure"/);
  assert.match(app, /queueStatusText\.textContent = `\$\{t\("queuedCount"[\s\S]*失败/);
  assert.match(app, /queue-status-error[\s\S]*escapeHtml\(item\.lastError\)/);
  assert.match(app, /data-queue-action="retry"/);
  assert.match(app, /postJson\("\/api\/queue\/retry"/);
  assert.match(app, /nextAttemptAtMs[\s\S]*自动重试/);
  assert.match(css, /#shell \.queue-status-bar\.has-failure/);
  assert.match(css, /#shell \.queue-retry-button\s*\{[^}]*min-height:\s*40px/);
});

test("bridge queue remains authoritative, atomic and principal-safe", () => {
  assert.match(bridge, /const TURNLOOM_QUEUE_PRINCIPAL = "turnloom-mobile"/);
  assert.match(bridge, /NATIVE_QUEUE_BUSY_RETRIES = 5/);
  assert.match(bridge, /function nativeQueueWrite[\s\S]*BEGIN IMMEDIATE[\s\S]*isSqliteBusy\(error\)/);
  assert.match(bridge, /function imageReceiptsPath[\s\S]*turnloom-image-receipts\.json/);
  assert.match(bridge, /if \(method === "turnloom\/queue\/claim"\) return nativeQueueClaim\(params\)/);
  assert.match(bridge, /if \(method === "turnloom\/queue\/retry"\) return nativeQueueRetry\(params\)/);
  assert.match(bridge, /DELETE FROM turn_queue WHERE session_id = \? AND id IN/);
  assert.match(bridge, /scopeOwnPrincipal = !itemId && params\?\.ownPrincipalOnly !== false/);
  assert.match(bridge, /function nativeQueueClaim[\s\S]*DELETE FROM turn_queue WHERE session_id = \? AND principal = \? AND id = \?/);
  assert.match(bridge, /function nativeQueuePush[\s\S]*restoreId/);
});

test("tool toggle and switch computer live inside the More sheet", () => {
  assert.match(app, /data-host-tool-toggle/);
  assert.match(app, /function setShowTools[\s\S]*state\.showTools = Boolean\(enabled\)/);
  assert.match(app, /data-host-switch-computer/);
  assert.match(app, /globalThis\.CodexPocket\?\.showMachinePicker/);
  assert.match(app, /welcomeStepThreeCopy: "工具记录默认收起，需要时在「更多」里打开。"/);
  assert.match(html, /工具记录默认收起，需要时在「更多」里打开。/);
  assert.match(css, /#shell \.host-tool-toggle\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /#shell \.host-switch-computer\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /#shell \.conversation-header \.toggle\s*\{\s*display:\s*none\s*!important/s);
});
