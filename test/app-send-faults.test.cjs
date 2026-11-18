'use strict';
/**
 * E2E for the 2.2.1 send chain, against a real HTTP server with a fault knob.
 *
 * The production TS modules run unmodified: `turnloomApi` → `nativeBridge` →
 * a bridge shim that performs a real `fetch` against tools/qa/send-fault-server
 * → back through `__turnloomNativeHttpResult`, exactly like the Android shell.
 * Only React rendering (never exercised here) is replaced.
 *
 * Locks down the four user-visible promises:
 *   · a host 4xx sentence (spaces, Chinese) is shown instead of `HTTP-400`
 *   · a timeout says "请求超时", a dropped socket says "连接中断" — neither is
 *     presented as an offline state when the server actually answered
 *   · a transport blip is retried exactly once with the same clientRequestId
 *   · the failure text belongs to this send, not an older poll's error
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');

const root = path.resolve(__dirname, '../app/src');

const { pathToFileURL } = require('node:url');

function loadServer() {
  return import(pathToFileURL(path.resolve(__dirname, '../tools/qa/send-fault-server.mjs')).href);
}

function harness(serverUrl) {
  const storage = new Map();
  const nativeCalls = [];
  const bridge = {
    timeoutSends: 0,
    secureGet: (key) => (storage.has(key) ? storage.get(key) : null),
    secureSet: (key, value) => { storage.set(key, value); return true; },
    secureRemove: (key) => storage.delete(key),
    getAppInfo: () => JSON.stringify({ version: '2.2.1', versionCode: 90, packageName: 'com.codex.turnloom.app' }),
    cancelRequest() {},
    request(id, raw) {
      const payload = JSON.parse(raw);
      nativeCalls.push(payload);
      const send = () => {
        const deliver = (status, body, error) => global.window.__turnloomNativeHttpResult(
          id, JSON.stringify({ status, body, ...(error ? { error } : {}) }),
        );
        fetch(payload.url, {
          method: payload.method || 'GET',
          headers: payload.headers || {},
          ...(typeof payload.body === 'string' ? { body: payload.body } : {}),
        })
          .then(async (response) => deliver(response.status, await response.text()))
          .catch((error) => {
            const cause = String(error?.cause?.code || error?.message || error);
            deliver(0, '', /timeout|ETIMEDOUT/i.test(cause) ? 'timeout' : 'network');
          });
      };
      if (bridge.timeoutSends > 0 && String(payload.url).endsWith('/api/send')) {
        // The Android shell reports a read timeout as status 0 / "timeout".
        bridge.timeoutSends -= 1;
        queueMicrotask(() => global.window.__turnloomNativeHttpResult(
          id, JSON.stringify({ status: 0, body: '', error: 'timeout' }),
        ));
        return;
      }
      send();
    },
  };
  global.window = { TurnloomNative: bridge };

  const modules = new Map();
  function load(file) {
    let full = path.resolve(root, file);
    if (!path.extname(full)) full += '.ts';
    if (modules.has(full)) return modules.get(full).exports;
    const mod = { exports: {} };
    modules.set(full, mod);
    let js = stripTypeScriptTypes(fs.readFileSync(full, 'utf8'));
    const names = [...js.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g)].map((m) => m[1]);
    js = js
      .replace(/import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/g,
        (_, vars, source) => `const {${vars}} = require(${JSON.stringify(source)});`)
      .replace(/export default [^;]+;/g, '')
      .replace(/\bexport\s+(?=(?:async\s+)?(?:function|const|class))/g, '');
    new Function('require', 'module', 'exports', js + '\n' + names.map((name) => `exports.${name} = ${name};`).join('\n'))(
      (source) => {
        if (source === 'react') return { useSyncExternalStore() {} };
        const resolved = path.resolve(path.dirname(full), source);
        return load(path.relative(root, resolved));
      },
      mod,
      mod.exports,
    );
    return mod.exports;
  }

  const api = load('lib/turnloomApi.ts');
  const errors = load('lib/serverErrors.ts');
  const data = load('state/dataStore.ts');
  const images = load('lib/imageUpload.ts');

  const scope = 'qa-send-scope';
  const target = { origin: serverUrl, token: 'qa-token' };
  api.setActiveRequestScope(scope, target);
  const context = { target, scope, generation: api.getActiveGeneration() };
  return { storage, nativeCalls, bridge, load, api, errors, data, images, context };
}

const message = (text = 'hello from the phone') => ({
  message: text,
  clientRequestId: 'qa-request-1',
  images: [{ name: 'IMG_0001.jpg', mimeType: 'image/jpeg', data: 'L3RtcC9xYS1waG90by5qcGc=' }],
});

test('2.2.1 send faults', async (t) => {
  const { createSendFaultServer } = await loadServer();
  const server = createSendFaultServer();
  await server.listen(0);
  t.after(async () => { await server.close(); });
  const h = harness(server.url);

  await t.test('a host 4xx sentence with spaces reaches the user verbatim', async () => {
    server.reset();
    server.setScenario('image-400');
    const result = await h.api.postSend(h.context, message());
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.match(result.error, /图片尺寸超出电脑端限制/);
    assert.doesNotMatch(result.error, /^HTTP-400$/);
    const shown = h.errors.actionableMessage(result);
    assert.match(shown, /图片尺寸/);
    assert.match(shown, /4096/);
    assert.doesNotMatch(shown, /HTTP-400/);
  });

  await t.test('the 2.1.7 English host sentence is translated, not reduced to HTTP-400', async () => {
    server.reset();
    server.setScenario('english-400');
    const result = await h.api.postSend(h.context, message());
    assert.equal(result.status, 400);
    assert.match(result.error, /Invalid image: dimensions must be within 4096px and 12MP/);
    const shown = h.errors.actionableMessage(result);
    assert.match(shown, /图片尺寸/);
    assert.doesNotMatch(shown, /HTTP-400/);
  });

  await t.test('a Chinese reason survives untouched and is not collapsed to HTTP-400', async () => {
    server.reset();
    server.setScenario('chinese-400');
    const result = await h.api.postSend(h.context, message());
    assert.equal(result.status, 400);
    assert.equal(result.error, '当前模型不支持图片，请移除后重试');
    assert.equal(h.errors.actionableMessage(result), '当前模型不支持图片，请移除后重试');
  });

  await t.test('empty content and an oversized body get their own sentences', async () => {
    server.reset();
    server.setScenario('empty-400');
    const empty = await h.api.postSend(h.context, message(''));
    assert.equal(empty.status, 400);
    assert.match(h.errors.actionableMessage(empty), /内容为空/);

    server.setScenario('413');
    const large = await h.api.postSend(h.context, message());
    assert.equal(large.status, 413);
    assert.match(h.errors.actionableMessage(large), /超过电脑端上限/);
  });

  await t.test('a timeout says 请求超时 and never 离线', async () => {
    server.reset();
    server.setScenario('ok');
    h.nativeCalls.length = 0;
    h.bridge.timeoutSends = 2; // both the first attempt and the one retry time out
    const ok = await h.data.sendMessage(h.context, 'thread-qa', message('timeout probe'));
    assert.equal(ok, false);
    // The shim answers "timeout" without touching the socket, so count the bridge attempts.
    assert.equal(h.nativeCalls.filter((row) => String(row.url).endsWith('/api/send')).length, 2);
    const state = h.data.dataStore.getState();
    assert.match(state.lastSendError, /请求超时/);
    assert.match(state.lastSendError, /草稿/);
    assert.doesNotMatch(state.lastSendError, /离线|连不上电脑/);
  });

  await t.test('a dropped socket is retried once with the same clientRequestId', async () => {
    server.reset();
    server.setScenario('reset-once');
    const ok = await h.data.sendMessage(h.context, 'thread-qa', message('retry me'));
    assert.equal(ok, true);
    const sends = server.requests.filter((row) => row.path === '/api/send');
    assert.equal(sends.length, 2, 'exactly one automatic retry');
    assert.equal(sends[0].clientRequestId, 'qa-request-1');
    assert.equal(sends[1].clientRequestId, 'qa-request-1');
    assert.deepEqual(sends[0].body.images, sends[1].body.images);
    const state = h.data.dataStore.getState();
    assert.equal(state.lastSendError, '');
    assert.equal(state.offline, false);
  });

  await t.test('a permanent transport failure reports 连接中断 after one retry', async () => {
    server.reset();
    server.setScenario('reset');
    const ok = await h.data.sendMessage(h.context, 'thread-qa', message('still down'));
    assert.equal(ok, false);
    assert.equal(server.requests.filter((row) => row.path === '/api/send').length, 2);
    const state = h.data.dataStore.getState();
    assert.match(state.lastSendError, /连接中断/);
    assert.match(state.lastSendError, /草稿/);
    assert.equal(state.error, state.lastSendError);
  });

  await t.test('a 4xx never enters the offline state and never shows an older error', async () => {
    server.reset();
    h.data.dataStore.setState({ error: '旧的错误：上一次轮询失败', lastSendError: '旧的发送错误' });
    server.setScenario('image-400');
    const ok = await h.data.sendMessage(h.context, 'thread-qa', message('bad image'));
    assert.equal(ok, false);
    assert.equal(server.requests.filter((row) => row.path === '/api/send').length, 1, '4xx is not retried');
    const state = h.data.dataStore.getState();
    assert.equal(state.offline, false);
    assert.match(state.lastSendError, /图片尺寸/);
    assert.doesNotMatch(state.lastSendError, /旧的/);
    assert.doesNotMatch(state.error, /旧的/);
  });

  await t.test('401 asks for re-pairing and is not retried', async () => {
    server.reset();
    server.setScenario('401');
    const ok = await h.data.sendMessage(h.context, 'thread-qa', message('expired token'));
    assert.equal(ok, false);
    assert.equal(server.requests.filter((row) => row.path === '/api/send').length, 1);
    assert.match(h.data.dataStore.getState().lastSendError, /重新配对/);
    assert.equal(h.data.dataStore.getState().offline, false);
  });

  await t.test('a 4032x3024 photo is planned down to 2048x1536 and keeps name/count', () => {
    const fitted = h.images.fitWithin(4032, 3024);
    assert.deepEqual(fitted, { width: 2048, height: 1536, scaled: true });
    assert.deepEqual(h.images.fitWithin(1024, 768), { width: 1024, height: 768, scaled: false });
    assert.deepEqual(h.images.fitWithin(6000, 8000), { width: 1536, height: 2048, scaled: true });
    assert.equal(h.images.jpegName('IMG_2026.PNG'), 'IMG_2026.jpg');
    assert.equal(h.images.jpegName('already.JPEG'), 'already.JPEG');
  });

  await t.test('a Node environment keeps every attachment instead of dropping it', async () => {
    const attachments = [
      { id: 'a', name: 'one.png', mimeType: 'image/png', sizeBytes: 1024, data: 'AAAA', kind: 'image' },
      { id: 'b', name: 'notes.txt', mimeType: 'text/plain', sizeBytes: 12, data: 'aGk=', kind: 'file' },
    ];
    const out = await h.images.compressAttachmentsForUpload(attachments);
    assert.equal(out.length, attachments.length);
    assert.deepEqual(out.map((row) => row.name), ['one.png', 'notes.txt']);
    assert.equal(out[1], attachments[1], 'non-images pass through untouched');
  });

  await t.test('the /api/send body carries plain base64 and every image exactly once', async () => {
    server.reset();
    server.setScenario('ok');
    const contract = h.load('lib/chatContract.ts');
    const payload = contract.buildSendPayload({
      message: 'two images',
      clientRequestId: 'qa-request-2',
      attachments: [
        { id: 'a', name: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 3, data: 'data:image/jpeg;base64,QUFB', kind: 'image' },
        { id: 'b', name: 'b.jpg', mimeType: 'image/jpeg', sizeBytes: 3, data: 'QkJC', kind: 'image' },
      ],
    });
    const result = await h.api.postSend(h.context, payload);
    assert.equal(result.ok, true);
    const send = server.requests.find((row) => row.path === '/api/send');
    assert.equal(send.images.length, 2);
    assert.deepEqual(send.images.map((row) => row.name), ['a.jpg', 'b.jpg']);
    assert.equal(send.body.images[0].data, 'QUFB');
    assert.equal(send.body.images[1].data, 'QkJC');
  });

  await t.test('phone diagnostics are redacted and flushed after the next successful send', async () => {
    server.reset();
    const diag = h.load('lib/diagnostics.ts');
    diag.clearDiagnostics();
    server.setScenario('image-400');
    await h.data.sendMessage(h.context, 'thread-qa', {
      message: 'SECRET message text that must never reach diagnostics',
      clientRequestId: 'diag-fail-1',
    });
    const pending = diag.readDiagnostics();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].kind, 'send');
    assert.equal(pending[0].status, 400);
    assert.match(pending[0].message, /图片尺寸/);
    assert.doesNotMatch(JSON.stringify(pending), /SECRET message text/);

    server.setScenario('ok');
    const ok = await h.data.sendMessage(h.context, 'thread-qa', { message: 'a normal send', clientRequestId: 'diag-ok-1' });
    assert.equal(ok, true);
    const deadline = Date.now() + 3000;
    while (!server.diagnostics.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(server.diagnostics.length, 1, 'one upload after the confirmed send');
    const uploaded = server.diagnostics[0];
    assert.equal(uploaded.appVersion, '2.2.1');
    assert.equal(uploaded.records.length, 1);
    assert.equal(uploaded.records[0].status, 400);
    assert.match(uploaded.records[0].message, /图片尺寸/);
    assert.doesNotMatch(JSON.stringify(uploaded), /SECRET message text|qa-token/);
    assert.deepEqual(diag.readDiagnostics(), [], 'successful upload clears the ring buffer');
  });

  await t.test('a failed diagnostics upload is silent, retried never, and not offline', async () => {
    server.reset();
    const diag = h.load('lib/diagnostics.ts');
    diag.clearDiagnostics();
    diag.recordDiagnostic({ kind: 'send', status: 400, message: 'readable reason' });
    server.setDiagnosticsStatus(401);
    const offlineBefore = h.data.dataStore.getState().offline;
    h.nativeCalls.length = 0;
    const stored = await diag.uploadDiagnostics(h.context);
    assert.equal(stored, 0);
    assert.equal(h.nativeCalls.filter((row) => String(row.url).endsWith('/api/diagnostics')).length, 1, 'no retry');
    assert.equal(h.data.dataStore.getState().offline, offlineBefore, '401 diagnostics is not an offline state');
    assert.equal(diag.readDiagnostics().length, 1, 'records stay for the next confirmed send');
    server.setDiagnosticsStatus(200);
  });
});
