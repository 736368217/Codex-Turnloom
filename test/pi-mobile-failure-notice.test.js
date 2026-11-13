import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createRolloutParseState, parseRolloutLine } from '../server.js';

const source = fs.readFileSync(new URL('../third-party/turnloom-pidesktop/plugin/main.js', import.meta.url), 'utf8');
const start = source.indexOf('function buildRollout(');
const end = source.indexOf('\nfunction writeStateDb(', start);
assert.ok(start >= 0 && end > start);
const build = vm.runInNewContext(`${source.slice(start, end)}; buildRollout`, { iso: value => new Date(value).toISOString() });
const session = { id: 'phone-qa', created_at: 1000, updated_at: 9000 };
const turn = (id, status, error_code) => ({ id, session_id: session.id, status, error_code, started_at: 1000, ended_at: status === 'running' ? null : 5000 });
const message = (turnId, role, text, at = 2000) => ({ turn_id: turnId, role, text, created_at: at });
function parse(messages, turns) {
  const state = createRolloutParseState({ mtimeMs: 9000 }, 9000);
  for (const line of build(session, messages, turns).trim().split('\n')) parseRolloutLine(line, state);
  return state;
}

test('PI failed empty reply becomes one actionable mobile error notice', () => {
  const state = parse([message('failed', 'user', 'phone QA'), message('failed', 'assistant', '')], [turn('failed', 'error', 'PROVIDER_ERROR')]);
  assert.equal(state.noticeMessages.length, 1);
  assert.equal(state.noticeMessages[0].kind, 'error');
  assert.equal(state.noticeMessages[0].turnId, 'failed');
  assert.match(state.noticeMessages[0].content, /PROVIDER_ERROR.*切换模型或稍后重试/);
  assert.equal(state.activeTurn, null);
  assert.equal(state.openTurns.size, 0);
});

test('PI completed and cancelled turns do not create provider errors; running stays open', () => {
  for (const status of ['completed', 'cancelled', 'running']) {
    const state = parse([message('normal', 'user', 'phone QA'), message('normal', 'assistant', 'partial reply')], [turn('normal', status, 'PROVIDER_ERROR')]);
    assert.equal(state.noticeMessages.length, 0);
    assert.equal(state.activeTurn?.turnId || null, status === 'running' ? 'normal' : null);
    assert.ok(state.eventMessages.some(item => item.content === 'partial reply'));
  }
});

test('PI silent failed turn does not terminate another running turn or expose raw error data', () => {
  const state = parse([message('running', 'user', 'phone QA')], [turn('failed', 'error', 'https://secret.invalid/?token=private'), turn('running', 'running')]);
  assert.equal(state.noticeMessages.length, 1);
  assert.equal(state.noticeMessages[0].turnId, 'failed');
  assert.equal(state.activeTurn?.turnId, 'running');
  assert.doesNotMatch(state.noticeMessages[0].content, /secret|token|private/);
});
