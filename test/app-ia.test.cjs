'use strict';
/**
 * 2.2.2 information architecture: the app opens on the conversation list.
 *
 * These are contract tests for the IA itself — who owns the first screen, what
 * the "+" does, where the machine entry lives, and which old screens are gone.
 * Visual density is Iris's; interaction belongs here.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');

const root = path.resolve(__dirname, '../app/src');
const read = (file) => fs.readFileSync(path.resolve(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.resolve(root, file));

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
      if (source === 'react') return { useSyncExternalStore() {} };
      const resolved = path.resolve(path.dirname(full), source);
      return load(path.relative(root, `${resolved}.ts`));
    },
    mod,
    mod.exports,
  );
  return mod.exports;
}

test('IA1: three tabs, opening on the conversation list', () => {
  const tabs = load('state/tabStore.ts');
  assert.deepEqual(tabs.TAB_ORDER, ['threads', 'monitors', 'settings']);
  assert.deepEqual(Object.keys(tabs.TAB_LABELS).sort(), ['monitors', 'settings', 'threads']);
  assert.equal(tabs.tabStore.getState().activeTab, 'threads');
  assert.equal(tabs.tabStore.getState().composing, false);
  assert.equal(tabs.tabStore.getState().detailThreadId, null);
});

test('IA2: "+" opens a blank chat and a real thread supersedes it', () => {
  const tabs = load('state/tabStore.ts');
  tabs.openNewThread();
  assert.equal(tabs.tabStore.getState().composing, true);
  assert.equal(tabs.tabStore.getState().activeTab, 'threads');
  assert.equal(tabs.tabStore.getState().detailThreadId, null);

  tabs.openDetail('thread-1', 'hello');
  assert.equal(tabs.tabStore.getState().composing, false);
  assert.equal(tabs.tabStore.getState().detailThreadId, 'thread-1');

  tabs.openNewThread();
  tabs.closeDetail();
  assert.equal(tabs.tabStore.getState().composing, false);
  assert.equal(tabs.tabStore.getState().detailThreadId, null);
});

test('IA3: AppShell routes threads/monitors/settings only, new chat included', () => {
  const shell = read('components/AppShell.tsx');
  assert.doesNotMatch(shell, /HomeScreen/);
  assert.doesNotMatch(shell, /updateOffer/);
  assert.doesNotMatch(shell, /activeTab === 'home'/);
  assert.match(shell, /activeTab === 'threads' && <ThreadsScreen \/>/);
  assert.match(shell, /newThread=\{composing\}/);
  assert.match(shell, /const inDetail = composing \|\| detailThreadId !== null/);
  // Back never returns to a dashboard tab.
  assert.match(shell, /if \(state\.activeTab !== 'threads'\) \{ setActiveTab\('threads'\)/);
});

test('IA4: the list owns "+" and is full-bleed, with no dashboard chrome', () => {
  const threads = read('screens/ThreadsScreen.tsx');
  const stream = read('components/TaskStream.tsx');
  assert.match(threads, /import \{[^}]*openNewThread[^}]*\} from '\.\.\/state\/tabStore'/);
  assert.match(threads, /aria-label="新建会话"[\s\S]*openNewThread\(\)/);
  assert.doesNotMatch(threads, /openSheet\('newTask'\)|openSheet\("newTask"\)/);
  assert.match(threads, /className="tl-thread-screen"/);
  assert.match(threads, /className="tl-thread-scroll"/);
  assert.match(threads, /className="tl-thread-filters"/);
  assert.match(stream, /className="tl-thread-list"/);
  assert.match(stream, /className="tl-press tl-thread-row"/);
  assert.doesNotMatch(threads, /MachineHubHeader|StatusCard/);
  assert.doesNotMatch(threads, /<SectionTitle|<EmptyState/);
});

test('IA5: machine + diagnostics live in Settings, version appears once', () => {
  const settings = read('screens/SettingsScreen.tsx');
  assert.match(settings, /className="tl-settings-group"/);
  assert.match(settings, /<div className="tl-settings-label">我的电脑<\/div>/);
  assert.match(settings, /uploadDiagnostics\(context\)/);
  assert.match(settings, /上传诊断/);
  assert.match(settings, /openSheet\('diagnostics'\)/);
  // Version appears once, in the About card; there is no second subtitle copy.
  assert.doesNotMatch(settings, /APP_IDENTITY/);
  assert.match(settings, /\{session\.appVersion\} \(\{session\.appVersionCode\}\)/);
  assert.match(settings, /tl-settings-row--danger/);
});

test('IA6: a blank chat never polls and creates the thread on first send', () => {
  const detail = read('screens/ChatDetailScreen.tsx');
  assert.match(detail, /newThread = false \}: \{ threadId: string; title: string; newThread\?: boolean \}/);
  assert.match(detail, /const composerThreadId = newThread \? '__new__' : threadId/);
  assert.match(detail, /if \(!context \|\| newThread\) return;/);
  assert.match(detail, /const id = await createThread\(context, \{ \.\.\.payload[^}]*\}\)/);
  assert.match(detail, /openDetail\(id, text\.slice\(0, 48\) \|\| '新会话'\)/);
  assert.match(detail, /autoFocus=\{newThread\}/);
  assert.match(detail, /tl-chat-list--blank/);
  assert.match(detail, /tl-chat-blank-title/);
});

test('IA7: the old dashboard and new-task drawer are gone, not hidden', () => {
  assert.equal(exists('screens/HomeScreen.tsx'), false);
  assert.equal(exists('components/NewTaskSheet.tsx'), false);
  assert.doesNotMatch(read('state/sheetStore.ts'), /newTask/);
  assert.doesNotMatch(read('components/CupertinoSheetHost.tsx'), /NewTaskSheet|newTask/);
});

test('IA8: ConnectScreen is the only unpaired entry', () => {
  const rootView = read('AppRoot.tsx');
  assert.match(rootView, /if \(usable\) return <AppShell/);
  assert.match(rootView, /return <ConnectScreen onRevalidate=\{retrySaved\} \/>/);
  assert.doesNotMatch(read('screens/ThreadsScreen.tsx'), /ConnectScreen/);
  assert.doesNotMatch(read('screens/SettingsScreen.tsx'), /ConnectScreen/);
});


