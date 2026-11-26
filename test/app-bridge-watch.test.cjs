"use strict";

/**
 * The liveness beat, in the app (QA 2026-11-26, defect 1).
 *
 * The device card used to say 在线 until some request happened to fail, so a
 * killed service stayed green while the user looked at the screen. Two rules
 * are locked here:
 *   1. `reachabilityOf` never reads "the service answered 4xx/5xx" as offline —
 *      that is the single-app contract's honest-state rule.
 *   2. A probe writes the verdict to `session.online`, and only a real
 *      transport failure (or its recovery) moves it.
 *
 * The production TS modules run unmodified through the same harness the state
 * recovery tests use; only React rendering and the Android boundary are faked.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');

const root = path.resolve(__dirname, '../app/src');

function harness() {
  const storage = new Map();
  const calls = [];
  const modules = new Map();
  let reply = () => ({ ok: true });
  global.window = {
    TurnloomNative: {
      secureGet: key => storage.get(key) ?? null,
      secureSet: (key, value) => { storage.set(key, value); return true; },
      secureRemove: key => storage.delete(key),
      getAppInfo: () => JSON.stringify({ version: '2.4.3', versionCode: 102, packageName: 'com.codex.turnloom.app' }),
      cancelRequest() {},
      request(id, raw) {
        const req = JSON.parse(raw);
        calls.push(req);
        const body = reply(new URL(req.url).pathname, req);
        Promise.resolve(body).then(data => window.__turnloomNativeHttpResult(
          id,
          JSON.stringify(data?.__nativeResult || { status: 200, body: JSON.stringify(data) }),
        ));
      },
    },
  };
  function load(file) {
    file = path.resolve(root, file);
    if (!path.extname(file)) file += '.ts';
    if (modules.has(file)) return modules.get(file).exports;
    const mod = { exports: {} };
    modules.set(file, mod);
    let js = stripTypeScriptTypes(fs.readFileSync(file, 'utf8'));
    const names = [...js.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g)].map(m => m[1]);
    js = js.replace(/import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/g, (_, vars, source) => `const {${vars}} = require(${JSON.stringify(source)});`)
      .replace(/export default [^;]+;/g, '')
      .replace(/\bexport\s+(?=(?:async\s+)?(?:function|const|class))/g, '');
    new Function('require', 'module', 'exports', js + '\n' + names.map(name => `exports.${name} = ${name};`).join('\n'))(
      source => source === 'react' ? { useSyncExternalStore() {} } : load(path.resolve(path.dirname(file), source)),
      mod,
      mod.exports,
    );
    return mod.exports;
  }
  const session = load('state/sessionStore.ts');
  return {
    storage,
    calls,
    load,
    session,
    setReply(fn) { reply = fn; },
    pairing: {
      protocol: 'codex-turnloom', version: 2, source: 'manual',
      serverUrl: 'http://192.168.50.42:8787', machineToken: 'machine-token',
      machineId: '', machineName: 'Computer', discoverPath: '/api/harnesses',
    },
  };
}

const rows = [
  { id: 'pi', name: 'PI-Desktop', kind: 'pi', token: 'pi-token', defaultHarness: true },
  { id: 'codex', name: 'Codex', kind: 'codex', token: 'codex-token' },
];
const discover = () => ({
  ok: true, protocol: 'codex-turnloom', version: 2, machineId: 'machine', machineName: 'Computer',
  defaultHarnessId: 'pi', harnesses: rows,
});

/** A session that is paired and ready, with all other calls answering `ok`. */
async function ready(extraReply) {
  const h = harness();
  h.setReply(route => {
    if (route === '/api/harnesses') return discover();
    if (extraReply) {
      const answer = extraReply(route);
      if (answer) return answer;
    }
    return { ok: true };
  });
  assert.equal(await h.session.connectWithPairing(h.pairing), true);
  assert.equal(h.session.sessionStore.getState().status, 'ready');
  assert.equal(h.session.sessionStore.getState().online, true);
  return h;
}

test('reachability: an answered 4xx/5xx is a live link, not an offline phone', () => {
  const h = harness();
  const { reachabilityOf } = h.load('lib/bridgeHealth.ts');
  assert.equal(reachabilityOf({ ok: true, status: 200 }), 'reachable');
  assert.equal(reachabilityOf({ ok: false, status: 500, error: 'boom' }), 'reachable');
  assert.equal(reachabilityOf({ ok: false, status: 404, error: 'not-found' }), 'reachable');
  assert.equal(reachabilityOf({ ok: false, status: 401, error: 'unauthorized' }), 'reachable');
  assert.equal(reachabilityOf({ ok: false, status: 0, error: 'OFFLINE' }), 'unreachable');
  assert.equal(reachabilityOf({ ok: false, status: 0, error: 'transport-unavailable' }), 'unreachable');
  // A superseded attempt says nothing about the machine on screen.
  assert.equal(reachabilityOf({ ok: false, status: 0, error: 'stale-context' }), 'unknown');
});

test('the beat logs one line per state change and nothing while steady', () => {
  const h = harness();
  const { createBridgeWatch } = h.load('lib/bridgeHealth.ts');
  const seen = [];
  const sink = { warn: m => seen.push(['warn', m]), info: m => seen.push(['info', m]), debug: m => seen.push(['debug', m]) };
  const watch = createBridgeWatch(sink, 'bridge');

  assert.deepEqual(watch.record('reachable'), { transition: 'steady', level: 'none', failures: 0 });
  assert.deepEqual(watch.record('unknown'), { transition: 'steady', level: 'none', failures: 0 });
  assert.deepEqual(watch.record('unreachable'), { transition: 'went-down', level: 'warn', failures: 1 });
  assert.equal(watch.down, true);
  assert.equal(watch.record('unreachable').level, 'debug');
  assert.equal(watch.record('unreachable').failures, 3);
  // Recovery is one info line, and the counter resets.
  assert.deepEqual(watch.record('reachable'), { transition: 'came-up', level: 'info', failures: 0 });
  assert.equal(watch.down, false);
  assert.deepEqual(watch.record('reachable'), { transition: 'steady', level: 'none', failures: 0 });
  assert.deepEqual(seen.map(([level]) => level), ['warn', 'debug', 'debug', 'info']);
  // The recovery line still says how long the link was down.
  assert.match(seen[3][1], /after 3 failed probes/);
});

test('a probe flips session.online to 离线 on a dead link and back on the next answer', async () => {
  const h = await ready();
  const beat = h.load('state/bridgeWatch.ts');
  assert.equal(typeof beat.probeBridge, 'function');

  let link = 'up';
  h.setReply(route => {
    if (route === '/api/ping') {
      return link === 'up'
        ? { ok: true, protocol: 'codex-turnloom', now: Date.now() }
        : { __nativeResult: { status: 0, error: 'OFFLINE' } };
    }
    return { ok: true };
  });

  assert.equal(await beat.probeBridge(), 'reachable');
  assert.equal(h.session.sessionStore.getState().online, true);
  // The probe must hit the cheap liveness route, not /api/health.
  assert.equal(h.calls.filter(call => new URL(call.url).pathname === '/api/ping').length, 1);

  link = 'down';
  assert.equal(await beat.probeBridge(), 'unreachable');
  assert.equal(h.session.sessionStore.getState().online, false);
  // Still paired and ready: the card says 离线, the session did not become an error.
  assert.equal(h.session.sessionStore.getState().status, 'ready');

  link = 'up';
  assert.equal(await beat.probeBridge(), 'reachable');
  assert.equal(h.session.sessionStore.getState().online, true);
});

test('a probe during a connection switch reports nothing about either machine', async () => {
  const h = await ready(route => (route === '/api/ping' ? { __nativeResult: { status: 0, error: 'OFFLINE' } } : null));
  const beat = h.load('state/bridgeWatch.ts');
  // Unpaired: currentRequestContext() is null, so nothing is measured or written.
  h.session.unpair();
  assert.equal(await beat.probeBridge(), null);
});

test('clearConnectionError drops a stale sentence without touching the connection', async () => {
  const h = await ready();
  h.session.setConnectionError('机器访问码不正确或已更换');
  assert.equal(h.session.sessionStore.getState().status, 'error');
  h.session.clearConnectionError();
  const state = h.session.sessionStore.getState();
  assert.equal(state.error, '');
  assert.equal(state.switchError, '');
  // Adding another computer must not pretend the old machine reconnected.
  assert.equal(state.status, 'error');
});
