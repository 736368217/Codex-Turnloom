"use strict";

/**
 * What a failed request may say to a person (QA 2026-11-26, defect 3).
 *
 * The phone showed `电脑端服务出错：spawn codex ENOENT`. That is a Node child
 * process error forwarded from the host: it names nothing the user can act on and
 * leaks the host's own implementation. Two rules, locked here:
 *   1. "the desktop app is not running" is translated into a sentence that says
 *      what to do next;
 *   2. anything that looks like a log line (stack frame, errno, `file.js:12`,
 *      `FooError:`) never reaches the screen, while a genuine host sentence
 *      ("磁盘已满，请清理后重试。") still does.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');

function load(file) {
  const source = path.resolve(__dirname, '../app/src', file);
  const mod = { exports: {} };
  const typed = stripTypeScriptTypes(fs.readFileSync(source, 'utf8'));
  const names = [...typed.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g)].map(m => m[1]);
  const js = typed
    .replace(/export\s+interface\s+\w+\s*\{[\s\S]*?\n\}/g, '')
    .replace(/export\s+type\s+[\s\S]*?;/g, '')
    .replace(/\bexport\s+/g, '');
  new Function('module', 'exports', `${js}\n${names.map(name => `exports.${name} = ${name};`).join('\n')}`)(mod, mod.exports);
  return mod.exports;
}

const { actionableMessage } = load('lib/serverErrors.ts');

const failure = (status, error) => ({ status, error, offline: false });

/** Nothing on a screen may carry these: they are the host's internals. */
function assertNoInternals(text) {
  assert.equal(/\benoent\b/i.test(text), false, `ENOENT leaked: ${text}`);
  assert.equal(/\bspawn\b/i.test(text), false, `spawn leaked: ${text}`);
  assert.equal(/ipc unavailable/i.test(text), false, `IPC unavailable leaked: ${text}`);
  assert.equal(/\bat\s+[\w$.<>]+\s*\(/.test(text), false, `stack frame leaked: ${text}`);
  assert.equal(/\berrno\b/i.test(text), false, `errno leaked: ${text}`);
  assert.equal(/\.(?:js|cjs|mjs|ts|tsx):\d+/.test(text), false, `source location leaked: ${text}`);
}

test('a missing Codex Desktop says so, in words the user can act on', () => {
  const bare = actionableMessage(failure(500, 'spawn codex ENOENT'));
  assert.equal(bare, '电脑上没找到 Codex 桌面端，启动后再重试。');

  // The shapes the host actually produced during QA, all one cause.
  for (const raw of [
    'Error: spawn codex ENOENT\n    at ChildProcess._handle.onexit (node:internal/child_process:283:19)',
    '[goal:read] IPC unavailable for 11111111-2222-3333-4444-555555555555; reading Desktop goal store.',
    'Error: connect ENOENT \\\\.\\pipe\\codex-ipc',
    'bridge unavailable: desktop app not running',
  ]) {
    const text = actionableMessage(failure(500, raw));
    assert.equal(text, '电脑上没找到 Codex 桌面端，启动后再重试。', `for ${JSON.stringify(raw)}`);
    assertNoInternals(text);
  }
});

test('a stack trace without that phrase is still not shown verbatim', () => {
  for (const raw of [
    'TypeError: Cannot read properties of undefined (reading id)\n    at readThread (/srv/turnloom/server.js:1204:17)',
    'Error: EBUSY resource busy or locked, open C:\\Users\\x\\.codex\\state.sqlite',
    "Error: connect ECONNREFUSED 127.0.0.1:8787 (code: 'ECONNREFUSED')",
  ]) {
    const text = actionableMessage(failure(500, raw));
    assert.equal(text, '电脑端服务出错，请检查桌面端状态后重试。', `for ${JSON.stringify(raw)}`);
    assertNoInternals(text);
  }
});

test('a sentence the host wrote for a person still gets through', () => {
  const text = actionableMessage(failure(500, '磁盘已满，请清理后重试。'));
  assert.equal(text, '电脑端服务出错：磁盘已满，请清理后重试。');
  assert.equal(actionableMessage(failure(400, '当前模型不支持图片，请切换到支持图片的模型。')), '当前模型不支持图片，请切换到支持图片的模型。');
});

test('the offline/unauthorized rules did not change', () => {
  assert.equal(actionableMessage(failure(401, 'whatever the host said')), '连接已失效，请重新配对这台机器。');
  assert.match(actionableMessage(failure(0, 'OFFLINE')), /连接中断，草稿已保留/);
  assert.match(actionableMessage(failure(0, 'timeout')), /请求超时/);
});
