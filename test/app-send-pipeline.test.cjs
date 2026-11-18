'use strict';
/**
 * Regression for the 2026-11-18 image-send failure.
 *
 * A standard camera photo (4032×3024 = 12.19 MP) was rejected by the host with
 * `400 Invalid image: dimensions ...`; the client collapsed that sentence into
 * `HTTP-400`. This file pins both halves: the photo must be resized before it
 * becomes an upload, and the host sentence must reach the screen.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');

const root = path.resolve(__dirname, '../app/src');
const read = (file) => fs.readFileSync(path.resolve(root, file), 'utf8');

function load(file) {
  const full = path.resolve(root, file);
  const mod = { exports: {} };
  let js = stripTypeScriptTypes(fs.readFileSync(full, 'utf8'));
  const names = [...js.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g)].map((m) => m[1]);
  js = js.replace(/import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/g,
    (_, vars, source) => `const {${vars}} = require(${JSON.stringify(source)});`)
    .replace(/import\s+[^;]+;?/g, '')
    .replace(/export default [^;]+;/g, '')
    .replace(/\bexport\s+(?=(?:async\s+)?(?:function|const|class))/g, '');
  new Function('require', 'module', 'exports', js + '\n' + names.map((name) => `exports.${name} = ${name};`).join('\n'))(
    (source) => {
      const resolved = path.resolve(path.dirname(full), source);
      if (fs.existsSync(resolved)) return require(resolved);
      const withExt = `${resolved}.ts`;
      if (fs.existsSync(withExt)) return load(path.relative(root, withExt));
      throw new Error(`cannot resolve ${source} from ${file}`);
    },
    mod,
    mod.exports,
  );
  return mod.exports;
}

const upload = load('lib/imageUpload.ts');
const errors = load('lib/serverErrors.ts');

test('S1: a 4032×3024 camera photo is inside the 2048 upload budget', () => {
  const fitted = upload.fitWithin(4032, 3024, upload.UPLOAD_MAX_EDGE);
  assert.equal(fitted.scaled, true);
  assert.equal(fitted.width, 2048);
  assert.equal(fitted.height, 1536);
  assert.ok(fitted.width <= 2048 && fitted.height <= 2048);
  // Portrait photos use the same long-edge rule.
  const portrait = upload.fitWithin(3024, 4032, 2048);
  assert.deepEqual({ w: portrait.width, h: portrait.height }, { w: 1536, h: 2048 });
});

test('S2: small images are never upscaled or re-encoded', () => {
  assert.deepEqual(upload.fitWithin(1200, 900, 2048), { width: 1200, height: 900, scaled: false });
  assert.deepEqual(upload.fitWithin(1, 1, 2048), { width: 1, height: 1, scaled: false });
  assert.deepEqual(upload.fitWithin(0, 0, 2048), { width: 1, height: 1, scaled: false });
});

test('S3: a resized JPEG keeps a .jpg name and the base64 is plain', () => {
  assert.equal(upload.jpegName('1000025576.jpg'), '1000025576.jpg');
  assert.equal(upload.jpegName('1000025576.PNG'), '1000025576.jpg');
  assert.equal(upload.jpegName('photo'), 'photo.jpg');
  const source = upload.imageSourceUrl({ data: 'aGVsbG8=', mimeType: 'image/png' });
  assert.equal(source, 'data:image/png;base64,aGVsbG8=');
});

test('S4: the host sentence for the rejected photo is shown, not HTTP-400', () => {
  const failure = {
    status: 400,
    error: 'Invalid image: dimensions must be 16-4096px per side and under 12MP.',
    offline: false,
  };
  const text = errors.actionableMessage(failure);
  assert.doesNotMatch(text, /^HTTP-400$/);
  assert.match(text, /图片尺寸超出/);
  assert.match(text, /4096/);
});

test('S5: a Chinese host reason survives untouched', () => {
  const host = '图片尺寸超出电脑端限制（单边 16–4096px，且总像素 ≤12MP），请压缩或裁剪后再发送。';
  const failure = { status: 400, error: host, offline: false };
  assert.equal(errors.actionableMessage(failure), host);
  assert.equal(errors.serverMessage({ error: host }, 400), host);
});

test('S6: timeout is not reported as offline', () => {
  const text = errors.actionableMessage({ status: 0, error: 'TIMEOUT', offline: true });
  assert.match(text, /超时/);
  assert.doesNotMatch(text, /连不上电脑/);
  const reset = errors.actionableMessage({ status: 0, error: 'NETWORK_ERROR', offline: true });
  assert.match(reset, /连接中断/);
});

test('S7: 401 keeps the re-pair instruction even with a host body', () => {
  assert.match(errors.actionableMessage({ status: 401, error: 'unauthorized', offline: false }), /重新配对/);
});

test('S8: server messages are bounded and never echo a credential', () => {
  assert.ok(errors.serverMessage({ error: 'x'.repeat(400) }, 400).length <= 200);
  assert.equal(errors.serverMessage({ error: 'token=abcd1234' }, 400), 'HTTP-400');
  assert.equal(errors.serverMessage({ message: 'plain host text' }, 409), 'plain host text');
  assert.equal(errors.serverMessage({}, 413), 'HTTP-413');
});

test('S9: the composer shrinks picked images before the tray validates size', () => {
  const composer = read('components/ChatComposer.tsx');
  const pick = composer.indexOf('await pickAttachments(kind)');
  const shrink = composer.indexOf('await shrinkPickedImages(picked, kind)');
  const tray = composer.indexOf('pickerTrayForResult({');
  assert.ok(pick > 0 && shrink > pick && tray > shrink, 'compress before validation');
  assert.match(composer, /compressImageForUpload/);
});

test('S10: send failures carry this send\'s reason and retry transport once', () => {
  const store = read('state/dataStore.ts');
  assert.match(store, /lastSendError/);
  assert.match(store, /retryTransport\(context, \(\) => postSend/);
  assert.match(store, /retryTransport\(context, \(\) => postNewThread/);
  assert.match(store, /setTimeout\(resolve, 700\)/);
  const screen = read('screens/ChatDetailScreen.tsx');
  assert.match(screen, /lastSendError \|\| dataStore\.getState\(\)\.error/);
});
