'use strict';
/**
 * 2.2.5 model-panel contract (Task #14).
 *
 * The human saw a full Codex directory in a panel that should list only the models
 * added in PI-Desktop, in PI's order, with the last-used model — not the directory
 * head — as a new chat's default. These tests execute the production helpers:
 *
 *  - `normalizeHealthCatalog` carries provider/providerLabel/modelId/pinned and
 *    `lastUsedModel` unchanged (it never invents a default);
 *  - `resolveTurnPreference` is the ONE place the fallback order lives:
 *    thread.model → lastUsedModel (only if still in the set) → defaultModel;
 *  - the picker's rows and the header chip read the SAME catalogue argument, and
 *    the chip's model is always findable in the panel (the "default outside the
 *    set" defect must not reappear one layer up).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'src');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function makeLoader() {
  const modules = new Map();
  function load(file) {
    let full = path.resolve(SRC, file);
    if (!path.extname(full)) full += '.ts';
    if (modules.has(full)) return modules.get(full).exports;
    const mod = { exports: {} };
    modules.set(full, mod);
    const raw = fs.readFileSync(full, 'utf8');
    let js = stripTypeScriptTypes(raw);
    const names = [...js.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g)].map((m) => m[1]);
    js = js
      .replace(/import\s+type\s+[^;]+;/g, '')
      .replace(/import\s+(?:type\s+)?\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/g, (_, vars, source) =>
        `const {${vars.replace(/\btype\s+/g, '')}} = __require(${JSON.stringify(source)});`)
      .replace(/export default [^;]+;/g, '')
      .replace(/\bexport\s+(?=(?:async\s+)?(?:function|const|class|interface|type))/g, '');
    new Function('__require', 'module', 'exports', js + '\n' + names.map((name) => `exports.${name} = ${name};`).join('\n'))(
      (source) => {
        if (source === './nativeBridge') return {};
        return load(path.resolve(path.dirname(full), source));
      }, mod, mod.exports,
    );
    return mod.exports;
  }
  return { load };
}

const { load } = makeLoader();
const contract = load('lib/chatContract.ts');
const logic = load('lib/composerLogic.ts');

const row = (modelId, extra = {}) => ({
  id: `wbfd/${modelId}`,
  provider: 'wbfd',
  providerLabel: 'wbfd',
  modelId,
  label: modelId,
  efforts: ['high'],
  defaultEffort: 'high',
  supportsImages: true,
  pinned: false,
  ...extra,
});

// Same shape server.js serves for PI (pinned first, then config_json.models order).
const PI_HEALTH = {
  backend: { kind: 'pi' },
  models: [
    row('kimi-k3.1-pro', { pinned: true }),
    row('deepseek-v4.1-flash'),
    row('hy4flash-free'),
  ],
  defaultModel: 'wbfd/hy4flash-free',
  defaultEffort: 'high',
  lastUsedModel: 'wbfd/deepseek-v4.1-flash',
};

test('health catalogue carries the 2.2.5 fields and never invents a default', () => {
  const catalog = contract.normalizeHealthCatalog(PI_HEALTH, 'machine::pi');
  assert.deepEqual(catalog.models.map((entry) => entry.id), [
    'wbfd/kimi-k3.1-pro', 'wbfd/deepseek-v4.1-flash', 'wbfd/hy4flash-free',
  ], 'array order is the panel order; pinned rows are already first from the host');
  assert.equal(catalog.models[0].providerLabel, 'wbfd');
  assert.equal(catalog.models[0].modelId, 'kimi-k3.1-pro');
  assert.equal(catalog.models[0].pinned, true);
  assert.equal(catalog.models[1].pinned, false);
  assert.equal(catalog.lastUsedModel, 'wbfd/deepseek-v4.1-flash');

  // Absent lastUsedModel is carried as empty — `normalize` must not fill it.
  const withoutLast = contract.normalizeHealthCatalog({ ...PI_HEALTH, lastUsedModel: undefined }, 's');
  assert.equal(withoutLast.lastUsedModel, '');
  // Even an out-of-set value is carried verbatim; membership is decided in resolve.
  const staleLast = contract.normalizeHealthCatalog({ ...PI_HEALTH, lastUsedModel: 'gpt-6-astra' }, 's');
  assert.equal(staleLast.lastUsedModel, 'gpt-6-astra');
});

test('default model: thread.model → lastUsedModel (in set) → defaultModel', () => {
  const catalog = contract.normalizeHealthCatalog(PI_HEALTH, 's');

  // 1. The thread's own model wins, including bare ids without the provider prefix.
  assert.equal(contract.resolveTurnPreference(catalog, null, 'wbfd/kimi-k3.1-pro').model, 'wbfd/kimi-k3.1-pro');
  assert.equal(contract.resolveTurnPreference(catalog, null, 'kimi-k3.1-pro').model, 'wbfd/kimi-k3.1-pro');

  // 2. New chat / thread without a model uses the last used model.
  assert.equal(contract.resolveTurnPreference(catalog, null, '').model, 'wbfd/deepseek-v4.1-flash');
  // An unknown thread model is not a match: same fallback, never the directory head.
  assert.equal(contract.resolveTurnPreference(catalog, null, 'gpt-6-astra').model, 'wbfd/deepseek-v4.1-flash');

  // 3. lastUsedModel no longer in the served set falls to defaultModel, not to it.
  const stale = contract.normalizeHealthCatalog({ ...PI_HEALTH, lastUsedModel: 'gpt-6-astra' }, 's');
  assert.equal(contract.resolveTurnPreference(stale, null, '').model, 'wbfd/hy4flash-free');

  // 4. A deliberate per-thread pick still wins over everything.
  assert.equal(
    contract.resolveTurnPreference(catalog, { model: 'wbfd/hy4flash-free', effort: 'high' }, 'wbfd/kimi-k3.1-pro').model,
    'wbfd/hy4flash-free',
  );
});

test('chip ⊂ panel: the resolved model always has a row in the same catalogue', () => {
  const cases = [
    { health: PI_HEALTH, threads: ['', 'kimi-k3.1-pro', 'wbfd/deepseek-v4.1-flash', 'gpt-6-astra'] },
    { health: { ...PI_HEALTH, lastUsedModel: '' }, threads: ['', 'unknown'] },
    { health: { ...PI_HEALTH, lastUsedModel: 'gpt-6-astra' }, threads: ['', 'hy4flash-free'] },
    {
      health: {
        backend: { kind: 'codex' },
        models: [
          { id: 'real/sol', label: 'GPT-5.6 Sol', efforts: ['high'], defaultEffort: 'high', supportsImages: true },
          { id: 'real/terra', label: 'GPT-5.6 Terra', efforts: ['high'], defaultEffort: 'high', supportsImages: false },
        ],
        defaultModel: 'real/sol',
        lastUsedModel: 'real/terra',
      },
      threads: ['', 'real/sol'],
    },
  ];
  for (const item of cases) {
    // One catalogue object feeds both the resolver and the panel builder — the
    // assertion cannot pass by rebuilding its own expected rows.
    const catalog = contract.normalizeHealthCatalog(item.health, 'scope');
    for (const threadModel of item.threads) {
      const pref = contract.resolveTurnPreference(catalog, null, threadModel);
      assert.ok(pref.model, `resolved a model for thread ${JSON.stringify(threadModel)}`);
      const rows = logic.panelRows(catalog, pref.model);
      const hit = rows.find((entry) => entry.id === pref.model);
      assert.ok(hit, `chip model ${pref.model} is missing from the panel`);
      assert.notEqual(hit.offCatalog, true, 'a resolver default must be a real catalogue row');
    }
  }
});

test('panel rows are exactly the served set plus one disabled status row', () => {
  const catalog = contract.normalizeHealthCatalog(PI_HEALTH, 's');
  assert.deepEqual(
    logic.panelRows(catalog, 'wbfd/hy4flash-free').map((entry) => entry.id),
    catalog.models.map((entry) => entry.id),
    'no selection outside the set: no extra row, no reordering',
  );

  // A saved choice the desktop removed: one status row first, then the set as served.
  const rows = logic.panelRows(catalog, 'wbfd/retired-model');
  assert.equal(rows.length, catalog.models.length + 1);
  assert.equal(rows[0].id, 'wbfd/retired-model');
  assert.equal(rows[0].offCatalog, true);
  assert.equal(rows.filter((entry) => entry.offCatalog).length, 1, 'history must never accumulate rows');
  assert.deepEqual(rows.slice(1).map((entry) => entry.id), catalog.models.map((entry) => entry.id));

  // Before the catalogue loads there is nothing to accuse: the panel says "reading".
  assert.deepEqual(logic.panelRows(null, 'wbfd/retired-model'), []);
  assert.deepEqual(logic.panelRows({ scope: 's', models: [], defaultModel: '', defaultEffort: '', lastUsedModel: '' }, 'wbfd/retired-model'), []);
});

test('panel wiring: one catalogue source, disabled status row, chip says 已移除', () => {
  const composer = read('app/src/components/ChatComposer.tsx');
  assert.match(composer, /const rows = panelRows\(catalog, selected\.model\)/);
  assert.match(composer, /filterModelRows\(rows, provider, query\)/);
  assert.match(composer, /title="模型"/);
  assert.match(composer, /aria-disabled="true"/);
  assert.match(composer, /电脑端未加入/);
  assert.match(composer, /tl-header-model-removed/);
  assert.match(composer, /已移除/);
  assert.doesNotMatch(composer, /filterModelsByProvider\(catalog/, 'the panel must not re-filter the raw catalogue');
});
