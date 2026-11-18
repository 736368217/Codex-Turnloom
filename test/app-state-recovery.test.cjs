'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const root = path.resolve(__dirname, '../app/src');
// Execute the production TS state modules, with only React rendering and the
// Android boundary replaced. No copied state-machine implementation.
function harness() {
  const storage = new Map(); const calls = []; const modules = new Map();
  const rows = [{ id: 'codex', name: 'Codex', kind: 'codex', token: 'code-token', defaultHarness: true }, { id: 'pi', name: 'Pi', kind: 'pi', token: 'pi-token' }];
  let reply = route => route === '/api/harnesses'
    ? { ok: true, protocol: 'codex-turnloom', version: 2, machineId: 'machine', machineName: 'Computer', defaultHarnessId: 'codex', harnesses: rows }
    : route.includes('/messages') ? { messages: [] } : route === '/api/threads' ? { threads: [{ id: 'one', title: 'Live' }] } : { ok: true };
  global.window = { TurnloomNative: {
    secureGet: key => storage.get(key) ?? null,
    secureSet: (key, value) => { storage.set(key, value); return true; },
    secureRemove: key => storage.delete(key),
    getAppInfo: () => JSON.stringify({ version: '2.1.1', versionCode: 82, packageName: 'com.codex.turnloom.app' }),
    cancelRequest() {},
    request(id, raw) { const req = JSON.parse(raw); calls.push(req); const body = reply(new URL(req.url).pathname, req); Promise.resolve(body).then(data => window.__turnloomNativeHttpResult(id, JSON.stringify(data?.__nativeResult || { status: 200, body: JSON.stringify(data) }))); },
  }};
  function load(file) {
    file = path.resolve(root, file);
    if (!path.extname(file)) file += '.ts';
    if (modules.has(file)) return modules.get(file).exports;
    const mod = { exports: {} }; modules.set(file, mod);
    let js = stripTypeScriptTypes(fs.readFileSync(file, 'utf8'));
    const names = [...js.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g)].map(m => m[1]);
    js = js.replace(/import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/g, (_, vars, source) => `const {${vars}} = require(${JSON.stringify(source)});`)
      .replace(/export default [^;]+;/g, '').replace(/\bexport\s+(?=(?:async\s+)?(?:function|const|class))/g, '');
    new Function('require', 'module', 'exports', js + '\n' + names.map(name => `exports.${name} = ${name};`).join('\n'))(source => source === 'react' ? { useSyncExternalStore() {} } : load(path.resolve(path.dirname(file), source)), mod, mod.exports);
    return mod.exports;
  }
  const session = load('state/sessionStore.ts'); const api = load('lib/turnloomApi.ts'); const data = load('state/dataStore.ts');
  return { storage, calls, load, session, api, data, setReply(fn) { reply = fn; }, pairing: { protocol: 'codex-turnloom', version: 2, source: 'manual', serverUrl: 'http://192.168.50.42:8787', machineToken: 'machine-token', machineId: '', machineName: 'Computer', discoverPath: '/api/harnesses' } };
}
test('cold hydration followed by repeated foreground revalidation reaches ready', async () => {
  const h = harness();
  assert.equal(await h.session.connectWithPairing(h.pairing), true);
  const saved = h.session.hydrateSession();
  assert.ok(saved);
  assert.equal(await h.session.revalidatePersisted(saved), true);
  assert.equal(await h.session.revalidatePersisted(saved), true);
  assert.equal(h.session.sessionStore.getState().status, 'ready');
});
test('latest connection wins and discarded discovery cannot overwrite it', async () => {
  const h = harness(); let release;
  h.setReply(route => route === '/api/harnesses' ? new Promise(resolve => { release = resolve; }) : { ok: true });
  const pending = h.session.connectWithPairing(h.pairing);
  h.session.unpair();
  release({ ok: true, protocol: 'codex-turnloom', version: 2, machineId: 'machine', harnesses: [] });
  assert.equal(await pending, false);
  assert.equal(h.session.sessionStore.getState().status, 'unpaired');
});
test('switch isolates tokens and clears old detail and filters', async () => {
  const h = harness(); await h.session.connectWithPairing(h.pairing);
  const tabs = h.load('state/tabStore.ts'); tabs.openDetail('same-id'); tabs.setThreadsQuery('codex-only');
  assert.equal(await h.session.switchHarness('pi'), true);
  assert.equal(h.session.currentRequestContext().target.token, 'pi-token');
  assert.equal(tabs.tabStore.getState().detailThreadId, null);
  assert.equal(tabs.tabStore.getState().threadsQuery, '');
});
test('cache off stops reads/writes; clear cache does not erase the live list', async () => {
  const h = harness(); await h.session.connectWithPairing(h.pairing);
  const ctx = h.session.currentRequestContext(); h.data.resetForScope(ctx); await h.data.refreshAll(ctx);
  const key = h.session.cacheKeyFor(ctx.scope, 'threads'); assert.ok(h.storage.has(key));
  h.data.clearOfflineCache(ctx); assert.equal(h.storage.has(key), false); assert.equal(h.data.dataStore.getState().threads.length, 1);
  h.session.setOfflineCacheEnabled(false); await h.data.refreshAll(ctx); assert.equal(h.storage.has(key), false);
  h.data.resetForScope(ctx); assert.equal(h.data.dataStore.getState().threads.length, 0);
});
test('empty messages finish loading and failed load offers a retryable error', async () => {
  const h = harness(); await h.session.connectWithPairing(h.pairing);
  const ctx = h.session.currentRequestContext(); h.data.resetForScope(ctx); await h.data.refreshMessages(ctx, 'empty');
  assert.deepEqual(h.data.dataStore.getState().messageState.empty, { loading: false, loaded: true, error: '' });
  h.setReply(() => ({})); await h.data.refreshMessages(ctx, 'empty');
  assert.equal(h.data.dataStore.getState().messageState.empty.loading, false);
});
test('drafts survive detail remount and identical IDs in another service stay isolated', () => {
  const h = harness(); const d = h.load('state/draftStore.ts');
  d.saveDraft('machine::codex', 'same', 'keep me');
  assert.equal(d.readDraft('machine::pi', 'same'), '');
  assert.equal(d.readDraft('machine::codex', 'same'), 'keep me');
  d.saveDraft('machine::codex', 'same', ''); assert.equal(d.readDraft('machine::codex', 'same'), '');
});
test('update progress and installer cancellation survive screen unmount', () => {
  const h = harness(); const u = h.load('state/updateStore.ts'); const bridge = h.load('lib/nativeBridge.ts');
  u.setRequestId('update-test'); bridge.deliverUpdateEvent('update-test', JSON.stringify({ state: 'downloading', received: 20, total: 100 }));
  assert.equal(u.updateStore.getState().progress.received, 20);
  bridge.deliverUpdateEvent('unrelated', JSON.stringify({ state: 'error' })); assert.equal(u.updateStore.getState().state, 'downloading');
  bridge.deliverUpdateEvent('update-test', JSON.stringify({ state: 'ready' }));
  bridge.deliverUpdateEvent('update-test', JSON.stringify({ state: 'error', message: 'install-cancelled' }));
  assert.equal(u.updateStore.getState().state, 'ready');
});

test('HTTP business failures keep connection online; only transport failure marks offline', async () => {
  const h = harness(); await h.session.connectWithPairing(h.pairing);
  const ctx = h.session.currentRequestContext(); h.data.resetForScope(ctx);
  for (const status of [500, 403, 0]) {
    h.setReply(() => ({ __nativeResult: { status, body: '{"error":"fixture-error"}', error: status ? undefined : 'timeout' } }));
    assert.equal(await h.data.sendMessage(ctx, 'one', { message: 'keep draft', clientRequestId: `failure-${status}` }), false);
    assert.equal(h.data.dataStore.getState().offline, status === 0);
    assert.equal(h.session.sessionStore.getState().online, status !== 0);
    assert.match(h.data.dataStore.getState().error, status === 500 ? /服务出错/ : status === 403 ? /不允许写入/ : /连不上/);
  }
});

test('pagination deduplicates history, keeps it on polling, and retries the same cursor after HTTP error', async () => {
  const h = harness(); await h.session.connectWithPairing(h.pairing);
  const ctx = h.session.currentRequestContext(); h.data.resetForScope(ctx);
  h.setReply(() => ({ threads: [{ id: 'head' }], total: 3, nextCursor: '60' }));
  await h.data.refreshThreads(ctx);
  h.setReply(() => ({ __nativeResult: { status: 500, body: '{}' } }));
  await h.data.loadMoreThreads(ctx);
  assert.equal(h.data.dataStore.getState().nextCursor, '60');
  assert.equal(h.data.dataStore.getState().offline, false);
  h.setReply((route, req) => { assert.equal(new URL(req.url).searchParams.get('cursor'), '60'); return { threads: [{ id: 'head' }, { id: 'older' }], total: 3, nextCursor: '120' }; });
  await h.data.loadMoreThreads(ctx);
  assert.deepEqual(h.data.dataStore.getState().threads.map(row => row.id), ['head', 'older']);
  h.setReply(() => ({ threads: [{ id: 'new-head' }, { id: 'head' }], total: 4, nextCursor: '60' }));
  await h.data.refreshThreads(ctx);
  assert.deepEqual(h.data.dataStore.getState().threads.map(row => row.id), ['new-head', 'head', 'older']);
  assert.equal(h.data.dataStore.getState().nextCursor, '120');
});

test('a late page cannot cross a harness switch or overwrite a newer head refresh', async () => {
  const h = harness(); await h.session.connectWithPairing(h.pairing);
  const ctx = h.session.currentRequestContext(); h.data.resetForScope(ctx);
  h.setReply(() => ({ threads: [{ id: 'head' }], nextCursor: '60' })); await h.data.refreshThreads(ctx);
  let release;
  h.setReply(() => new Promise(resolve => { release = resolve; }));
  const page = h.data.loadMoreThreads(ctx);
  h.setReply(() => ({ threads: [{ id: 'fresh' }], nextCursor: null }));
  await h.data.refreshThreads(ctx);
  release({ threads: [{ id: 'late' }], nextCursor: null }); await page;
  assert.deepEqual(h.data.dataStore.getState().threads.map(row => row.id), ['fresh']);
  h.setReply(() => ({ threads: [{ id: 'fresh' }], nextCursor: '60' })); await h.data.refreshThreads(ctx);
  h.setReply(() => new Promise(resolve => { release = resolve; })); const oldPage = h.data.loadMoreThreads(ctx);
  h.api.setActiveRequestScope('another-service', { origin: 'http://example.test', token: 'other' });
  const next = { scope: 'another-service', target: { origin: 'http://example.test', token: 'other' }, generation: h.api.getActiveGeneration() };
  h.data.resetForScope(next); release({ threads: [{ id: 'wrong-service' }] }); await oldPage;
  assert.equal(h.data.dataStore.getState().threads.length, 0);
});

test('native BACK closes nested drawers before leaving chat and unregisters closed layers', () => {
  const h = harness(); const bridge = h.load('lib/nativeBridge.ts'); const events = [];
  bridge.registerBackHandler(() => { events.push('chat'); return true; });
  const removeTask = bridge.pushNativeBackLayer(() => { events.push('task'); removeTask(); });
  const removeModel = bridge.pushNativeBackLayer(() => { events.push('model'); removeModel(); });
  assert.equal(window.__turnloomBack(), true);
  assert.deepEqual(events, ['model']);
  assert.equal(window.__turnloomBack(), true);
  assert.deepEqual(events, ['model', 'task']);
  assert.equal(window.__turnloomBack(), true);
  assert.deepEqual(events, ['model', 'task', 'chat']);
  const removeOld = bridge.pushNativeBackLayer(() => events.push('stale'));
  removeOld(); removeOld();
  bridge.registerBackHandler(null);
  assert.equal(window.__turnloomBack(), false);
});

test('monitor running count follows authoritative polls and a successful stop immediately', async () => {
  const h = harness(); await h.session.connectWithPairing(h.pairing);
  const ctx = h.session.currentRequestContext(); h.data.resetForScope(ctx);
  h.setReply(route => route === '/api/threads'
    ? { threads: [{ id: 'one', status: { thinking: true } }, { id: 'stale', status: { thinking: true, staleTurn: true } }] }
    : { status: { thinking: true } });
  await h.data.refreshThreads(ctx);
  assert.equal(h.data.dataStore.getState().runningCount, 1);
  let releasePoll;
  h.setReply(route => route.includes('/messages') ? new Promise(resolve => { releasePoll = resolve; }) : { ok: true });
  const inFlightPoll = h.data.refreshMessages(ctx, 'one');
  assert.equal(typeof releasePoll, 'function');
  assert.equal(await h.data.interruptThread(ctx, 'one'), true);
  const stopped = h.data.dataStore.getState();
  assert.equal(stopped.statusByThread.one.thinking, false);
  assert.equal(stopped.runningCount, 0);
  releasePoll({ status: { thinking: true } });
  await inFlightPoll;
  assert.equal(h.data.dataStore.getState().runningCount, 0, 'a pre-stop poll must not revive running');
  assert.equal(h.data.dataStore.getState().statusByThread.one.thinking, false);
  h.setReply(() => ({ status: { thinking: true } }));
  await h.data.refreshMessages(ctx, 'one');
  assert.equal(h.data.dataStore.getState().runningCount, 1);
  h.setReply(() => ({ __nativeResult: { status: 500, body: '{}' } }));
  await h.data.refreshMessages(ctx, 'one');
  assert.equal(h.data.dataStore.getState().runningCount, 1);
  assert.equal(h.data.dataStore.getState().statusByThread.one.thinking, true);
});

test('R07: an older running list arriving after Stop cannot revive badge or filter', async () => {
  const h = harness(); await h.session.connectWithPairing(h.pairing);
  const ctx = h.session.currentRequestContext(); h.data.resetForScope(ctx);
  h.setReply(route => route === '/api/threads'
    ? { threads: [{ id: 'one', title: 'Running', status: { state: 'running', thinking: true } }] }
    : { status: { thinking: true }, messages: [] });
  await h.data.refreshThreads(ctx);
  await h.data.refreshMessages(ctx, 'one');
  assert.equal(await h.data.interruptThread(ctx, 'one'), true);
  h.setReply(route => route === '/api/threads'
    ? { threads: [{ id: 'one', title: 'Running', status: { state: 'running', thinking: true } }] }
    : { status: { thinking: false }, messages: [] });
  await h.data.refreshThreads(ctx);
  const state = h.data.dataStore.getState();
  const { projectThread } = h.load('lib/threadProjection.ts');
  assert.equal(state.runningCount, 0);
  assert.equal(state.statusByThread.one.thinking, false);
  assert.equal(projectThread(state.threads[0], state.statusByThread).tone, 'done');
});

test('message history retries the cursor, keeps live status and survives tail polling', async () => {
  const h = harness(); await h.session.connectWithPairing(h.pairing);
  const ctx = h.session.currentRequestContext(); h.data.resetForScope(ctx);
  h.setReply(() => ({ messages: [{ id: 'tail', content: 'new' }], status: { thinking: false }, hasOlderMessages: true, olderCursor: 'tail' }));
  await h.data.refreshMessages(ctx, 'one');
  h.setReply(() => ({ __nativeResult: { status: 500, body: '{}' } }));
  await h.data.loadOlderMessages(ctx, 'one');
  assert.equal(h.data.dataStore.getState().messagePages.one.olderCursor, 'tail');
  assert.match(h.data.dataStore.getState().messagePages.one.error, /服务出错/);
  h.setReply((route, req) => { assert.equal(new URL(req.url).searchParams.get('before'), 'tail'); return { messages: [{ id: 'old', content: 'history' }, { id: 'tail', content: 'new' }], status: { thinking: true }, hasOlderMessages: false }; });
  await h.data.loadOlderMessages(ctx, 'one');
  assert.equal(h.data.dataStore.getState().statusByThread.one.thinking, false);
  h.setReply(() => ({ messages: [{ id: 'tail', content: 'updated' }, { id: 'fresh', content: 'latest' }], status: { thinking: false }, hasOlderMessages: true, olderCursor: 'tail' }));
  await h.data.refreshMessages(ctx, 'one');
  const state = h.data.dataStore.getState();
  assert.deepEqual(state.messagesByThread.one.map(row => row.id), ['old', 'tail', 'fresh']);
  assert.equal(state.messagesByThread.one[1].content, 'updated');
  assert.equal(state.messagePages.one.hasOlder, false);
});

test('a late message history page is discarded after changing service', async () => {
  const h = harness(); await h.session.connectWithPairing(h.pairing);
  const ctx = h.session.currentRequestContext(); h.data.resetForScope(ctx);
  h.setReply(() => ({ messages: [{ id: 'tail' }], olderCursor: 'tail', hasOlderMessages: true }));
  await h.data.refreshMessages(ctx, 'one');
  let release;
  h.setReply(() => new Promise(resolve => { release = resolve; }));
  const pending = h.data.loadOlderMessages(ctx, 'one');
  h.api.setActiveRequestScope('pi', { origin: 'http://example.test', token: 'other' });
  const next = { scope: 'pi', target: { origin: 'http://example.test', token: 'other' }, generation: h.api.getActiveGeneration() };
  h.data.resetForScope(next); release({ messages: [{ id: 'old-codex' }] }); await pending;
  assert.deepEqual(h.data.dataStore.getState().messagesByThread, {});
  assert.deepEqual(h.data.dataStore.getState().messagePages, {});
});
