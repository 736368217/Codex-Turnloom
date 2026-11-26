"use strict";

/**
 * 会话归档表与「入口」无关（2.4.3，NB agent 判给我这条）。
 *
 * 换入口 = 换 origin（8787 ↔ 8788、`tl` ↔ `tl-cf`）。归档表原先是 localStorage，
 * 按 origin 分区，于是切到另一个入口时那张表是空的：被隐藏的会话全部重新冒出来，
 * 切回去又消失。现在归档表走 native 槽（与 prefs 同一处），两个入口读写同一份。
 *
 * 这里锁四件事：
 *   1. 归档不写 localStorage —— 换入口不会丢，也不会被 origin 分成两份；
 *   2. 同一台机器在两个 origin 上双向一致（A 归档 → B 仍隐藏 → 切回 A 仍隐藏）；
 *   3. 2.4.2 留在 localStorage 的旧表只迁移一次，原键不删；
 *   4. 上限 2000、重复 set 不通知、订阅者出错不影响别人。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');

const root = path.resolve(__dirname, '../app/src');
const KEY = 'turnloom.archivedThreads.v1';

/**
 * 一个「入口」：native 槽在同一个设备里共享（归档表必须跨 origin），
 * localStorage 按 origin 各一份（模拟浏览器分区）。
 */
function device() {
  const secure = new Map();
  const modules = new Map();
  const originStores = new Map();

  function load(file) {
    file = path.resolve(root, file);
    if (!path.extname(file)) file += '.ts';
    if (modules.has(file)) return modules.get(file).exports;
    const mod = { exports: {} };
    modules.set(file, mod);
    let js = stripTypeScriptTypes(fs.readFileSync(file, 'utf8'));
    const names = [...js.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g)].map(m => m[1]);
    js = js
      .replace(/import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/g, (_, vars, source) => `const {${vars}} = require(${JSON.stringify(source)});`)
      .replace(/export\s+interface\s+\w+\s*\{[\s\S]*?\n\}/g, '')
      .replace(/export\s+type\s+[\s\S]*?;/g, '')
      .replace(/export default [^;]+;/g, '')
      .replace(/\bexport\s+(?=(?:async\s+)?(?:function|const|class))/g, '');
    new Function('require', 'module', 'exports', `${js}\n${names.map(name => `exports.${name} = ${name};`).join('\n')}`)(
      source => load(path.resolve(path.dirname(file), source)),
      mod,
      mod.exports,
    );
    return mod.exports;
  }

  /** 进入某个入口：换 localStorage，native 槽保持。模块缓存也清掉（模拟另一次启动）。 */
  function boot(origin) {
    if (!originStores.has(origin)) originStores.set(origin, new Map());
    const store = originStores.get(origin);
    global.localStorage = {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(key, String(value)); },
      removeItem: key => { store.delete(key); },
    };
    global.window = {
      TurnloomNative: {
        secureGet: key => secure.get(key) ?? null,
        secureSet: (key, value) => { secure.set(key, String(value)); return true; },
        secureRemove: key => secure.delete(key),
        getAppInfo: () => JSON.stringify({ version: '2.4.3', versionCode: 102, packageName: 'com.codex.turnloom.app' }),
        cancelRequest() {},
      },
    };
    modules.clear();
    return load('lib/threadArchive.ts');
  }

  return { secure, originStores, boot };
}

test('归档写入 native 槽，不写 localStorage', () => {
  const d = device();
  const archive = d.boot('http://192.168.50.42:8787');
  archive.setThreadArchived('thread-a', true);

  assert.deepEqual(archive.archivedThreadIds(), ['thread-a']);
  assert.equal(archive.isLocallyArchived('thread-a'), true);
  // 关键：origin 分区里没有这张表，所以换入口不会读到空的。
  assert.equal(d.originStores.get('http://192.168.50.42:8787').has(KEY), false);
  assert.deepEqual(JSON.parse(d.secure.get(KEY)), ['thread-a']);
});

test('同一台机器在两个入口上双向一致', () => {
  const d = device();
  const lan = d.boot('http://192.168.50.42:8787');
  lan.setThreadArchived('thread-a', true);

  // 换到反向代理入口（另一个 origin，localStorage 是另一份）。
  const relay = d.boot('http://127.0.0.1:8788');
  assert.equal(relay.isLocallyArchived('thread-a'), true, 'B 仍隐藏 A 归档的会话');
  assert.deepEqual(relay.archivedThreadIds(), ['thread-a']);

  // 在 B 归档第二条，切回 A 仍然看得见两条，取消归档也双向生效。
  relay.setThreadArchived('thread-b', true);
  const lanAgain = d.boot('http://192.168.50.42:8787');
  assert.deepEqual(lanAgain.archivedThreadIds(), ['thread-a', 'thread-b']);
  lanAgain.setThreadArchived('thread-a', false);
  assert.deepEqual(d.boot('http://127.0.0.1:8788').archivedThreadIds(), ['thread-b']);
});

test('2.4.2 的 localStorage 表只迁移一次，原键保留', () => {
  const d = device();
  const origin = 'http://192.168.50.42:8787';
  // 旧版本留下的现场。
  const legacy = d.boot(origin);
  void legacy;
  d.originStores.get(origin).set(KEY, JSON.stringify(['old-1', 'old-2']));

  const upgraded = d.boot(origin);
  assert.deepEqual(upgraded.archivedThreadIds(), ['old-1', 'old-2']);
  assert.deepEqual(JSON.parse(d.secure.get(KEY)), ['old-1', 'old-2'], '迁移后写进 native 槽');
  assert.deepEqual(JSON.parse(d.originStores.get(origin).get(KEY)), ['old-1', 'old-2'], '原键不删，可回退');

  // 迁移之后 native 槽是权威：另一个入口直接看到，不再依赖任何 locality。
  upgraded.setThreadArchived('new-1', true);
  assert.deepEqual(d.boot('http://10.0.0.5:8787').archivedThreadIds(), ['old-1', 'old-2', 'new-1']);
});

test('native 槽已存在时不再读旧表', () => {
  const d = device();
  const origin = 'http://192.168.50.42:8787';
  d.secure.set(KEY, JSON.stringify(['native-1']));
  const archive = d.boot(origin);
  d.originStores.get(origin).set(KEY, JSON.stringify(['stale-legacy']));

  assert.deepEqual(archive.archivedThreadIds(), ['native-1']);
});

test('上限 2000、重复 set 不通知、订阅者可退订', () => {
  const d = device();
  const archive = d.boot('http://192.168.50.42:8787');
  for (let i = 0; i < 2005; i += 1) archive.setThreadArchived(`t-${i}`, true);
  const ids = archive.archivedThreadIds();
  assert.equal(ids.length, 2000);
  assert.equal(ids[0], 't-5', '只保留最近 2000 条');
  assert.equal(ids[ids.length - 1], 't-2004');

  let calls = 0;
  const off = archive.subscribeThreadArchive(() => { calls += 1; });
  archive.setThreadArchived('t-2004', true); // 已经是归档态，不该通知
  assert.equal(calls, 0);
  archive.setThreadArchived('t-2004', false);
  assert.equal(calls, 1);
  off();
  archive.setThreadArchived('t-2004', true);
  assert.equal(calls, 1, '退订后不再收到通知');

  archive.clearThreadArchive();
  assert.deepEqual(archive.archivedThreadIds(), []);
});
