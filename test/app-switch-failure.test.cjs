'use strict';
/**
 * 2.2.6 switch-failure contract (NB3 09:31, NB agent 09:33).
 *
 * A failed switch to another computer is *not* a connection loss: A was never
 * probed. The store has to leave A exactly as it was — status, online, request
 * scope and generation — so `currentRequestContext()` stays non-null and the
 * current machine can still load threads. The reason belongs to the device page
 * (`switchError`), never to the global banner (`error`).
 *
 * The visible half is measured on the real bundle by
 * tools/qa/check-226-device.mjs `--mode fail` (card still 在线, one alert,
 * /api/threads still requested). These assertions pin the source shape that
 * measurement depends on.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../app/src');
const read = (file) => fs.readFileSync(path.resolve(root, file), 'utf8');

/** Body of a top-level `function name(...) { ... }` / `async function` block. */
function functionBody(source, name) {
  const start = source.search(new RegExp(`(?:export )?(?:async )?function ${name}\\(`));
  assert.notEqual(start, -1, `${name} not found`);
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, `${name} has no body`);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`${name} body is not closed`);
}

const session = read('state/sessionStore.ts');

test('S1: a failed switch records the device-page reason, not a connection error', () => {
  // Comments name the forbidden call on purpose; only executable lines count.
  const body = functionBody(session, 'switchMachine')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(body, /setConnectionError/,
    'the switch path must not touch status/error: that is the global banner and the card colour');
  assert.match(body, /restoreSession\(previous, previousTarget\)/);
  assert.match(body, /switchError: message/);
});

test('S2: restoring puts back status, online, scope and a fresh generation', () => {
  const body = functionBody(session, 'restoreSession');
  assert.match(body, /setActiveRequestScope\(previous\.scope, target\)|setActiveRequestScope\(previous\.scope \|\| 'unpaired', target\)/);
  assert.match(body, /status: previous\.status/);
  assert.match(body, /online: previous\.online/);
  assert.match(body, /error: previous\.error/);
  assert.match(body, /scope: previous\.scope/);
  // The scope switch bumps the generation; a stale value would make every
  // request built from currentRequestContext() return 'stale-context'.
  assert.match(body, /generation: getActiveGeneration\(\)/);
  // currentRequestContext() refuses anything but a ready session — the restore
  // is only meaningful because it restores `ready` and the machine identity.
  assert.match(session, /if \(state\.status !== 'ready' \|\| !state\.serverUrl \|\| !state\.harnessToken \|\| !state\.scope\) return null;/);
  assert.match(session, /harnessToken: previous\.harnessToken/);
});

test('S3: the 401 self-heal shares the caller attempt, so a failed switch is not swallowed', () => {
  const body = functionBody(session, 'revalidateMachine');
  assert.match(body, /recoverWithSavedHarnesses\(machine, attempt\)/,
    'a recovery that starts its own generation makes the switch failure look stale and skips the restore');
  assert.match(session, /attempt: number = \+\+transitionSeq/);
});

test('S4: only the device page reads switchError; the banner still reads session.error', () => {
  const devices = read('screens/DevicesScreen.tsx');
  const shell = read('components/AppShell.tsx');
  assert.match(devices, /session\.switchError/);
  assert.match(devices, /切换电脑未完成：\$\{switchError\}/);
  assert.doesNotMatch(shell, /switchError/, 'the global banner is for real connection loss only');
  assert.match(shell, /\{session\.error/);
  // A real connection error supersedes the device-page bar instead of stacking
  // two surfaces that say the same thing.
  assert.match(session, /setConnectionError[\s\S]{0,200}switchError: ''/);
});
