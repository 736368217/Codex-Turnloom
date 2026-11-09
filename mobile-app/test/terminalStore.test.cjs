'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTerminalStore, REGISTRY_KEY, ITEM_PREFIX, LEGACY_KEYS } = require('../src/services/terminalStore.js');

function fixture(initial = {}) {
  const data = new Map(Object.entries(initial));
  let fail = null;
  let next = 0;
  const storage = {
    async get(key) { if (fail?.('get', key)) throw new Error('storage unavailable'); return data.get(key) ?? null; },
    async set(key, value) { if (fail?.('set', key)) throw new Error('storage unavailable'); data.set(key, value); },
    async remove(key) { if (fail?.('remove', key)) throw new Error('storage unavailable'); data.delete(key); },
  };
  const normalize = (raw) => { try { const url = new URL(raw); return /^https?:$/.test(url.protocol) ? url.origin : ''; } catch { return ''; } };
  const store = createTerminalStore(storage, normalize, () => `device-${++next}`);
  return { data, store, setFailure(fn) { fail = fn; } };
}
const config = (n) => ({ serverUrl: `https://host${n}.example`, token: `token-${n}`, machineName: `Desktop ${n}` });

test('empty install has no predefined terminal', async () => {
  const { store } = fixture();
  assert.deepEqual(await store.read(), { terminals: [], activeId: null });
});

test('legacy pairing migrates and removal cannot resurrect it', async () => {
  const { store, data } = fixture({ [LEGACY_KEYS.serverUrl]: 'https://host1.example', [LEGACY_KEYS.token]: 'secret', [LEGACY_KEYS.machineName]: 'Desktop' });
  const initial = await store.read();
  assert.equal(initial.activeId, 'legacy');
  assert.equal(initial.terminals[0].token, 'secret');
  await store.remove('legacy');
  assert.deepEqual(await store.read(), { terminals: [], activeId: null });
  for (const key of Object.values(LEGACY_KEYS)) assert.equal(data.has(key), false);
  assert.deepEqual(JSON.parse(data.get(REGISTRY_KEY)).ids, []);
});

test('two terminals can be added, switched, edited and removed independently', async () => {
  const { store } = fixture();
  const first = await store.upsert(config(1), { activate: true });
  const second = await store.upsert(config(2), { activate: true });
  assert.equal((await store.read()).activeId, second.id);
  await store.activate(first.id);
  await store.upsert({ ...config(1), machineName: 'Edited' }, { id: first.id });
  assert.equal((await store.read()).terminals.find((item) => item.id === first.id).machineName, 'Edited');
  assert.equal((await store.read()).terminals.find((item) => item.id === first.id).cacheVersion, 0);
  await store.upsert({ ...config(1), token: 'new-code' }, { id: first.id });
  assert.equal((await store.read()).terminals.find((item) => item.id === first.id).cacheVersion, 1);
  await store.remove(first.id);
  const remaining = await store.read();
  assert.equal(remaining.activeId, second.id);
  assert.deepEqual(remaining.terminals.map((item) => item.id), [second.id]);
  assert.equal(remaining.terminals[0].token, 'token-2');
});

test('failed registry write rolls back an edited credential and preserves active device', async () => {
  const { store, setFailure } = fixture();
  const first = await store.upsert(config(1), { activate: true });
  let blocked = true;
  setFailure((op, key) => op === 'set' && key === REGISTRY_KEY && blocked && !(blocked = false));
  await assert.rejects(store.upsert({ ...config(1), token: 'changed' }, { id: first.id }), /storage unavailable/);
  setFailure(null);
  const snapshot = await store.read();
  assert.equal(snapshot.activeId, first.id);
  assert.equal(snapshot.terminals[0].token, 'token-1');
});

test('failed deletion restores the registry and leaves other devices untouched', async () => {
  const { store, setFailure } = fixture();
  const first = await store.upsert(config(1), { activate: true });
  const second = await store.upsert(config(2), { activate: false });
  setFailure((op, key) => op === 'remove' && key === ITEM_PREFIX + first.id);
  await assert.rejects(store.remove(first.id), /storage unavailable/);
  setFailure(null);
  const snapshot = await store.read();
  assert.equal(snapshot.activeId, first.id);
  assert.deepEqual(snapshot.terminals.map((item) => item.id), [first.id, second.id]);
});

test('concurrent adds are serialized and do not overwrite each other', async () => {
  const { store } = fixture();
  const [first, second] = await Promise.all([store.upsert(config(1), { activate: true }), store.upsert(config(2), { activate: true })]);
  const snapshot = await store.read();
  assert.deepEqual(snapshot.terminals.map((item) => item.id), [first.id, second.id]);
  assert.equal(snapshot.activeId, second.id);
});

test('corrupt registry is surfaced without overwriting data', async () => {
  const { store, data } = fixture({ [REGISTRY_KEY]: '{bad' });
  await assert.rejects(store.read(), /损坏/);
  assert.equal(data.get(REGISTRY_KEY), '{bad');
});
