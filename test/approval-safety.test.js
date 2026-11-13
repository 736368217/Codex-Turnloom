import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const home = mkdtempSync(path.join(os.tmpdir(), 'turnloom-approval-'));
process.env.CODEX_HOME = home;
const { DatabaseSync } = await import('node:sqlite');
const db = new DatabaseSync(path.join(home, 'state_5.sqlite'));
db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT, rollout_path TEXT, updated_at_ms INTEGER, cwd TEXT);');
db.close();
const { approvalRequestsFromEvents, respondToApproval, setCodexIpcClientForApprovalTests, DesktopCodexIpcClient } = await import('../server.js');
after(() => rmSync(home, { recursive: true, force: true }));
const event = (id, extra = {}, threadId = 'approval-thread') => ({
  timestamp: new Date().toISOString(),
  message: { method: 'command_approval', requestId: id, conversationId: threadId, command: 'echo same', reason: 'Review this exact action', ...extra },
});
const payload = request => ({ threadId: 'approval-thread', requestId: request.requestId, approvalKind: request.approvalKind, detailsHash: request.detailsHash, decision: 'approve' });
function fixture(events, request = async () => ({ ok: true })) {
  const calls = [];
  const client = { events, getDesktopConversationRows: () => [{ id: 'approval-thread' }], request: async (...args) => { calls.push(args); return request(...args); } };
  const restore = setCodexIpcClientForApprovalTests(client);
  return { calls, client, restore };
}

test('missing command, file diff, or permission details never become actionable approvals', () => {
  const rows = [event('reason-only', { command: undefined }), event('file-path-only', { method: 'file_approval', command: undefined, path: 'src/a.txt' }), event('permission-reason-only', { method: 'permission_approval', command: undefined })];
  assert.deepEqual(approvalRequestsFromEvents(rows, 'approval-thread'), []);
  const details = approvalRequestsFromEvents([
    event('file-with-diff', { method: 'file_approval', command: undefined, path: 'src/a.txt', changes: { 'src/a.txt': { diff: '-old\n+new' } } }),
    event('permissions', { method: 'permission_approval', command: undefined, permissions: { network: ['example.test'] } }),
  ], 'approval-thread');
  assert.deepEqual(details.map(row => row.requestId), ['file-with-diff', 'permissions']);
  assert.match(details[0].content, /-old\\n\+new/);
  assert.match(details[1].content, /example.test/);
});

test('later host decisions retire only the matching request and distinct IDs remain visible', () => {
  const rows = [event('a'), event('b'), { timestamp: new Date().toISOString(), message: { method: 'thread-follower-command-approval-decision', params: { conversationId: 'approval-thread', requestId: 'a', decision: 'accept' } } }];
  assert.deepEqual(approvalRequestsFromEvents(rows, 'approval-thread').map(row => row.requestId), ['b']);
  const h = fixture(rows);
  try {
    const messages = DesktopCodexIpcClient.prototype.getRecentInteractionMessages.call(h.client, 'approval-thread');
    assert.equal(messages.find(row => row.requestId === 'a').canApprove, false);
    assert.equal(messages.find(row => row.requestId === 'b').canApprove, true);
  } finally { h.restore(); }
});

test('the host decision whitelist is authoritative and never falls back to approval aliases', async () => {
  const rows = [event('decline-only', { available_decisions: ['decline'] })];
  const request = approvalRequestsFromEvents(rows, 'approval-thread')[0];
  const h = fixture(rows);
  try {
    await assert.rejects(respondToApproval(payload(request)), error => error.status === 409);
    assert.equal(h.calls.length, 0);
    await respondToApproval({ ...payload(request), decision: 'decline' });
    assert.equal(h.calls[0][1].decision, 'decline');
  } finally { h.restore(); }
});

test('a changed detail snapshot, missing fields, wrong thread and stale event fail closed', async () => {
  const rows = [event('a')];
  const original = approvalRequestsFromEvents(rows, 'approval-thread')[0];
  const h = fixture(rows);
  try {
    for (const key of ['requestId', 'approvalKind', 'detailsHash']) {
      const body = payload(original); delete body[key];
      await assert.rejects(respondToApproval(body), error => error.status === 400);
    }
    await assert.rejects(respondToApproval({ ...payload(original), approvalKind: 'permission' }), error => error.status === 409);
    await assert.rejects(respondToApproval({ ...payload(original), detailsHash: '0'.repeat(64) }), error => error.status === 409);
    await assert.rejects(respondToApproval({ ...payload(original), threadId: '' }), error => error.status === 400);
    rows[0].message.command = 'echo changed';
    await assert.rejects(respondToApproval(payload(original)), error => error.status === 409);
    rows[0].message.conversationId = 'another-thread';
    await assert.rejects(respondToApproval(payload(original)), error => error.status === 409);
    rows[0].message.conversationId = 'approval-thread';
    rows[0].timestamp = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    await assert.rejects(respondToApproval(payload(original)), error => error.status === 409);
    assert.equal(h.calls.length, 0);
  } finally { h.restore(); }
});

test('simultaneous decisions for the same request reach IPC once', async () => {
  const rows = [event('a')]; const request = approvalRequestsFromEvents(rows, 'approval-thread')[0];
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const h = fixture(rows, () => { entered(); return new Promise(resolve => { release = resolve; }); });
  try {
    const first = respondToApproval(payload(request)); await started;
    await assert.rejects(respondToApproval(payload(request)), error => error.status === 409);
    release({ ok: true }); await first;
    await assert.rejects(respondToApproval(payload(request)), error => error.status === 409);
    assert.equal(h.calls.length, 1);
  } finally { h.restore(); }
});

test('an ambiguous IPC timeout is never replayed through another method or decision alias', async () => {
  const rows = [event('a')]; const request = approvalRequestsFromEvents(rows, 'approval-thread')[0];
  const h = fixture(rows, () => { throw new Error('IPC request timed out'); });
  try {
    await assert.rejects(respondToApproval(payload(request)), /timed out/);
    assert.equal(h.calls.length, 1);
  } finally { h.restore(); }
});
