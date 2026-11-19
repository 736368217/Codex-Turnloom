'use strict';
/**
 * Usability regressions found with tools/qa/capture.mjs on 2026-11-18.
 *
 * Each assertion names the defect it locks down, and the screenshot that
 * showed it lives in docs/qa/visual/before|after/<viewport>/.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');

const root = path.resolve(__dirname, '../app/src');
const read = (file) => fs.readFileSync(path.resolve(root, file), 'utf8');

function load(file) {
  const full = path.resolve(root, file);
  const mod = { exports: {} };
  let js = stripTypeScriptTypes(fs.readFileSync(full, 'utf8'));
  const names = [...js.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g)].map((m) => m[1]);
  js = js.replace(/import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/g,
    (_, vars, source) => `const {${vars}} = require(${JSON.stringify(source)});`)
    .replace(/export default [^;]+;/g, '')
    .replace(/\bexport\s+(?=(?:async\s+)?(?:function|const|class))/g, '');
  new Function('require', 'module', 'exports', js + '\n' + names.map((name) => `exports.${name} = ${name};`).join('\n'))(
    (source) => {
      const resolved = path.resolve(path.dirname(full), source);
      if (fs.existsSync(resolved)) return require(resolved);
      const withExt = `${resolved}.ts`;
      if (fs.existsSync(withExt)) return load(path.relative(root, withExt));
      throw new Error(`cannot resolve ${source} from ${file}`);
    },
    mod,
    mod.exports,
  );
  return mod.exports;
}

test('U1: thread list opens on project view; projects collapse, 未归类 stays open', () => {
  const screen = read('screens/ThreadsScreen.tsx');
  const store = read('state/tabStore.ts');
  // 2.2.4 的产品决定：默认「按项目」；项目组默认收起、未归类默认展开，
  // 所以首屏仍有内容可点。视图持久在 tabStore，进出详情不重置。
  assert.match(store, /threadsView: 'project'/);
  assert.match(screen, /threadsView: view/);
  assert.match(screen, /const isCollapsed = \(key: string\) => collapsed\[key\] \?\? !isUncategorized\(key\)/);
  // 未归类永远排在最后（有项目的在上，无项目的在下）。
  assert.match(screen, /Number\(isUncategorized\(a\.key\)\) - Number\(isUncategorized\(b\.key\)\)/);
  assert.doesNotMatch(screen, /collapsed\[group\.key\] !== false/);
});

test('U2: tapping a project group toggles it on the first tap', () => {
  const screen = read('screens/ThreadsScreen.tsx');
  // 旧实现 `!prev[key]` 把 undefined 变成 true，第一次点击仍保持折叠。
  assert.doesNotMatch(screen, /\[key\]: !prev\[key\]/);
  // 2.2.4：默认折叠状态由 isCollapsed() 决定（项目组默认收起、未归类默认展开），
  // toggle 必须取它的反，而不是把 undefined 当成 false。
  assert.match(screen, /const isCollapsed = \(key: string\) => collapsed\[key\] \?\? !isUncategorized\(key\)/);
  assert.match(screen, /\[key\]: !isCollapsed\(key\)/);
});

test('U3: monitor rows offer a real stop action instead of a dead "view / stop" hint', () => {
  const screen = read('screens/MonitorsScreen.tsx');
  assert.doesNotMatch(screen, /查看 \/ 停止/);
  assert.match(screen, /interruptThread/);
  assert.match(screen, /aria-label=\{`停止 \$\{titleOfThread\(thread\)\}`\}/);
  assert.match(screen, /minHeight: 44/);
});

test('U4: an unpaired connect screen never touches the network on mount', () => {
  const screen = read('screens/ConnectScreen.tsx');
  const mountEffect = screen.slice(screen.indexOf('只有已记住服务地址时才在挂载时自检'), screen.indexOf('async function connect('));
  assert.match(mountEffect, /if \(!session\.serverUrl\) return;/);
  assert.match(mountEffect, /void checkUpdate\(false\)/);
  // 2.2.3：更新只走公网 R2 清单（runUpdateCheck），连接页不再有"内置公开域"这条更新源。
  assert.match(screen, /runUpdateCheck\(/);
  assert.doesNotMatch(screen, /DEFAULT_UPDATE_ORIGIN|getPublicAppUpdate/);
  assert.match(screen, /if \(!manual && !session\.serverUrl\) return;/);
  assert.match(screen, /检查应用更新（公开通道）/);
});

test('U5: primary chat/new-task controls are 44x44, not 40px', () => {
  const composer = read('components/ChatComposer.tsx');
  assert.match(composer, /return \{ width: 44, minWidth: 44, height: 44, minHeight: 44, borderRadius: 22 \};/);
  const detail = read('screens/ChatDetailScreen.tsx');
  assert.match(detail, /className=\{decision === 'decline' \? 'tl-approval-reject' : 'tl-approval-approve'\} style=\{\{ minHeight: 44 \}\}/);
  const threads = read('screens/ThreadsScreen.tsx');
  assert.match(threads, /className="tl-press tl-nav-action" aria-label="新建会话"/);
  // The 44px target is real CSS, not a decorative 32px pill.
  const css = read('theme/globals.css');
  assert.match(css, /\.tl-thread-nav \.tl-nav-action \{[^}]*width: 44px;[^}]*height: 44px/s);
});

test('U0: a normal send must not carry the displayed model (P0: PI configure popup)', () => {
  const detail = read('screens/ChatDetailScreen.tsx');
  // 旧行为：每轮都把面板里显示的模型塞进 payload，电脑端据此判定“切换模型”。
  assert.doesNotMatch(detail, /model: fields\.preference\.model/);
  assert.match(detail, /model: fields\.send\.model, effort: fields\.send\.effort/);
});

test('U6: approval decisions stay disabled unless the host supplied an exact request', () => {  const detail = read('screens/ChatDetailScreen.tsx');
  assert.match(detail, /const canApprove = Boolean\(message\.canApprove && message\.threadId === threadId/);
  assert.match(detail, /message\.unavailable \? '请求已过期、变化或已处理，已禁用决定。'/);
});

test('U7: list timestamps read updatedAtMs from the HTTP backend, not only updatedAt', () => {
  const { threadUpdatedAtMs, formatThreadWhen } = load('lib/threadProjection.ts');
  const now = new Date('2026-11-18T12:00:00+08:00').getTime();
  assert.equal(threadUpdatedAtMs({ updatedAtMs: now - 60_000 }), now - 60_000);
  assert.equal(threadUpdatedAtMs({ updatedAt: '2026-11-18T03:59:00.000Z' }), Date.parse('2026-11-18T03:59:00.000Z'));
  assert.equal(threadUpdatedAtMs({ updatedAt: String(now) }), now);
  assert.equal(threadUpdatedAtMs({}), 0);
  assert.equal(formatThreadWhen({ updatedAtMs: new Date('2026-11-18T09:05:00+08:00').getTime() }, now), '09:05');
  assert.equal(formatThreadWhen({ updatedAtMs: new Date('2026-11-17T20:00:00+08:00').getTime() }, now), '昨天');
  assert.equal(formatThreadWhen({ updatedAtMs: new Date('2026-03-02T20:00:00+08:00').getTime() }, now), '3/2');
  assert.equal(formatThreadWhen({}, now), '');
});
