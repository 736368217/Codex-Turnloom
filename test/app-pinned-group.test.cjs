'use strict';
/**
 * 置顶会话组（Desktop 的 `sessions.pinned`）。
 *
 * 2.2.4 的列表完全不读 `pinned`，服务端早在 `threadListMetadata()` 里给了这个
 * 字段。这一组属于「接线」，但两条判据必须是可量的，不是眼看：
 *   0 条 pinned → DOM 里没有置顶组（不是隐藏的空标题）；
 *   有 pinned   → 组在首，且该 id 在整页只出现一次（项目组/时间列表不得重复）。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');

const root = path.resolve(__dirname, '../app/src');
const read = (file) => fs.readFileSync(path.resolve(root, file), 'utf8');

function loadProjection() {
  const full = path.resolve(root, 'lib/threadProjection.ts');
  let js = stripTypeScriptTypes(fs.readFileSync(full, 'utf8'));
  const names = [...js.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map((m) => m[1]);
  js = js
    .replace(/import\s*\{([\s\S]*?)\}\s*from\s*['"][^'"]+['"];?/g, (_, vars) => {
      // Only listStatusOf is imported; the pinned helpers do not touch it.
      return `const {${vars}} = { listStatusOf: () => ({ state: 'ended', thinking: false }) };`;
    })
    .replace(/\bexport\s+(?=(?:async\s+)?(?:function|const))/g, '');
  const mod = { exports: {} };
  new Function('module', 'exports', `"use strict";\n${js}\n${names.map((name) => `exports.${name} = ${name};`).join('\n')}`)(mod, mod.exports);
  return mod.exports;
}

const projection = loadProjection();

test('P1: pinned arrives in three shapes; an explicit false is final', () => {
  const { isPinnedThread } = projection;
  assert.equal(isPinnedThread({ pinned: true }), true);
  assert.equal(isPinnedThread({ pinned: 1 }), true);
  assert.equal(isPinnedThread({ pinned: '1' }), true);
  assert.equal(isPinnedThread({ isPinned: 1 }), true);
  assert.equal(isPinnedThread({ is_pinned: 1 }), true);
  assert.equal(isPinnedThread({ sectionName: 'pinned' }), true);
  assert.equal(isPinnedThread({ section_name: ' Pinned ' }), true);
  // 服务端归一化成 false 之后，原始字段不许把它翻回来。
  assert.equal(isPinnedThread({ pinned: false, isPinned: 1 }), false);
  assert.equal(isPinnedThread({ pinned: 0, sectionName: 'pinned' }), false);
  assert.equal(isPinnedThread({}), false);
  assert.equal(isPinnedThread(null), false);
});

test('P2: partition keeps order, loses nothing, duplicates nothing', () => {
  const { partitionPinned } = projection;
  const rows = [
    { id: 'a', pinned: false },
    { id: 'b', pinned: true },
    { id: 'c' },
    { id: 'd', pinned: 1 },
  ];
  const { pinned, rest } = partitionPinned(rows);
  assert.deepEqual(pinned.map((row) => row.id), ['b', 'd']);
  assert.deepEqual(rest.map((row) => row.id), ['a', 'c']);
  assert.equal(pinned.length + rest.length, rows.length);
});

test('P3: the screen renders one 置顶 group above both views, from the unpinned rest', () => {
  const screen = read('screens/ThreadsScreen.tsx');
  assert.match(screen, /partitionPinned\(rows\)/);
  // Both views draw the group; a group built from all rows would duplicate them.
  assert.match(screen, /groupThreadsByProject\(plainRows\)/);
  assert.match(screen, /\[\.\.\.plainRows\]\.sort/);
  assert.match(screen, /const pinnedGroup = pinnedRows\.length === 0 \? null : \(/);
  assert.match(screen, /<span className="tl-group-name">置顶<\/span>/);
  // 0 pinned must render nothing at all — not an empty header.
  assert.match(screen, /data-qa="pinned-group"/);
  // Default expanded, unlike project groups.
  assert.match(screen, /key === PINNED_KEY \? false : !isUncategorized\(key\)/);
  // The group is inserted in both branches.
  const inserts = [...screen.matchAll(/\{pinnedGroup\}/g)].length;
  assert.equal(inserts, 2, 'pinnedGroup must be rendered in both the time and project views');
});

test('P4: list rows carry their id so duplicates are countable in the DOM', () => {
  const row = read('components/TaskStream.tsx');
  assert.match(row, /data-thread-id=\{thread\.id\}/);
});
