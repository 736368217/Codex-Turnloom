'use strict';

/**
 * Chat UX contract tests. Pure helpers and state stores are EXECUTED from the
 * production TypeScript files; static checks pin CSS/JSX wiring that needs a
 * WebView. No assertion is relaxed for a defect.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'src');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function makeLoader(stub = () => undefined) {
  const modules = new Map();
  function load(file) {
    let full = path.resolve(SRC, file);
    if (!path.extname(full)) full += '.ts';
    if (modules.has(full)) return modules.get(full).exports;
    const mod = { exports: {} };
    modules.set(full, mod);
    let js = stripTypeScriptTypes(fs.readFileSync(full, 'utf8'));
    const names = [...js.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g)].map((m) => m[1]);
    js = js
      .replace(/import\s+type\s+[^;]+;/g, '')
      .replace(/import\s+(?:type\s+)?\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/g, (_, vars, source) =>
        `const {${vars.replace(/\btype\s+/g, '')}} = require(${JSON.stringify(source)});`)
      .replace(/export default [^;]+;/g, '')
      .replace(/\bexport\s+(?=(?:async\s+)?(?:function|const|class|interface|type))/g, '');
    new Function('require', 'module', 'exports', js + '\n' + names.map((name) => `exports.${name} = ${name};`).join('\n'))(
      (source) => {
        if (source === 'react') return { useSyncExternalStore() {} };
        if (source === 'vaul' || source === 'lucide-react' || source === 'konsta/react' || source === 'motion/react') return {};
        const external = stub(source);
        if (external !== undefined) return external;
        return load(path.resolve(path.dirname(full), source));
      }, mod, mod.exports,
    );
    return mod.exports;
  }
  return { load, modules };
}

function harness() {
  const storage = new Map();
  const calls = [];
  let reply = (route) => route === '/api/harnesses'
    ? { ok: true, protocol: 'codex-turnloom', version: 2, machineId: 'machine', machineName: 'Computer', defaultHarnessId: 'codex', harnesses: [{ id: 'codex', name: 'Codex', kind: 'codex', token: 'code-token', defaultHarness: true }] }
    : { ok: true };
  const native = {
    secureGet: (key) => storage.get(key) ?? null,
    secureSet: (key, value) => { storage.set(key, value); return true; },
    secureRemove: (key) => storage.delete(key),
    getAppInfo: () => JSON.stringify({ version: '2.1.2', versionCode: 83, packageName: 'com.codex.turnloom.app' }),
    cancelRequest() {},
    request(id, raw) {
      const req = JSON.parse(raw);
      calls.push(req);
      Promise.resolve(reply(new URL(req.url).pathname, req)).then((data) =>
        global.window.__turnloomNativeHttpResult(id, JSON.stringify({ status: 200, body: JSON.stringify(data) })));
    },
  };
  global.window = { TurnloomNative: native };
  global.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {}, createElement: () => { throw new Error('no DOM picker in harness'); } };
  const { load } = makeLoader();
  const contract = load('lib/chatContract.ts');
  const session = load('state/sessionStore.ts');
  const api = load('lib/turnloomApi.ts');
  const data = load('state/dataStore.ts');
  const runtime = load('state/runtimeStore.ts');
  const composer = load('state/composerStore.ts');
  const bridge = load('lib/nativeBridge.ts');
  const logic = load('lib/composerLogic.ts');
  const pairing = { protocol: 'codex-turnloom', version: 2, source: 'manual', serverUrl: 'http://192.168.50.42:8787', machineToken: 'machine-token', machineId: '', machineName: 'Computer', discoverPath: '/api/harnesses' };
  return {
    contract, session, api, data, runtime, composer, bridge, logic, storage, calls, pairing,
    setReply(fn) { reply = fn; },
    context: () => session.currentRequestContext(),
  };
}

const HEALTH = {
  ok: true,
  defaultModel: 'real/sol',
  defaultEffort: 'medium',
  models: [
    { id: 'real/sol', label: 'GPT-5.6 Sol', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], defaultEffort: 'medium', supportsImages: true },
    { id: 'real/terra', label: 'GPT-5.6 Terra', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high', supportsImages: false },
  ],
};

test('idle, running, waiting and stale states come only from top-level status', () => {
  const c = harness().contract;
  assert.deepEqual(c.normalizeThreadStatus({ thinking: false, interactionRequired: false }), {
    state: 'ended', thinking: false, interactionRequired: false, staleTurn: false, turnId: null, startedAtMs: null,
  });
  assert.equal(c.isRunning(c.normalizeThreadStatus({ thinking: false })), false);
  const running = c.normalizeThreadStatus({ thinking: true, turnId: 'turn-1', startedAtMs: 1234 });
  assert.deepEqual(running, { state: 'running', thinking: true, interactionRequired: false, staleTurn: false, turnId: 'turn-1', startedAtMs: 1234 });
  assert.equal(c.isRunning(running), true);
  assert.equal(c.isRunning(c.normalizeThreadStatus({ thinking: true, staleTurn: true, turnId: 'old' })), false);
  assert.deepEqual(c.listStatusOf({ thinking: true, staleTurn: true }), { state: 'ended', thinking: false });
  assert.deepEqual(c.listStatusOf({ interactionRequired: true }), { state: 'waiting', thinking: false });
  assert.equal(c.isRunning(c.normalizeThreadStatus({ state: 'running', label: 'active' })), false);
  assert.equal(c.isRunning(c.normalizeThreadStatus('running')), false);
  assert.equal(c.isRunning(c.normalizeThreadStatus({ loading: true })), false);
});

test('messages response status persists separately; failed poll and status refresh keep history', async () => {
  const h = harness();
  const messages = [
    { role: 'user', kind: 'message', content: 'one', images: [] },
    { role: 'assistant', kind: 'message', content: 'two', images: [] },
    { role: 'user', kind: 'message', content: 'three', images: [] },
  ];
  h.setReply((route) => route === '/api/harnesses'
    ? { ok: true, protocol: 'codex-turnloom', version: 2, machineId: 'machine', harnesses: [{ id: 'codex', name: 'Codex', kind: 'codex', token: 'code-token', defaultHarness: true }] }
    : route === '/api/health' ? HEALTH
      : route === '/api/threads' ? { threads: [{ id: 't1', status: { state: 'ended', thinking: false } }] }
        : route.endsWith('/messages') ? { thread: { id: 't1', model: 'real/sol' }, messages, status: { thinking: true, turnId: 'turn-a', startedAtMs: 1000, interactionRequired: false } }
          : { ok: true });
  assert.equal(await h.session.connectWithPairing(h.pairing), true);
  const context = h.context();
  h.data.resetForScope(context);
  await h.data.refreshMessages(context, 't1');
  const stored = h.runtime.getThreadStatus(context.scope, 't1');
  assert.equal(stored.state, 'running');
  assert.equal(stored.turnId, 'turn-a');
  assert.equal(stored.startedAtMs, 1000);
  assert.equal(h.data.dataStore.getState().messagesByThread.t1.length, 3);
  assert.notEqual(h.data.dataStore.getState().messagesByThread.t1, h.data.dataStore.getState().statusByThread.t1);
  assert.equal(h.data.dataStore.getState().statusByThread.t1.thinking, true);

  // A status-only refresh after send/stop must never truncate history to limit=1.
  h.setReply((route) => route.endsWith('/messages')
    ? { messages: messages.slice(-1), status: { thinking: false, interactionRequired: false } }
    : { ok: true });
  await h.data.refreshThreadStatus(context, 't1');
  assert.equal(h.data.dataStore.getState().messagesByThread.t1.length, 3);
  assert.equal(h.runtime.getThreadStatus(context.scope, 't1').state, 'ended');

  // A real HTTP failure leaves the last authoritative status intact.
  h.setReply((route) => route.endsWith('/messages')
    ? { messages, status: { thinking: true, interactionRequired: false } }
    : { ok: true });
  await h.data.refreshMessages(context, 't1');
  global.window.TurnloomNative.request = (id) => global.window.__turnloomNativeHttpResult(id, JSON.stringify({ status: 503, body: JSON.stringify({ error: 'offline' }) }));
  await h.data.refreshMessages(context, 't1');
  assert.equal(h.runtime.getThreadStatus(context.scope, 't1').state, 'running');
  assert.equal(h.data.dataStore.getState().statusByThread.t1.state, 'running');
});

test('explicit per-thread model choice wins; thread model is only first-entry fallback', async () => {
  const h = harness();
  const catalog = h.runtime.applyHealth('machine::codex', HEALTH);
  assert.equal(catalog.defaultModel, 'real/sol');
  assert.equal(catalog.defaultEffort, 'medium');
  assert.deepEqual(catalog.models[0].efforts, ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
  assert.equal(catalog.models[1].efforts.includes('ultra'), false);
  assert.equal(catalog.models[1].supportsImages, false);

  const initial = h.contract.resolveTurnPreference(catalog, { model: '', effort: '' }, 'real/terra');
  assert.deepEqual(initial, { model: 'real/terra', effort: 'high' });
  // User switches to Sol: it must override the thread's Terra and keep a valid effort.
  const overridden = h.contract.resolveTurnPreference(catalog, { model: 'real/sol', effort: 'ultra' }, 'real/terra');
  assert.deepEqual(overridden, { model: 'real/sol', effort: 'ultra' });
  assert.equal(h.contract.resolveTurnPreference(catalog, { model: 'real/terra', effort: 'ultra' }, 'real/sol').effort, 'high', 'invalid saved effort falls back to the model default');
  assert.equal(h.contract.resolveTurnPreference(catalog, { model: 'does/not-exist', effort: 'nope' }, '').model, 'real/sol');

  // The selected ID reaches the real POST body, not merely the local preference.
  assert.equal(await h.session.connectWithPairing(h.pairing), true);
  const context = h.context();
  await h.api.postSend(context, {
    threadId: 't1', message: 'use selected model', clientRequestId: 'req-choice',
    model: overridden.model, effort: overridden.effort, images: [], files: [],
  });
  const sent = JSON.parse(h.calls.find((call) => new URL(call.url).pathname === '/api/send').body);
  assert.equal(sent.model, 'real/sol');
  assert.equal(sent.effort, 'ultra');

  const unknown = h.contract.normalizeHealthCatalog({ models: [{ id: 'm', efforts: ['low'], label: 'M' }] }, 's');
  assert.equal(unknown.models[0].supportsImages, null, 'unknown capability is not claimed false');
  assert.equal(h.contract.supportsImages(unknown, 'm'), null);
  h.runtime.selectRuntimeScope('machine::codex');
  assert.equal(h.runtime.getModelCatalog('machine::codex').models[0].id, 'real/sol');
  assert.equal(h.runtime.getModelCatalog('other::pi'), null);
});

test('send body carries exact model/effort and plain base64 images/files', async () => {
  const h = harness();
  const payload = h.contract.buildSendPayload({
    message: 'look', clientRequestId: 'req-1', model: 'real/sol', effort: 'xhigh',
    attachments: [
      { id: 'i', name: 'a.png', mimeType: 'image/png', sizeBytes: 3, data: 'data:image/png;base64,QUJD', dataUrl: 'data:image/png;base64,QUJD', kind: 'image' },
      { id: 'f', name: 'a.txt', mimeType: 'text/plain', sizeBytes: 2, data: 'ZG9j', kind: 'file' },
    ],
  });
  assert.deepEqual(payload.images, [{ name: 'a.png', mimeType: 'image/png', data: 'QUJD' }]);
  assert.deepEqual(payload.files, [{ name: 'a.txt', mimeType: 'text/plain', data: 'ZG9j' }]);
  assert.equal(JSON.stringify(payload).includes('data:image'), false);
  const identity = h.contract.sendRequestIdentity({ ...payload, threadId: 't1', newThread: false });
  assert.equal(identity, h.contract.sendRequestIdentity({ ...payload, threadId: 't1', newThread: false }));
  assert.notEqual(identity, h.contract.sendRequestIdentity({ ...payload, model: 'real/terra', threadId: 't1' }));
  assert.equal(await h.session.connectWithPairing(h.pairing), true);
  const context = h.context();
  await h.api.postSend(context, { ...payload, threadId: 't1' });
  const sent = JSON.parse(h.calls.find((call) => new URL(call.url).pathname === '/api/send').body);
  assert.equal(sent.model, 'real/sol');
  assert.equal(sent.effort, 'xhigh');
  assert.equal(sent.clientRequestId, 'req-1');
  assert.deepEqual(sent.images, payload.images);
  assert.deepEqual(sent.files, payload.files);
  await h.api.postNewThread(context, { ...payload, newThread: true });
  const created = JSON.parse(h.calls.filter((call) => new URL(call.url).pathname === '/api/send').at(-1).body);
  assert.equal(created.newThread, true);
  assert.equal(created.model, 'real/sol');
  assert.deepEqual(created.files, payload.files);
});

test('attachment limits, image types, text-only model and failure-safe tray', () => {
  const c = harness().contract;
  const item = (name, mimeType, kind = 'image', data = 'QUJD', sizeBytes = 3) => ({ id: name, name, mimeType, kind, data, sizeBytes });
  const existing = [item('one.png', 'image/png')];
  assert.equal(c.validateAttachments(existing, [item('two.webp', 'image/webp')], true).ok, true);
  assert.equal(c.validateAttachments(existing, [item('bad.gif', 'image/gif')]).ok, false);
  assert.equal(c.validateAttachments(existing, [item('bad.gif', 'image/gif')]).attachments, existing);
  assert.equal(c.validateAttachments(existing, [item('pic.png', 'image/png')], false).ok, false);
  assert.equal(c.validateAttachments(existing, Array.from({ length: 4 }, (_, n) => item(`x${n}.png`, 'image/png'))).ok, false);
  assert.equal(c.validateAttachments([], [item('large.pdf', 'application/pdf', 'file', 'QUJD', 5 * 1024 * 1024)]).ok, false);
  assert.equal(c.validateAttachments([], Array.from({ length: 2 }, (_, n) => item(`big${n}.pdf`, 'application/pdf', 'file', 'QUJD', 4 * 1024 * 1024))).ok, false);
  assert.equal(c.messageText({ content: 'hello' }), 'hello');
  assert.equal(c.messageText({ text: 'legacy' }), 'legacy');
  assert.equal(c.messageText({ content: 42 }), '42');
});

test('native picker callback resolves success/cancel/error and browser fallback is real', async () => {
  const b = harness().bridge;
  assert.equal(b.hasNativeAttachmentPicker(), false);
  global.window.TurnloomNative.pickAttachments = (id, kind) => {
    assert.equal(kind, 'image');
    global.window.__turnloomNativeAttachmentsResult(id, JSON.stringify({
      status: 'success', items: [{ name: 'a.png', mimeType: 'image/png', sizeBytes: 3, dataUrl: 'data:image/png;base64,QUJD' }],
    }));
  };
  assert.equal(b.hasNativeAttachmentPicker(), true);
  const result = await b.pickAttachments('image');
  assert.equal(result.status, 'success');
  assert.equal(result.items[0].dataUrl.startsWith('data:'), true);
  global.window.TurnloomNative.pickAttachments = (id) => global.window.__turnloomNativeAttachmentsResult(id, JSON.stringify({ status: 'cancelled', items: [] }));
  assert.equal((await b.pickAttachments('file')).status, 'cancelled');
  global.window.TurnloomNative.pickAttachments = (id) => global.window.__turnloomNativeAttachmentsResult(id, JSON.stringify({ status: 'error', error: 'permission-denied', items: [] }));
  assert.equal((await b.pickAttachments('file')).error, 'permission-denied');
  global.window.__turnloomNativeAttachmentsResult('attach-stale', JSON.stringify({ status: 'success', items: [] }));
  assert.equal(b.hasNativeAttachmentPicker(), true);
  const bridge = read('app/src/lib/nativeBridge.ts');
  assert.doesNotMatch(bridge.replace(/not a fabricated picker result/g, ''), /fake|placeholder|fabricated/i);
  assert.match(bridge, /input\.type = 'file'/);
});

test('picker results are scoped; send success keeps newer input and other threads', () => {
  const h = harness();
  const c = h.composer;
  const l = h.logic;
  const item = { id: 'i', name: 'a.png', mimeType: 'image/png', sizeBytes: 3, data: 'QUJD', kind: 'image' };
  c.selectComposer('machine::codex', 't1');
  c.setComposerText('keep this draft');
  c.setComposerAttachments([item]);

  const late = l.pickerTrayForResult({
    result: { status: 'success', items: [{ name: 'late.png', mimeType: 'image/png', sizeBytes: 3, dataUrl: 'data:image/png;base64,TEFU' }] },
    kind: 'image', originScope: 'machine::codex', originThread: 't1',
    selectedScope: 'machine::codex', selectedThread: 't2', existing: [], imageSupport: true,
  });
  assert.equal(late.ignored, true, 'late picker cannot add files after switching thread');
  assert.equal(late.targetScope, 'machine::codex');
  assert.equal(late.targetThread, 't1');
  assert.equal(late.attachments.length, 0);

  const valid = l.pickerTrayForResult({
    result: { status: 'success', items: [{ name: 'ok.webp', mimeType: 'image/webp', sizeBytes: 3, dataUrl: 'data:image/webp;base64,T0s=' }] },
    kind: 'image', originScope: 'machine::codex', originThread: 't1',
    selectedScope: 'machine::codex', selectedThread: 't1', existing: [item], imageSupport: true,
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.attachments.length, 2);
  c.setComposerAttachments(valid.attachments, 'machine::codex', 't1');

  // A send that succeeds while the user typed a newer draft must keep it.
  c.setComposerText('new input while sending');
  c.clearComposerInputs('machine::codex', 't1', 'keep this draft', [item]);
  assert.equal(c.currentComposerState().text, 'new input while sending');
  assert.equal(c.composerStateFor('machine::codex', 't1').text, 'new input while sending');
  assert.equal(c.composerStateFor('machine::codex', 't1').attachments.length, 2);

  // Successful clear of unchanged inputs touches exactly one scope/thread.
  c.selectComposer('machine::pi', 'same');
  c.setComposerText('other thread');
  c.clearComposerInputs('machine::codex', 't1', 'new input while sending', valid.attachments);
  assert.equal(c.composerStateFor('machine::pi', 'same').text, 'other thread');
  assert.equal(c.composerStateFor('machine::codex', 't1').text, '');
  assert.equal(c.composerStateFor('machine::codex', 't1').attachments.length, 0);
});

test('per-thread composer state survives remount and repeated failures keep the retry ID', () => {
  const h = harness();
  const c = h.composer;
  c.selectComposer('machine::codex', 't1');
  c.setComposerText('keep this draft');
  c.setComposerAttachments([{ id: 'i', name: 'a.png', mimeType: 'image/png', sizeBytes: 3, data: 'QUJD', kind: 'image' }]);
  c.saveTurnPreference('machine::codex', 't1', { model: 'real/sol', effort: 'xhigh' });
  const identity = JSON.stringify({ message: 'keep this draft', model: 'real/sol', effort: 'xhigh' });
  const first = c.clientRequestIdFor(identity);
  c.selectComposer('machine::codex', 't1');
  assert.equal(c.currentComposerState().text, 'keep this draft');
  assert.equal(c.currentComposerState().attachments[0].data, 'QUJD');
  assert.equal(c.currentComposerState().preference.model, 'real/sol');
  assert.equal(c.clientRequestIdFor(identity), first);
  c.saveTurnPreference('machine::codex', 't1', { model: 'real/terra', effort: 'high' });
  c.selectComposer('machine::pi', 'same');
  assert.equal(c.currentComposerState().text, '');
  assert.equal(c.currentComposerState().attachments.length, 0);
  assert.notEqual(c.clientRequestIdFor(identity), first);
  c.selectComposer('machine::codex', 't1');
  assert.equal(c.readTurnPreference('machine::codex', 't1').model, 'real/terra');
  assert.equal(c.currentComposerState().attachments[0].name, 'a.png');
  assert.equal([...h.storage.entries()].some(([, value]) => String(value).includes('QUJD')), false);
  c.clearComposerInputs('machine::codex', 't1', 'keep this draft', c.currentComposerState().attachments);
  assert.equal(c.currentComposerState().text, '');
  assert.equal(c.currentComposerState().attachments.length, 0);
});

test('270-model sheet: provider filter, searchable real IDs, sticky effort after switch', () => {
  const h = harness();
  const rawHealth = {
    backend: { kind: 'pi' },
    defaultModel: 'provider/model-0',
    defaultEffort: 'low',
    models: Array.from({ length: 270 }, (_, n) => ({
      id: `provider/model-${n}`,
      label: `Real model ${n}`,
      efforts: n % 2 ? ['low', 'medium'] : ['low', 'medium', 'high'],
      defaultEffort: 'medium',
      supportsImages: n % 3 === 0,
    })),
  };
  const big = h.contract.normalizeHealthCatalog(rawHealth, 's');
  const match = h.logic.filterModels(big, 'MODEL-269');
  assert.equal(match.length, 1);
  assert.equal(match[0].id, 'provider/model-269', 'search matches exact backend ID, not a fabricated label');
  assert.equal(h.logic.filterModels(big, 'no-such-model').length, 0);
  assert.equal(h.logic.filterModels(big, '').length, 270);
  assert.deepEqual(h.logic.providerOptions(big), ['全部', 'provider']);
  assert.equal(h.logic.filterModelsByProvider(big, 'provider', '').length, 270);
  assert.equal(h.logic.filterModelsByProvider(big, 'provider', 'MODEL-269').length, 1);
  assert.equal(h.logic.filterModelsByProvider(big, 'absent', '').length, 0);
  assert.equal(h.logic.shortModelName({ id: 'p/deepseek-flash', label: 'DeepSeek V4.1 Flash · 77625 free' }), 'DeepSeek V4.1 Flash');
  assert.equal(h.logic.shortModelName({ id: 'p/deepseek-flash', label: '' }), 'deepseek-flash');
  const selected = h.logic.sheetPreference(big, { model: 'provider/model-0', effort: 'high' }, 'provider/model-269');
  assert.deepEqual(selected, { model: 'provider/model-269', effort: 'medium' });
  const composer = read('app/src/components/ChatComposer.tsx');
  // One status button opens the picker; no duplicate model/effort chips remain.
  assert.equal((composer.match(/aria-label=\{`模型与思考强度：/g) || []).length, 1);
  assert.doesNotMatch(composer, /tl-composer-meta|tl-composer-chip/);
  assert.ok(composer.indexOf('tl-mp-providers') < composer.indexOf('tl-mp-list'), 'provider chips precede the model list');
  assert.ok(composer.indexOf('tl-mp-list') < composer.indexOf('tl-mp-effort'), 'sticky effort follows the scrolling list');
  assert.match(composer, /aria-label="搜索模型"/);
  assert.match(composer, /aria-label="供应商"/);
  const css = read('app/src/theme/globals.css');
  assert.match(css, /\.tl-mp-effort\s*\{[^}]*position:\s*sticky[^}]*bottom:\s*0/s, 'effort stays reachable with 270 models');
  assert.match(css, /\.tl-mp-list\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.tl-mp-segment\s*\{/);
});

test('long multiline messages remain compact at 393px and 320px', () => {
  const h = harness();
  const long = `first line\nsecond line\n${'x'.repeat(320)}\n\n\n\n\n\n\n\n\nlast line`;
  const compact = h.contract.compactMessageText(long);
  assert.match(compact, /first line\nsecond line/);
  assert.match(compact, /last line/);
  assert.equal((compact.match(/\n{4,}/g) || []).length, 0);
  const styles = (() => {
    const { load } = makeLoader();
    return load('theme/chatStyles.ts');
  })();
  assert.equal(styles.CHAT_BUBBLE_LINE_HEIGHT >= 20 && styles.CHAT_BUBBLE_LINE_HEIGHT <= 24, true);
  assert.equal(styles.CHAT_BUBBLE_FONT_SIZE >= 12 && styles.CHAT_BUBBLE_FONT_SIZE <= 16, true);
  assert.equal(styles.chatBubbleStyle(true).lineHeight, `${styles.CHAT_BUBBLE_LINE_HEIGHT}px`);
  assert.equal(styles.chatBubbleStyle(false).whiteSpace, 'pre-wrap');
  assert.match(styles.CHAT_COMPACT_CSS, /max-width:\s*393px/);
  assert.match(styles.CHAT_COMPACT_CSS, /max-width:\s*320px/);
  assert.match(styles.CHAT_COMPACT_CSS, /justify-content:\s*flex-start/);
  assert.doesNotMatch(styles.CHAT_COMPACT_CSS, /space-between|space-around|space-evenly/);
  const css = read('app/src/theme/globals.css');
  assert.match(css, /\.tl-chat-bubble\s*\{[^}]*line-height:\s*21px/s);
  assert.match(css, /\.tl-chat-bubble \*[^}]*min-height:\s*0/s);
  assert.doesNotMatch(css, /\.tl-thumbbar\s*\{/);
  assert.match(css, /\.tl-composer-button\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/s);
  assert.match(css, /@media \(max-height: 420px\)/);
  assert.match(css, /@media \(max-width: 393px\)/);
  assert.match(css, /@media \(max-width: 320px\)/);
});

test('screen wiring: header back only, two picker buttons, one primary, no fake approvals', () => {
  const screen = read('app/src/screens/ChatDetailScreen.tsx');
  const composer = read('app/src/components/ChatComposer.tsx');
  const css = read('app/src/theme/globals.css');
  assert.match(screen, /<header[^>]*>[\s\S]*aria-label="返回"[\s\S]*<\/header>/);
  assert.match(screen, /<form className="tl-composer"/);
  assert.doesNotMatch(screen, /tl-thumbbar|openSheet\('approval'|openSheet\('interruptAll'|ThumbGlassBar/);
  assert.doesNotMatch(composer, /aria-label="返回"|aria-label="审批"|permanent/i);
  assert.match(composer, /aria-label="图片"/);
  assert.match(composer, /aria-label="附件"/);
  assert.match(composer, /aria-label=\{running \? '停止' : '发送'\}/);
  assert.equal((composer.match(/type="submit"/g) || []).length, 1);
  assert.match(composer, /pickAttachments\(kind\)/);
  assert.match(composer, /VaulSheet/);
  assert.doesNotMatch(read('app/src/components/ApprovalSheet.tsx'), /resolveApproval|待审批操作/);
  // Strip comments before checking code identifiers, without disabling the assertion.
  assert.doesNotMatch(stripComments(read('app/src/components/CupertinoSheetHost.tsx')), /'approval'|'interruptAll'|ApprovalSheet/);
  assert.match(read('app/src/state/sheetStore.ts'), /fake approval/);
  assert.match(css, /\.tl-detail-body\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /position:\s*relative;\s*z-index:\s*30/s);
  assert.match(read('app/src/components/NewTaskSheet.tsx'), /model: fields\.preference\.model/);
  assert.match(read('app/src/components/NewTaskSheet.tsx'), /effort: fields\.preference\.effort/);
  assert.match(read('app/src/components/NewTaskSheet.tsx'), /images|files/);
});

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('text-only model explains images before opening the native picker', () => {
  const composer = read('app/src/components/ChatComposer.tsx');
  const start = composer.indexOf('aria-label="图片"');
  const end = composer.indexOf('aria-label="附件"');
  assert.ok(start > 0 && end > start, 'image button block must exist before the file button');
  const block = composer.slice(start, end);
  assert.match(block, /imageSupport === false/, 'known text-only capability must be checked');
  assert.match(block, /仅支持文字/, 'the user must get a concrete reason');
  assert.ok(block.indexOf('imageSupport === false') < block.indexOf("pick('image')"),
    'the capability gate must run before the native picker opens');
});
