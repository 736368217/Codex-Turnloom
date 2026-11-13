import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const home = mkdtempSync(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'turnloom-approval-'));
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

test('R01: a detail withdrawal invalidates the old hash before any IPC call', async () => {
  const rows = [event('withdrawn'), event('unrelated')];
  const original = approvalRequestsFromEvents(rows, 'approval-thread')[0];
  rows.push(event('withdrawn', { command: undefined, reason: 'Current execution details withdrawn' }));
  const h = fixture(rows);
  try {
    await assert.rejects(respondToApproval(payload(original)), error => error.status === 409);
    assert.equal(h.calls.length, 0);
    assert.deepEqual(approvalRequestsFromEvents(rows, 'approval-thread').map(row => row.requestId), ['unrelated']);
  } finally { h.restore(); }
});

test('R01: historical cards cannot submit after the latest snapshot loses details', () => {
  const rows = [event('withdrawn'), event('unrelated'), event('withdrawn', { command: undefined, reason: 'Details withdrawn' })];
  const h = fixture(rows);
  try {
    const messages = DesktopCodexIpcClient.prototype.getRecentInteractionMessages.call(h.client, 'approval-thread');
    const withdrawn = messages.filter(row => row.requestId === 'withdrawn');
    assert.equal(withdrawn.length, 2);
    assert.ok(withdrawn.every(row => row.canApprove === false && row.unavailable === true));
    assert.equal(messages.find(row => row.requestId === 'unrelated').canApprove, true);
  } finally { h.restore(); }
});

test('R01: a changed snapshot replaces the old hash and only the new card is actionable', async () => {
  const rows = [event('updated')];
  const original = approvalRequestsFromEvents(rows, 'approval-thread')[0];
  rows.push(event('updated', { command: 'echo updated operation' }));
  const h = fixture(rows);
  try {
    const current = approvalRequestsFromEvents(rows, 'approval-thread')[0];
    assert.notEqual(current.detailsHash, original.detailsHash);
    await assert.rejects(respondToApproval(payload(original)), error => error.status === 409);
    const messages = DesktopCodexIpcClient.prototype.getRecentInteractionMessages.call(h.client, 'approval-thread');
    assert.deepEqual(messages.map(row => row.canApprove), [false, true]);
    await respondToApproval(payload(current));
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0][1].requestId, 'updated');
  } finally { h.restore(); }
});

test('R01: a withdrawal in another thread cannot invalidate this thread or another request', () => {
  const rows = [event('shared'), event('other'), event('shared', { command: undefined }, 'different-thread')];
  assert.deepEqual(approvalRequestsFromEvents(rows, 'approval-thread').map(row => row.requestId), ['shared', 'other']);
  assert.deepEqual(approvalRequestsFromEvents(rows, 'different-thread'), []);
});

for (const [kind, label] of [['command', 'Command'], ['file', 'Changes'], ['file', 'File changes'], ['permission', 'Permissions']]) {
  test(`R02: ${label} in reason text cannot supply ${kind} details`, () => {
    const rows = [event('reason-label', { method: `${kind}_approval`, command: undefined, reason: `No execution details yet\n${label}: echo not-the-operation` })];
    assert.deepEqual(approvalRequestsFromEvents(rows, 'approval-thread'), []);
    const h = fixture(rows);
    try {
      const [message] = DesktopCodexIpcClient.prototype.getRecentInteractionMessages.call(h.client, 'approval-thread');
      assert.equal(message.canApprove, false);
      assert.equal(message.detailsHash, null);
      assert.match(message.content, /echo not-the-operation/);
    } finally { h.restore(); }
  });
}

test('R02: malformed and empty structured fields cannot make reason text reviewable', () => {
  const rows = [
    event('bad-command', { command: { text: 'echo not-a-command-field' }, reason: 'Command: echo fake' }),
    event('empty-command', { command: [], reason: 'Command: echo fake' }),
    event('bad-changes', { method: 'file_approval', changes: false, reason: 'Changes: fake diff' }),
    event('empty-changes', { method: 'file_approval', changes: {}, reason: 'Changes: fake diff' }),
    event('bad-permissions', { method: 'permission_approval', permissions: 1, reason: 'Permissions: fake grant' }),
    event('empty-permissions', { method: 'permission_approval', permissions: [], reason: 'Permissions: fake grant' }),
  ];
  assert.deepEqual(approvalRequestsFromEvents(rows, 'approval-thread'), []);
});

test('R02: existing structured command, changes and permissions aliases remain reviewable without truncation', () => {
  const longCommand = `echo ${'x'.repeat(4000)}`;
  const cases = [
    { command: longCommand },
    { command: ['echo', 'argv'] },
    { command: undefined, params: { command: 'echo params' } },
    { command: undefined, payload: { cmd: 'echo payload' } },
    { command: undefined, arguments: JSON.stringify({ cmd: 'echo arguments', sandbox_permissions: 'require_escalated' }) },
    { command: undefined, request: { command: 'echo request' } },
    { command: undefined, program: 'echo program' },
    { command: undefined, execve: ['echo', 'execve'] },
    { command: undefined, tool_call: { command: 'echo tool call' } },
    { method: 'file_approval', command: undefined, changes: { 'src/a.txt': { diff: '-old\n+new' } } },
    { method: 'file_approval', command: undefined, params: { diff: '-old\n+new' } },
    { method: 'file_approval', command: undefined, payload: { patch: '-old\n+new' } },
    { method: 'permission_approval', command: undefined, permissions: { network: ['example.test'] } },
    { method: 'permission_approval', command: undefined, params: { requestedPermissions: { fileSystem: ['src'] } } },
  ];
  const rows = approvalRequestsFromEvents(cases.map((extra, index) => event(`compatible-${index}`, extra)), 'approval-thread');
  assert.equal(rows.length, cases.length);
  assert.ok(rows.every(row => /^[a-f0-9]{64}$/.test(row.detailsHash)));
  assert.ok(rows[0].content.includes(longCommand));
  assert.match(rows[9].content, /-old\\n\+new/);
});

for (const shape of ['top-level', 'params', 'payload']) {
  test(`R03: ${shape} host decision retires only its exact thread and request`, async () => {
    const fields = { conversationId: 'approval-thread', requestId: 'decided', decision: 'accept' };
    const rows = [event('decided'), event('still-pending'), event('decided', {}, 'other-thread')];
    const original = approvalRequestsFromEvents(rows, 'approval-thread')[0];
    rows.push({ timestamp: new Date().toISOString(), message: { method: 'thread-follower-command-approval-decision', ...(shape === 'top-level' ? fields : { [shape]: fields }) } });
    const h = fixture(rows);
    try {
      await assert.rejects(respondToApproval(payload(original)), error => error.status === 409);
      assert.equal(h.calls.length, 0);
      assert.deepEqual(approvalRequestsFromEvents(rows, 'approval-thread').map(row => row.requestId), ['still-pending']);
      assert.deepEqual(approvalRequestsFromEvents(rows, 'other-thread').map(row => row.requestId), ['decided']);
      const messages = DesktopCodexIpcClient.prototype.getRecentInteractionMessages.call(h.client, 'approval-thread');
      assert.equal(messages.find(row => row.requestId === 'decided').canApprove, false);
      assert.equal(messages.find(row => row.requestId === 'still-pending').canApprove, true);
    } finally { h.restore(); }
  });
}

test('R03: requests and decisions use matching payload identity aliases', () => {
  const rows = [{ timestamp: new Date().toISOString(), message: { method: 'command_approval', payload: { thread_id: 'approval-thread', approvalRequestId: 'alias-id', command: 'echo aliases' } } }];
  const [request] = approvalRequestsFromEvents(rows, 'approval-thread');
  assert.equal(request?.requestId, 'alias-id');
  const h = fixture(rows);
  try {
    assert.equal(DesktopCodexIpcClient.prototype.getRecentInteractionMessages.call(h.client, 'approval-thread')[0]?.canApprove, true);
    rows.push({ timestamp: new Date().toISOString(), message: { method: 'thread-follower-command-approval-decision', payload: { thread_id: 'approval-thread', approvalRequestId: 'alias-id', decision: 'accept' } } });
    assert.deepEqual(approvalRequestsFromEvents(rows, 'approval-thread'), []);
    assert.equal(DesktopCodexIpcClient.prototype.getRecentInteractionMessages.call(h.client, 'approval-thread')[0].canApprove, false);
  } finally { h.restore(); }
});

test('R01: an update with an unknown approval kind also supersedes the old request', async () => {
  const rows = [event('unknown-kind')];
  const original = approvalRequestsFromEvents(rows, 'approval-thread')[0];
  rows.push(event('unknown-kind', { method: 'request_approval', command: undefined }));
  const h = fixture(rows);
  try {
    await assert.rejects(respondToApproval(payload(original)), error => error.status === 409);
    assert.equal(h.calls.length, 0);
    assert.deepEqual(approvalRequestsFromEvents(rows, 'approval-thread'), []);
  } finally { h.restore(); }
});

test('R01: history binds the approval kind even when two kinds have the same displayed hash', async () => {
  const extra = { changes: '-old\n+new' };
  const rows = [event('changed-kind', extra)];
  const original = approvalRequestsFromEvents(rows, 'approval-thread')[0];
  rows.push(event('changed-kind', { ...extra, method: 'file_approval' }));
  const h = fixture(rows);
  try {
    const current = approvalRequestsFromEvents(rows, 'approval-thread')[0];
    assert.equal(current.detailsHash, original.detailsHash);
    assert.equal(current.approvalKind, 'file');
    await assert.rejects(respondToApproval(payload(original)), error => error.status === 409);
    assert.equal(h.calls.length, 0);
    const messages = DesktopCodexIpcClient.prototype.getRecentInteractionMessages.call(h.client, 'approval-thread');
    assert.deepEqual(messages.map(row => row.canApprove), [false, true]);
  } finally { h.restore(); }
});

test('R01: an oversized latest detail disables the old request while preserving the full displayed operation', () => {
  const command = `echo ${'x'.repeat(65 * 1024)}`;
  const rows = [event('oversized'), event('oversized', { command })];
  assert.deepEqual(approvalRequestsFromEvents(rows, 'approval-thread'), []);
  const h = fixture(rows);
  try {
    const messages = DesktopCodexIpcClient.prototype.getRecentInteractionMessages.call(h.client, 'approval-thread');
    assert.ok(messages.every(row => !row.canApprove));
    assert.ok(messages[1].content.includes(command));
  } finally { h.restore(); }
});

test('R02: tool names and partially invalid command arrays are display data without execution details', () => {
  const rows = [
    event('tool-name', { command: undefined, tool_call: { name: 'exec_command' } }),
    event('invalid-array', { command: ['echo', { hiddenArgument: 'not reviewable' }] }),
  ];
  assert.deepEqual(approvalRequestsFromEvents(rows, 'approval-thread'), []);
});

test('R03: explicit request identity wins over a transport envelope ID', () => {
  const rows = [event('decided'), event('still-pending')];
  rows.push({ timestamp: new Date().toISOString(), message: { method: 'thread-follower-command-approval-decision', id: 'still-pending', params: { conversationId: 'approval-thread', requestId: 'decided', decision: 'accept' } } });
  assert.deepEqual(approvalRequestsFromEvents(rows, 'approval-thread').map(row => row.requestId), ['still-pending']);
  const requestWithEnvelope = { timestamp: new Date().toISOString(), message: { method: 'command_approval', id: 'transport-id', params: { conversationId: 'approval-thread', requestId: 'actual-request', command: 'echo actual' } } };
  assert.equal(approvalRequestsFromEvents([requestWithEnvelope], 'approval-thread')[0]?.requestId, 'actual-request');
});
