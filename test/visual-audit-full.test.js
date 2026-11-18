/**
 * Regression guards for the full-surface visual audit (VIS-01..VIS-13).
 *
 * The audit was run before the Web UI PR; several defects were already covered
 * at runtime by an override layer, but their dark/centered *source* rules and a
 * stale assertion survived. These static checks keep both the source rules and
 * the native touch-target / glass composition fixes from regressing in CI.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(path.join(ROOT, relative), "utf8");
function allNativeSources() {
  // Node's recursive readdir returns full relative paths and never follows
  // junctions, so bracket-path files like app/thread/[id].tsx are covered.
  return readdirSync(path.join(ROOT, "mobile-app/src"), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(tsx?|ts)$/.test(entry.name))
    .map((entry) => read(`mobile-app/src/${entry.parentPath ? path.relative(path.join(ROOT, "mobile-app/src"), entry.parentPath).replace(/\\/g, "/") + "/" : ""}${entry.name}`))
    .join("\n");
}

test("VIS-01/04/05/06: no dark host sheet or centered-dialog source rules remain", () => {
  const css = read("public/styles.app.css");
  const base = read("public/styles.css");
  // The old dark panel was the only black surface in a light-only UI.
  assert.doesNotMatch(css, /#171a21|#222733|#b8c0d0|color:\s*#f4f6fb|rgba\(255, 255, 255, 0\.06\)/);
  assert.match(css, /#shell \.host-sheet-card\s*\{[^}]*background:\s*#FFFFFF/s);
  assert.match(css, /#shell \.host-sheet-card\s*\{[^}]*color:\s*#142033/s);
  // Welcome and goal dialogs are bottom-aligned in their own source blocks now,
  // not only via the final override layer.
  for (const selector of [".welcome-dialog", ".goal-edit-dialog"]) {
    const block = new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`).exec(base);
    assert.ok(block, `missing ${selector} source block`);
    assert.match(block[1], /align-items:\s*flex-end/);
    assert.doesNotMatch(block[1], /place-items:\s*center/);
  }
  // The app confirm box is bottom-anchored in its source block too.
  const appDialog = /#shell \.app-dialog\s*\{([^}]*)\}/.exec(css);
  assert.ok(appDialog);
  assert.match(appDialog[1], /bottom:\s*0/);
  assert.doesNotMatch(appDialog[1], /translate\(-50%,\s*-50%\)/);
});

test("VIS-03: index.html has balanced markup and overlays stay inside #shell", async () => {
  const { JSDOM } = await import("jsdom");
  const html = read("public/index.html");
  const doc = new JSDOM(html).window.document;
  const shell = doc.querySelector("#shell");
  assert.ok(shell);
  for (const id of ["messageActionBackdrop", "messageActionSheet", "appDialogBackdrop", "appDialog", "threadContextBackdrop", "threadContextMenu"]) {
    const el = doc.getElementById(id);
    assert.ok(el, `missing #${id}`);
    assert.equal(shell.contains(el), true, `#${id} must stay inside #shell`);
  }
  // No stray closing div: a strict stack walk reports no mismatches.
  const voids = new Set(["meta", "link", "img", "input", "br", "hr", "path", "circle", "source", "use"]);
  const stack = [];
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)>/gs)) {
    const [, slash, tag, attrs] = m;
    const name = tag.toLowerCase();
    if (voids.has(name) || name === "!doctype" || /\/\s*$/.test(attrs)) continue;
    if (slash) {
      const top = stack.at(-1);
      assert.equal(top?.t, name, `unexpected </${name}> (top was ${top?.t})`);
      stack.pop();
    } else stack.push({ t: name });
  }
  assert.deepEqual(stack, []);
});

test("VIS-07: thread actions are a bottom action sheet with backdrop and grabber", () => {
  const css = read("public/styles.app.css");
  const app = read("public/app.js");
  const html = read("public/index.html");
  assert.match(html, /id="threadContextBackdrop"[^>]*hidden/);
  assert.match(html, /id="threadContextMenu"[\s\S]{0,120}class="sheet-grabber"/);
  assert.match(css, /#shell \.thread-context-menu\s*\{[^}]*bottom:\s*0/s);
  assert.match(css, /#shell \.thread-context-menu\s*\{[^}]*border-radius:\s*20px 20px 0 0/s);
  assert.match(css, /#shell \.thread-context-backdrop\[hidden\][\s\S]{0,140}display:\s*none\s*!important/);
  assert.doesNotMatch(app, /els\.threadContextMenu\.style\.left =/);
  assert.match(app, /els\.threadContextBackdrop\.hidden = false/);
  assert.match(app, /els\.threadContextBackdrop\.addEventListener\("click", closeThreadContextMenu\)/);
});

test("VIS-08: the 320px model pill shrinks instead of forcing 128px", () => {
  const css = read("public/styles.app.css");
  const narrow = /@media \(max-width: 360px\)\s*\{([\s\S]*?)\n\}/.exec(css.slice(css.indexOf("VIS-08")));
  assert.ok(narrow, "missing narrow-viewport rule");
  assert.match(narrow[1], /#shell \.model-summary\s*\{[^}]*min-width:\s*44px/s);
  assert.match(narrow[1], /#shell \.model-name\s*\{[^}]*text-overflow:\s*ellipsis/s);
});

test("VIS-02: approval sheet no longer nests BlurView layers", () => {
  const sheet = read("mobile-app/src/components/ApprovalBottomSheet.tsx");
  assert.doesNotMatch(sheet, /expo-blur|BlurView|OptionA\.glass/);
  assert.match(sheet, /handleComponent=\{\(\) => \([\s\S]*?<DragHandle \/>/);
  assert.match(sheet, /<View style=\{styles\.footerGlass\}>/);
  assert.match(sheet, /<View style=\{styles\.glass\}>/);
  assert.match(sheet, /enableFooterMarginAdjustment/);
  assert.match(sheet, /BottomSheetFooter/);
});

test("VIS-09/10/11/12: every native control declares at least a 44dp target", () => {
  // Scan the entire native source tree: bracket-path files such as
  // app/thread/[id].tsx were missed by a hand-picked file list once.
  const all = allNativeSources();
  assert.doesNotMatch(all, /minHeight:\s*(?:2\d|3\d|4[0-3])\b/);
  assert.doesNotMatch(all, /'h-10 /);
  assert.match(all, /min-h-\[44px\]/);
  // VIS-09: both the action-sheet Row and the inline copy button meet 44dp.
  assert.match(read("mobile-app/src/components/OptionASheets.tsx"), /minHeight: 60/);
  assert.match(read("mobile-app/src/app/thread/[id].tsx"), /copyButton:\s*\{\s*minHeight:\s*44/);
});

test("VIS-13: NewTaskSheet shows the shared DragHandle like other sheets", () => {
  const sheet = read("mobile-app/src/components/NewTaskSheet.tsx");
  assert.match(sheet, /import \{ DragHandle \} from '\.\/ui'/);
  assert.match(sheet, /handleComponent=\{\(\) => <DragHandle \/>\}/);
});

test("README stays a product document and no audit artifacts enter the repository", () => {
  const readme = read("README.md");
  assert.doesNotMatch(readme, /visual-audit|VISUAL_AUDIT|README_ASSETS|验收报告|视觉审查报告|docs\/visual-report|VIS-0\d/);
  for (const file of ["public/index.html", "public/styles.app.css", "test/ui-host-overlays.test.js"]) {
    assert.doesNotMatch(read(file), /visual-audit-2026|docs\/visual-report/);
  }
});
