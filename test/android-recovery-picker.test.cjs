'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const SRC = path.resolve(__dirname, '../app/src');

// Execute the production TS/TSX with deterministic bridge clocks and minimal host hooks.
function harness(native = {}, stubs = {}) {
  const window = { TurnloomNative: native };
  const timers = new Map();
  const inputs = [];
  const document = {
    body: { appendChild() {} },
    createElement() {
      const events = new Map();
      const input = {
        style: {}, files: [], clicks: 0, removes: 0,
        addEventListener: (name, callback) => events.set(name, callback),
        click() { this.clicks++; },
        remove() { this.removes++; },
        fire: (name) => events.get(name)?.(),
      };
      inputs.push(input);
      return input;
    },
  };
  let seq = 0;
  const cache = new Map();
  function load(file) {
    let full = path.resolve(SRC, file);
    if (!path.extname(full)) full += fs.existsSync(full + '.ts') ? '.ts' : '.tsx';
    if (cache.has(full)) return cache.get(full).exports;
    const module = { exports: {} };
    cache.set(full, module);
    let source = fs.readFileSync(full, 'utf8');
    if (full.endsWith('.tsx')) {
      // Run the complete production hook and its actual imports; omit unrelated JSX.
      const start = source.indexOf('export function useComposerFields(');
      const end = source.indexOf('\n}', start) + 2;
      assert.ok(start >= 0 && end > start);
      source = source.slice(0, source.indexOf('function AttachmentTray(')) + source.slice(start, end);
    }
    let js = stripTypeScriptTypes(source);
    const names = [...js.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g)].map((m) => m[1]);
    js = js.replace(/import\s+type\s+[^;]+;/g, '')
      .replace(/import\s+(?:type\s+)?\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/g,
        (_, vars, dep) => `const {${vars.replace(/\btype\s+/g, '').replace(/\s+as\s+/g, ': ')}} = require(${JSON.stringify(dep)});`)
      .replace(/import\s+(\w+)\s+from\s*['"]([^'"]+)['"];?/g,
        (_, name, dep) => `const ${name} = require(${JSON.stringify(dep)});`)
      .replace(/export default [^;]+;/g, '')
      .replace(/\bexport\s+(?=(?:async\s+)?(?:function|const|class))/g, '');
    js += '\n' + names.map((name) => `exports.${name} = ${name};`).join('\n');
    new Function('require', 'module', 'exports', 'window', 'document', 'setTimeout', 'clearTimeout', js)(
      (source) => {
        if (Object.hasOwn(stubs, source)) return stubs[source];
        if (source === 'react/jsx-runtime' || source === 'lucide-react' || source === './VaulSheet') return {};
        return load(path.resolve(path.dirname(full), source));
      }, module, module.exports, window, document,
      (callback, ms) => { const id = ++seq; timers.set(id, { callback, ms }); return id; },
      (id) => timers.delete(id),
    );
    return module.exports;
  }
  const bridge = load('lib/nativeBridge.ts');
  return { window, bridge, load, timers, inputs, fireTimer() {
    const [id, timer] = timers.entries().next().value;
    timers.delete(id);
    timer.callback();
  } };
}

const success = (name) => JSON.stringify({ status: 'success', items: [
  { name, mimeType: 'image/png', sizeBytes: 3, dataUrl: 'data:image/png;base64,QUJD' },
] });

test('timeout cancels native once, ignores late success, and next request succeeds', async () => {
  const launched = [];
  const cancelled = [];
  const h = harness({
    pickAttachments: (id) => { launched.push(id); },
    cancelAttachmentPick(id) {
      cancelled.push(id);
      // Even synchronous callbacks during cancel must not win over timeout.
      h.bridge.deliverAttachmentsResult(id, success('stale.png'));
    },
  });
  let settlements = 0;
  const first = h.bridge.pickAttachments('image', 9).then((result) => { settlements++; return result; });
  assert.equal(h.timers.values().next().value.ms, 9);
  h.fireTimer();
  assert.equal((await first).error, 'picker-timeout');
  assert.deepEqual(cancelled, [launched[0]]);
  assert.equal(h.timers.size, 0);
  const next = h.bridge.pickAttachments('image', 9);
  assert.notEqual(launched[0], launched[1]);
  h.bridge.deliverAttachmentsResult(launched[0], success('late.png'));
  h.bridge.deliverAttachmentsResult(launched[1], success('fresh.png'));
  assert.equal((await next).items[0].name, 'fresh.png');
  assert.equal(settlements, 1);
  assert.equal(cancelled.length, 1);
  assert.equal(h.timers.size, 0);
});

test('default allows ten minutes browsing and concurrent calls only open once', async () => {
  const launched = [];
  const h = harness({ pickAttachments: (id) => { launched.push(id); } });
  const first = h.bridge.pickAttachments('image');
  assert.equal(h.timers.values().next().value.ms, 600000);
  assert.equal((await h.bridge.pickAttachments('file')).error, 'picker-busy');
  assert.equal(launched.length, 1);
  h.window.__turnloomNativeAttachmentsResult(launched[0], JSON.stringify({ status: 'cancelled' }));
  assert.equal((await first).status, 'cancelled');
  assert.equal(h.timers.size, 0);
});

test('native readiness rejection and launch failure settle immediately and unlock', async () => {
  const native = { pickAttachments: () => 'bridge-not-ready' };
  const h = harness(native);
  assert.equal((await h.bridge.pickAttachments('file')).error, 'bridge-not-ready');
  assert.equal(h.timers.size, 0);
  native.pickAttachments = () => { throw new Error('no handler'); };
  assert.equal((await h.bridge.pickAttachments('file')).error, 'picker-unavailable');
  assert.equal(h.timers.size, 0);
  delete native.pickAttachments;
  assert.equal((await h.bridge.pickAttachments('file')).error, 'picker-unavailable');
  assert.equal(h.timers.size, 0);
  assert.equal(h.inputs.length, 0, 'an unavailable Android bridge must not wait on an unsupported WebView input');
});

test('browser cancel removes input once, clears timeout, and permits next selection', async () => {
  const h = harness(null);
  const first = h.bridge.pickAttachments('file');
  const input = h.inputs[0];
  assert.equal(input.clicks, 1);
  input.fire('cancel');
  input.fire('change');
  assert.equal((await first).status, 'cancelled');
  assert.equal(input.removes, 1);
  assert.equal(h.timers.size, 0);
  const next = h.bridge.pickAttachments('file');
  assert.equal(h.inputs.length, 2);
  h.inputs[1].fire('cancel');
  await next;
});

test('Chinese errors distinguish busy, unavailable, permission, readiness and timeout', () => {
  const logic = harness().load('lib/composerLogic.ts');
  const codes = ['picker-busy', 'picker-unavailable', 'permission-denied', 'bridge-not-ready', 'picker-timeout'];
  const messages = codes.map((error) => logic.pickerErrorMessage({ status: 'error', error }));
  assert.equal(new Set(messages).size, codes.length);
  messages.forEach((message) => assert.match(message, /[\u4e00-\u9fff]/));
  const existing = [{ id: 'preserved' }];
  for (const [index, error] of codes.entries()) {
    const result = logic.pickerTrayForResult({ result: { status: 'error', error }, kind: 'file',
      originScope: 's', originThread: 't', selectedScope: 's', selectedThread: 't', existing, imageSupport: null });
    assert.equal(result.attachments, existing);
    assert.equal(result.error, messages[index]);
  }
});

test('production composer synchronously guards double taps and unlocks after cancellation', async () => {
  let resolvePick;
  let opens = 0;
  const composer = { scope: 's', threadId: 't', preference: { model: '', effort: '' }, attachments: [] };
  const h = harness({}, {
    react: { useEffect() {}, useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}], useRef: (value) => ({ current: value }) },
    '../lib/nativeBridge': { haptic() {}, pickAttachments() { opens++; return new Promise((resolve) => { resolvePick = resolve; }); } },
    '../state/composerStore': { useComposerState: () => composer, currentComposerState: () => composer, composerStateFor: () => composer },
    '../state/runtimeStore': { getModelCatalog: () => null },
    '../state/dataStore': {}, '../state/sessionStore': {},
  });
  const fields = h.load('components/ChatComposer.tsx').useComposerFields('s', 't');
  const first = fields.pick('image');
  await fields.pick('file');
  assert.equal(opens, 1);
  resolvePick({ status: 'cancelled' });
  await first;
  const next = fields.pick('file');
  assert.equal(opens, 2);
  resolvePick({ status: 'cancelled' });
  await next;
});
