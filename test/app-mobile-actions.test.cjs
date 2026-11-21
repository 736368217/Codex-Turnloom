'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');

const root = path.resolve(__dirname, '../app/src');
function load(file) {
  const full = path.resolve(root, file);
  const mod = { exports: {} };
  let js = stripTypeScriptTypes(fs.readFileSync(full, 'utf8'));
  const names = [...js.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g)].map(m => m[1]);
  js = js.replace(/import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/g,
    (_, vars, source) => `const {${vars}} = require(${JSON.stringify(source)});`)
    .replace(/export default [^;]+;/g, '')
    .replace(/\bexport\s+(?=(?:async\s+)?(?:function|const|class))/g, '');
  new Function('require', 'module', 'exports', js + '\n' + names.map(name => `exports.${name} = ${name};`).join('\n'))(
    source => source === './chatContract'
      ? load('lib/chatContract.ts')
      : require(path.resolve(path.dirname(full), source)),
    mod,
    mod.exports,
  );
  return mod.exports;
}

test('R06: running submit queues instead of being refused; idle input still sends', () => {
  const { composerSubmitDecision, shouldSubmitOnEnter } = load('lib/composerSubmit.ts');
  // 2.3.0: a running turn no longer blocks the composer — the same submit is queued.
  assert.deepEqual(composerSubmitDecision({ running: true, text: 'phone message', attachmentCount: 0 }), { kind: 'queue' });
  assert.deepEqual(composerSubmitDecision({ running: true, text: '', attachmentCount: 1 }), { kind: 'queue' });
  assert.deepEqual(composerSubmitDecision({ running: true, text: '   ', attachmentCount: 0 }), { kind: 'empty' });
  assert.deepEqual(composerSubmitDecision({ running: false, text: 'phone message', attachmentCount: 0 }), { kind: 'send' });
  assert.deepEqual(composerSubmitDecision({ running: false, text: '', attachmentCount: 1 }), { kind: 'send' });
  assert.deepEqual(composerSubmitDecision({ running: false, text: '   ', attachmentCount: 0 }), { kind: 'empty' });

  const base = { key: 'Enter', shiftKey: false, isComposing: false, keyCode: 66 };
  assert.equal(shouldSubmitOnEnter(base), true);
  assert.equal(shouldSubmitOnEnter({ ...base, shiftKey: true }), false);
  assert.equal(shouldSubmitOnEnter({ ...base, isComposing: true }), false);
  assert.equal(shouldSubmitOnEnter({ ...base, keyCode: 229 }), false);
  assert.equal(shouldSubmitOnEnter({ ...base, key: 'a' }), false);
});

test('R06: chat form submit cannot call interrupt; Stop has its own button path', () => {
  const screen = fs.readFileSync(path.join(root, 'screens/ChatDetailScreen.tsx'), 'utf8');
  const composer = fs.readFileSync(path.join(root, 'components/ChatComposer.tsx'), 'utf8');
  const submit = screen.slice(screen.indexOf('const onSubmit ='), screen.indexOf('const stopRunning ='));
  const stopStart = screen.indexOf('const stopRunning =');
  const stop = screen.slice(stopStart, screen.indexOf('  return (', stopStart));
  assert.doesNotMatch(submit, /interruptThread/);
  assert.match(submit, /composerSubmitDecision/);
  // The refusenik path is gone: a running turn queues the message instead.
  assert.doesNotMatch(submit, /blocked-running/);
  assert.match(submit, /sendQueuedMessage/);
  assert.match(submit, /草稿和附件已保留/);
  assert.match(stop, /interruptThread/);
  // Two 44px primaries while running: queue-send left, Stop rightmost.
  assert.match(composer, /aria-label="排队发送"/);
  assert.match(composer, /type="button" aria-label="停止"/);
  assert.match(composer, /type="submit" aria-label="发送"/);
  assert.match(screen, /onStop=\{stopRunning\}/);
  assert.match(screen, /enterKeyHint="send"/);
});

test('R07: authoritative thread status wins for badge, filter, home card and monitor', () => {
  const { projectThread } = load('lib/threadProjection.ts');
  const stale = { id: 'one', status: { state: 'running', thinking: true } };
  assert.equal(projectThread(stale).tone, 'running');
  const stopped = projectThread(stale, { one: { state: 'ended', thinking: false } });
  assert.deepEqual(stopped, { status: { state: 'ended', thinking: false }, tone: 'done' });
  assert.equal(projectThread(stale, { one: { state: 'waiting', thinking: false } }).tone, 'waiting');
  // 2.4.0 契约 A：等授权的回合 thinking 仍为真，所以 waiting 必须优先于 thinking。
  // 这条曾整组「待你处理」都不渲染（0 不渲染 → 界面什么都不显示，截图也看不出来）。
  assert.equal(projectThread(stale, { one: { state: 'waiting', thinking: true } }).tone, 'waiting');
  // 老宿主降级路径：行内 interactionRequired=true 且 thinking=true，也要判 waiting。
  assert.equal(projectThread({ id: 'old', status: { thinking: true, interactionRequired: true } }).tone, 'waiting');
  assert.equal(projectThread({ id: 'failed', status: { state: 'error' } }).tone, 'error');
  assert.equal(projectThread({ id: 'failed', status: { state: 'error' } }, { failed: { state: 'ended', thinking: false } }).tone, 'done');

  const task = fs.readFileSync(path.join(root, 'components/TaskStream.tsx'), 'utf8');
  const threads = fs.readFileSync(path.join(root, 'screens/ThreadsScreen.tsx'), 'utf8');
  const monitor = fs.readFileSync(path.join(root, 'components/RunningStrip.tsx'), 'utf8');
  const state = fs.readFileSync(path.join(root, 'state/dataStore.ts'), 'utf8');
  assert.match(task, /toneOfThread\(thread, statusByThread\)/);
  // 2.2.2 首页=会话列表：列表页不再自己算状态或做状态筛选，状态统一由
  // TaskStream 用 projectThread 计算，列表只透传 statusByThread 并提供长按归档。
  assert.match(threads, /statusByThread=\{data\.statusByThread\}/);
  assert.match(threads, /onLongPress=/);
  assert.match(monitor, /projectThread\(thread, data\.statusByThread\)/);
  assert.match(state, /projectThread\(thread, statuses\)/);
});
