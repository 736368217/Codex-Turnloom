'use strict';

/**
 * 系统返回键的覆盖清单（Human 13:49：「返回了直接回桌面」「多层级页面也没做好」）。
 *
 * native 的事实（Rhea 729）：`onBackPressed → window.__turnloomBack()`，
 * **JS 返回非 true 才** `moveTaskToBack(true)`。所以每一层必须自己注册：
 *   - 底部抽屉（VaulSheet）→ 关抽屉
 *   - 自绘 overlay（ThreadsScreen 的归档确认）→ 关确认
 *   - 详情页（ChatDetailScreen）→ closeDetail
 * 少一层，那一层上的返回就会把 App 退回桌面。这个测试钉住这三处注册，
 * 谁再删掉一条，这里先红。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const readApp = (rel) => fs.readFileSync(path.join(ROOT, 'app', 'src', rel), 'utf8');

test('抽屉：VaulSheet 打开时注册返回层', () => {
  const source = readApp('components/VaulSheet.tsx');
  assert.match(source, /pushNativeBackLayer/);
  assert.match(source, /if \(open\) return pushNativeBackLayer\(/);
});

test('归档确认：自绘 overlay 必须注册返回层', () => {
  const source = readApp('screens/ThreadsScreen.tsx');
  assert.match(source, /pushNativeBackLayer\(\(\) => setPending\(null\)\)/);
});

test('详情页：ChatDetailScreen 必须注册返回层并 closeDetail', () => {
  const source = readApp('screens/ChatDetailScreen.tsx');
  assert.match(source, /pushNativeBackLayer/);
  assert.match(source, /pushNativeBackLayer\(\(\) => \{[^}]*closeDetail\(\)/, '详情页返回必须真的关掉详情，而不是留给 native 退后台');
});

test('native 侧语义没被改：返回层优先，其次 backHandler，否则交给 native', () => {
  const source = readApp('lib/nativeBridge.ts');
  assert.match(source, /export function handleNativeBack\(\): boolean/);
  assert.match(source, /const layer = backLayers\[backLayers\.length - 1\]/);
  assert.match(source, /if \(!backHandler\) return false;/);
});
