import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  DesktopCodexIpcClient, startNewCodexThread, startNewCodexThreadViaAppServer
} from '../server.js';
import { startAppServerFirstTurn } from '../shared/codex-first-turn.js';

test('new-conversation IPC preserves validated catalog-only model and effort', async () => {
  const client = new DesktopCodexIpcClient();
  let captured;
  client.ensureReady = async () => {};
  client.request = async (method, params) => { captured = { method, params }; return { result: 'thread-new' }; };
  await client.startConversation('hello', [], { model: 'catalog-only/model', effort: 'low' }, { id: 'p', name: 'Project', root: 'D:/work/project' });
  assert.equal(captured.method, 'start-conversation');
  assert.equal(captured.params.model, 'catalog-only/model');
  assert.equal(captured.params.effort, 'low');
  assert.equal(captured.params.cwd, 'D:/work/project');
  assert.equal(captured.params.projectPath, 'D:/work/project');
});

test('definite unavailable new-conversation forwards settings and project once to fallback', async () => {
  const settings = { model: 'catalog-only/model', effort: 'low' };
  const project = { id: 'p', root: 'D:/work/project' };
  const calls = [];
  const result = await startNewCodexThread('hello', settings, project, [], {
    ipcClient: { async startConversation() { throw new Error('no-client-found'); } },
    fallbackStart: async (...args) => { calls.push(args); return { threadId: 'thread-new', turnId: 'turn-new' }; }
  });
  assert.deepEqual(calls, [['hello', settings, project]]);
  assert.equal(result.source, 'app-server-fallback');
  assert.equal(result.threadId, 'thread-new');
});

test('new-conversation timeout, missing acknowledgement and policy errors never replay', async () => {
  let fallbackCalls = 0;
  for (const failure of [new Error('IPC request timed out'), null, new Error('permission denied'), new Error('quota exceeded')]) {
    await assert.rejects(startNewCodexThread('hello', { model: 'm', effort: 'low' }, null, [], {
      ipcClient: { async startConversation() { if (failure) throw failure; return {}; } },
      fallbackStart: async () => { fallbackCalls++; return { threadId: 'duplicate' }; }
    }));
  }
  assert.equal(fallbackCalls, 0);
});

test('new-conversation fallback never drops image attachments', async () => {
  let fallbackCalls = 0;
  await assert.rejects(startNewCodexThread('hello', { model: 'm', effort: 'low' }, null, [{ mimeType: 'image/png', data: 'YWJj' }], {
    ipcClient: { async startConversation() { throw new Error('no-client-found'); } },
    fallbackStart: async () => { fallbackCalls++; return { threadId: 'wrong' }; }
  }), /no-client-found/);
  assert.equal(fallbackCalls, 0);
});

function appServerFixture(onMessage) {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.exitCode = null;
  child.kill = () => { child.exitCode = 1; child.emit('close', 1); };
  child.stdin.on('finish', () => { child.exitCode = 0; child.stdout.end(); child.stderr.end(); child.emit('close', 0); });
  let text = '';
  const send = value => child.stdout.write(JSON.stringify(value) + '\n');
  child.stdin.on('data', chunk => {
    text += chunk.toString(); let end;
    while ((end = text.indexOf('\n')) >= 0) {
      const message = JSON.parse(text.slice(0, end)); text = text.slice(end + 1);
      queueMicrotask(() => onMessage(message, send));
    }
  });
  return { child, send };
}

test('formal app-server fallback sends explicit effort and exits only after the matching turn completes', async () => {
  for (const effort of ['low', 'xhigh']) {
    const message = '--config model=unwanted\nOnly reply QA_OK';
    let captured; const sent = [];
    const fixture = appServerFixture((m, send) => {
      sent.push(m);
      if (m.method === 'initialize') send({ id: m.id, result: {} });
      if (m.method === 'thread/start') send({ id: m.id, result: { thread: { id: 'qa-thread' } } });
      if (m.method === 'turn/start') send({ id: m.id, result: { turn: { id: 'qa-turn' } } });
    });
    const result = await startNewCodexThreadViaAppServer(message, { model: 'catalog-only/model', effort }, { root: 'D:/work/project' }, {
      spawnProcess(command, args, options) { captured = { command, args, options }; return fixture.child; }
    });
    assert.deepEqual(result, { threadId: 'qa-thread', turnId: 'qa-turn' });
    assert.deepEqual(captured.args, ['app-server', '--listen', 'stdio://']);
    const create = sent.find(m => m.method === 'thread/start').params;
    const turn = sent.find(m => m.method === 'turn/start').params;
    assert.equal(create.model, 'catalog-only/model');
    assert.equal(create.cwd, 'D:/work/project');
    assert.equal(turn.model, create.model);
    assert.equal(turn.effort, effort);
    assert.deepEqual(turn.input, [{ type: 'text', text: message, text_elements: [] }]);
    assert.equal('approvalPolicy' in turn, false, 'inherit existing approval policy');
    assert.equal(fixture.child.stdin.writableEnded, false, 'keep first turn alive');
    fixture.send({ method: 'turn/completed', params: { threadId: 'another-thread', turn: { id: 'another-turn' } } });
    assert.equal(fixture.child.stdin.writableEnded, false);
    fixture.send({ method: 'turn/completed', params: { threadId: 'qa-thread', turn: { id: 'qa-turn', status: 'completed' } } });
    assert.equal(fixture.child.stdin.writableEnded, true);
    assert.equal(captured.options.cwd, 'D:/work/project');
    assert.notEqual(captured.options.shell, true);
    assert.equal(captured.options.windowsHide, true);
  }
});

test('formal app-server rejection ends the child and is not treated as a successful turn', async () => {
  const fixture = appServerFixture((m, send) => {
    if (m.method === 'initialize') send({ id: m.id, result: {} });
    if (m.method === 'thread/start') send({ id: m.id, result: { thread: { id: 'qa-thread' } } });
    if (m.method === 'turn/start') send({ id: m.id, error: { message: 'unsupported effort' } });
  });
  await assert.rejects(startNewCodexThreadViaAppServer('test', { model: 'm', effort: 'low' }, null, {
    spawnProcess: () => fixture.child
  }), /unsupported effort/);
  assert.equal(fixture.child.stdin.writableEnded, true);
});

test('no-reasoning first turn omits effort; unexpected worker exit reports one background failure', async () => {
  let turnRequest; const failures = [];
  const fixture = appServerFixture((m, send) => {
    if (m.method === 'initialize') send({ id: m.id, result: {} });
    if (m.method === 'thread/start') send({ id: m.id, result: { thread: { id: 'plain-thread' } } });
    if (m.method === 'turn/start') { turnRequest = m.params; send({ id: m.id, result: { turn: { id: 'plain-turn' } } }); }
  });
  await startAppServerFirstTurn({ command: 'codex', home: '/qa', cwd: '/work', text: 'hello', model: 'plain', effort: '',
    spawnProcess: () => fixture.child, onBackgroundError: (id, error) => failures.push({ id, message: error.message }) });
  assert.equal('effort' in turnRequest, false);
  fixture.send({ method: 'turn/completed', params: { threadId: 'plain-thread', turn: { id: 'wrong-turn' } } });
  assert.equal(fixture.child.stdin.writableEnded, false);
  fixture.child.exitCode = 9; fixture.child.emit('close', 9);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].id, 'plain-thread');
  assert.match(failures[0].message, /before the first turn completed/);
  fixture.child.stdin.emit('error', new Error('pipe closed'));
  assert.equal(failures.length, 1, 'close plus pipe error reports once');
});
