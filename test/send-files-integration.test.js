import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { sendWithFiles, sendRequestFingerprint } from '../server.js';
import { HttpBackendClient } from '../backends/http-backend.js';

const file = { name: 'report.txt', mimeType: 'text/plain', data: Buffer.from('real file bytes\n').toString('base64') };
test('ordinary file sending stages real bytes once inside request idempotency and preserves turn options', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'turnloom-send-files-'));
  try {
    let calls = 0;
    const body = { threadId: 'thread-one', message: 'read this', clientRequestId: 'files-request-1', files: [file], model: 'real/model', effort: 'high', mode: 'queue' };
    const execute = async (message, threadId, images, options) => {
      calls++;
      assert.equal(threadId, body.threadId);
      assert.deepEqual(images, []);
      assert.equal(options.model, 'real/model');
      assert.equal(options.effort, 'high');
      assert.equal(options.mode, 'queue');
      assert.equal(options.clientRequestId, body.clientRequestId);
      assert.match(message, /^read this\n\n/);
      assert.equal(message.includes(file.name), true);
      assert.equal(message.includes(file.data), false);
      const names = await fs.readdir(path.join(root, 'scratch', body.threadId));
      assert.equal(names.length, 1);
      const stagedPath = await fs.realpath(path.join(root, 'scratch', body.threadId, names[0]));
      assert.equal(message.includes(stagedPath), true);
      assert.deepEqual(await fs.readFile(stagedPath), Buffer.from(file.data, 'base64'));
      return { ok: true, threadId };
    };
    const store = new Map();
    const [first, second] = await Promise.all([
      sendWithFiles(body, execute, { dataRoot: root, store }),
      sendWithFiles(body, execute, { dataRoot: root, store }),
    ]);
    assert.deepEqual(first, second);
    assert.equal(calls, 1);
    assert.equal(first.files[0].sha256, createHash('sha256').update(Buffer.from(file.data, 'base64')).digest('hex'));
    assert.equal(JSON.stringify(first).includes(root), false, 'public receipt must not expose host path');
    await assert.rejects(sendWithFiles({ ...body, files: [{ ...file, data: 'Y2hhbmdlZA==' }] }, execute, { dataRoot: root, store }), error => error.status === 409);
    assert.equal(calls, 1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('invalid files fail before host send or any staging directory exists', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'turnloom-invalid-files-'));
  try {
    await assert.rejects(sendWithFiles({ files: [{ ...file, data: '!bad' }] }, () => assert.fail('host must not be called'), { dataRoot: root, store: new Map() }), /base64/);
    assert.deepEqual(await fs.readdir(root), []);
    assert.notEqual(sendRequestFingerprint({ files: [file] }), sendRequestFingerprint({ files: [{ ...file, name: 'other.txt' }] }));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('HTTP adapter forwards actual file bytes and model, effort, mode, project, idempotency on create and followup', async () => {
  const calls = [];
  const backend = new HttpBackendClient({ baseUrl: 'http://backend.test', fetchImpl: async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ ok: true, threadId: 't1' }));
  } });
  const options = { files: [file], model: 'exact/model', effort: 'xhigh', mode: 'queue', projectId: 'p1', clientRequestId: 'send-files-1' };
  await backend.createThread('new', [], options);
  await backend.sendMessage('t1', 'followup', [], options);
  assert.equal(calls[0].url, 'http://backend.test/threads');
  assert.equal(calls[1].url, 'http://backend.test/threads/t1/messages');
  for (const call of calls) {
    assert.deepEqual(call.body.files, [file]);
    for (const key of ['model', 'effort', 'mode', 'projectId', 'clientRequestId']) assert.equal(call.body[key], options[key]);
  }
});

test('first-turn Desktop IPC preserves images alongside text and exact model settings', async () => {
  const { DesktopCodexIpcClient } = await import('../server.js');
  const image = { name: 'a.png', mimeType: 'image/png', data: 'QUJD' };
  const calls = [];
  await DesktopCodexIpcClient.prototype.startConversation.call({
    ensureReady: async () => {},
    request: async (method, body) => { calls.push({ method, body }); return { result: { threadId: 'created' } }; }
  }, 'hello', [image], { model: 'gpt-5.6-sol', effort: 'high' });
  assert.equal(calls[0].method, 'start-conversation');
  assert.deepEqual(calls[0].body.input, [
    { type: 'text', text: 'hello', text_elements: [] },
    { type: 'image', url: 'data:image/png;base64,QUJD' }
  ]);
  assert.equal(calls[0].body.model, 'gpt-5.6-sol');
  assert.equal(calls[0].body.effort, 'high');
});
