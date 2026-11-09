'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequestGate, createRetryKey } = require('../src/services/threadGuards.js');

test('a late response and an unmounted response cannot update the view', () => {
  const gate = createRequestGate();
  const old = gate.issue();
  const current = gate.issue();
  assert.equal(gate.isCurrent(old), false);
  assert.equal(gate.isCurrent(current), true);
  gate.invalidate();
  assert.equal(gate.isCurrent(current), false);
});

test('identical retry uses the same id, edits and success create a new id', () => {
  let clock = 0;
  let count = 0;
  const retry = createRetryKey(() => `id-${++count}`, () => clock, 1000);
  const first = { threadId: 'a', message: 'hello', mode: 'start', images: [{ name: 'a.png', mimeType: 'image/png', data: 'abc' }] };
  assert.equal(retry.get(first), 'id-1');
  assert.equal(retry.get({ ...first, images: [{ ...first.images[0] }] }), 'id-1');
  assert.equal(retry.get({ ...first, images: [{ ...first.images[0], data: 'xyz' }] }), 'id-2');
  retry.clear();
  assert.equal(retry.get(first), 'id-3');
});

test('an unconfirmed send retires its id after the TTL instead of deadlocking', () => {
  let clock = 0;
  let count = 0;
  const retry = createRetryKey(() => `id-${++count}`, () => clock, 1000);
  const payload = { threadId: 'a', message: 'hello', mode: 'start' };
  assert.equal(retry.get(payload), 'id-1');
  clock = 999;
  assert.equal(retry.get(payload), 'id-1', 'same id within the TTL window');
  clock = 1000;
  assert.equal(retry.get(payload), 'id-2', 'timeout starts a fresh attempt with a new id');
  assert.equal(retry.get(payload), 'id-2', 'the fresh id remains stable for retries');
  clock = 2000;
  assert.equal(retry.get(payload), 'id-3', 'a second timeout also recovers');
});

test('different threads and modes cannot reuse a pending request id', () => {
  let count = 0;
  const retry = createRetryKey(() => `id-${++count}`);
  assert.equal(retry.get({ threadId: 'a', message: 'hello', mode: 'start' }), 'id-1');
  assert.equal(retry.get({ threadId: 'b', message: 'hello', mode: 'start' }), 'id-2');
  assert.equal(retry.get({ threadId: 'b', message: 'hello', mode: 'queue' }), 'id-3');
});
