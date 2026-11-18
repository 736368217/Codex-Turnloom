'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');

const supported = typeof stripTypeScriptTypes === 'function';
let modulePromise;
function logic() {
  if (!modulePromise) {
    const source = fs.readFileSync(path.join(__dirname, '../src/components/sheetLogic.ts'), 'utf8');
    const code = stripTypeScriptTypes(source, { mode: 'strip' });
    modulePromise = import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  }
  return modulePromise;
}

test('manual pairing rejects invalid schemes and never exposes the access code', { skip: !supported }, async () => {
  const api = await logic();
  assert.equal(api.composeManualPairingInput({ url: 'ftp://example.com', token: 'x' }).ok, false);
  assert.equal(api.toServerOrigin('https://user:pass@example.com'), '');
  assert.deepEqual(api.composeManualPairingInput({ url: 'https://example.com', token: 'a b' }), { ok: true, raw: 'https://example.com/login?token=a%20b' });
  assert.equal(api.accessCodeSummary(''), '未填写访问码');
  assert.equal(api.accessCodeSummary('secret').includes('secret'), false);
});

test('approval navigation selects real requests and does not retarget a stale request', { skip: !supported }, async () => {
  const api = await logic();
  const a = { role: 'interaction', canApprove: true, requestId: 'a' };
  const b = { role: 'interaction', canApprove: true, requestId: 'b' };
  const queue = api.approvalQueue([a, { role: 'assistant', requestId: 'fake', canApprove: true }, b]);
  assert.deepEqual(queue, [a, b]);
  assert.equal(api.resolveApprovalCursor(queue, api.focusApprovalCursor(queue, null)).message.requestId, 'a');
  const focused = api.focusApprovalCursor(queue, b);
  assert.equal(api.resolveApprovalCursor(queue, focused).message.requestId, 'b');
  assert.equal(api.resolveApprovalCursor([a], focused), null);
  assert.equal(api.canDecideApproval(null, {}), false);
  assert.equal(api.canDecideApproval('a', { readOnly: true }), false);
  assert.equal(api.canDecideApproval('a', { pending: true }), false);
  assert.equal(api.canDecideApproval('a', {}), true);
});

test('scanner throttles repeated failures and permits a different code', { skip: !supported }, async () => {
  const api = await logic();
  const blocked = api.blockScanAfterFailure('code-a', 1000);
  assert.equal(api.shouldHandleScan(blocked, 'code-a', 1001), false);
  assert.equal(api.shouldHandleScan(blocked, 'code-b', 1001), true);
  assert.equal(api.shouldHandleScan(blocked, 'code-a', 3500), true);
});
