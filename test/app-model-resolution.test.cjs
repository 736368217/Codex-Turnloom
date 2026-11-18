'use strict';
/**
 * P0 regression (2026-11-18): a normal send must not look like a model switch.
 *
 * Real failure: PI session model was `deepseek-v4.1-flash`, the catalog id was
 * `wbfd/deepseek-v4.1-flash`; exact-match lookup missed, the app fell back to
 * the catalog default and sent `model` on every turn, which made the bridge run
 * `session/configure` (dangerous → native approval prompt) each time.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');

const full = path.resolve(__dirname, '../app/src/lib/chatContract.ts');
const js = stripTypeScriptTypes(fs.readFileSync(full, 'utf8'))
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"];?/g, '')
  .replace(/export\s+interface\s+\w+\s*\{[\s\S]*?\n\}/g, '')
  .replace(/export\s+type\s+\w+\s*=[^;]+;/g, '')
  .replace(/export\s+(?=(?:async\s+)?(?:function|const))/g, '')
  .replace(/export default[^;]+;/g, '');
const names = [...fs.readFileSync(full, 'utf8').matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map((m) => m[1]);
const mod = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', `${js}\n${names.map((name) => `module.exports.${name} = ${name};`).join('\n')}`)(mod, mod.exports);
const { resolveTurnPreference, matchModelEntry, sendModelFields, normalizeModelId } = mod.exports;

const catalog = {
  scope: 'qa',
  models: [
    { id: 'wbfd/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', provider: 'wbfd', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', supportsImages: false },
    { id: 'wbfd/hy4flash-free', label: 'HY4 Flash Free', provider: 'wbfd', efforts: ['low', 'medium'], defaultEffort: 'low', supportsImages: false },
    { id: 'other/deepseek-v4.1-flash', label: 'DeepSeek (other)', provider: 'other', efforts: ['low'], defaultEffort: 'low', supportsImages: false },
  ],
  defaultModel: 'wbfd/hy4flash-free',
  defaultEffort: 'low',
};

test('model id normalizes provider-qualified and bare ids to the same entry', () => {
  assert.equal(normalizeModelId(' wbfd/deepseek-v4.1-flash/ '), 'wbfd/deepseek-v4.1-flash');
  assert.equal(matchModelEntry(catalog.models, 'deepseek-v4.1-flash', 'wbfd')?.id, 'wbfd/deepseek-v4.1-flash');
  assert.equal(matchModelEntry(catalog.models, 'wbfd/deepseek-v4.1-flash'), catalog.models[0]);
  // Ambiguous suffix without a provider hint must not pick at random.
  assert.equal(matchModelEntry(catalog.models, 'deepseek-v4.1-flash'), undefined);
  assert.equal(matchModelEntry(catalog.models, 'nope'), undefined);
});

test('resolveTurnPreference keeps the thread model instead of falling back to the catalog default', () => {
  const resolved = resolveTurnPreference(catalog, null, 'deepseek-v4.1-flash');
  assert.equal(resolved.model, 'wbfd/deepseek-v4.1-flash');
  // The prefix itself disambiguates the other provider.
  assert.equal(resolveTurnPreference(catalog, null, 'other/deepseek-v4.1-flash').model, 'other/deepseek-v4.1-flash');
  // Unknown thread model: documented fallback to the catalog default.
  assert.equal(resolveTurnPreference(catalog, null, 'unknown-model').model, 'wbfd/hy4flash-free');
});

test('a plain send carries no model: the host keeps the thread model', () => {
  const fields = sendModelFields({
    catalog,
    preference: { model: 'wbfd/deepseek-v4.1-flash', effort: 'medium' },
    threadModel: 'deepseek-v4.1-flash',
    explicit: false,
  });
  assert.deepEqual(fields, {});
  // Nothing known about the thread model either: still do not invent a switch.
  assert.deepEqual(sendModelFields({ catalog, preference: { model: 'wbfd/hy4flash-free', effort: 'low' }, explicit: false }), {});
});

test('an explicit pick is sent, and same-pair never re-sends model', () => {
  // Same model, user only changed the effort.
  assert.deepEqual(
    sendModelFields({ catalog, preference: { model: 'wbfd/deepseek-v4.1-flash', effort: 'high' }, threadModel: 'deepseek-v4.1-flash', explicit: true }),
    { effort: 'high' },
  );
  // Real switch.
  assert.deepEqual(
    sendModelFields({ catalog, preference: { model: 'wbfd/hy4flash-free', effort: 'low' }, threadModel: 'deepseek-v4.1-flash', explicit: true }),
    { model: 'wbfd/hy4flash-free', effort: 'low' },
  );
  // New task: there is no thread model yet, the pick is the intent.
  assert.deepEqual(
    sendModelFields({ catalog, preference: { model: 'wbfd/deepseek-v4.1-flash', effort: 'medium' }, explicit: true }),
    { model: 'wbfd/deepseek-v4.1-flash', effort: 'medium' },
  );
});

test('chat detail sends the resolved fields, not the raw preference', () => {
  const screen = fs.readFileSync(path.resolve(__dirname, '../app/src/screens/ChatDetailScreen.tsx'), 'utf8');
  assert.match(screen, /model: fields\.send\.model, effort: fields\.send\.effort/);
  assert.doesNotMatch(screen, /model: fields\.preference\.model/);
  const composer = fs.readFileSync(path.resolve(__dirname, '../app/src/components/ChatComposer.tsx'), 'utf8');
  assert.match(composer, /const send = sendModelFields\(\{/);
  assert.match(composer, /explicit: Boolean\(composer\.preference\?\.model\)/);
});
