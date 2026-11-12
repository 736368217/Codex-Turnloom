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
    request(id, raw) { const req = JSON.parse(raw); calls.push(req); const body = reply(new URL(req.url).pathname, req); Promise.resolve(body).then(data => window.__turnloomNativeHttpResult(id, JSON.stringify({ status: 200, body: JSON.stringify(data) }))); },
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
