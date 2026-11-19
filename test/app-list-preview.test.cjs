'use strict';

/**
 * 列表行的第二行只许是「人写过的一句话」，永远不许是 id 或路径。
 *
 * 为什么是源码断言而不是纯函数单测：`previewOfThread` 住在 `TaskStream.tsx`，
 * 带 JSX，本仓库的单测加载器只吃得下 .ts。等 Iris 那版稳定后，把纯函数搬到
 * `lib/threadPreview.ts` 再改写成行为断言（那样能钉负面样本：UUID / 路径 / 空串）。
 * 在那之前，这里钉四件事，正好防住这次真机上那一整列 UUID 的回退：
 *   1. 规则函数存在且被导出；
 *   2. 它显式处理「空」「等于 id」「UUID 形」「路径形」四种；
 *   3. 行渲染是「有 preview 才画这一行」，不是「总是画、内容为空」；
 *   4. 旧的 `thread.preview || thread.cwd || thread.id` 回退不许回来。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'app', 'src', 'components', 'TaskStream.tsx'), 'utf8');

const previewBody = (() => {
  const start = SOURCE.indexOf('export function previewOfThread');
  assert.notEqual(start, -1, 'previewOfThread 不见了');
  const end = SOURCE.indexOf('\n}', start);
  return SOURCE.slice(start, end === -1 ? undefined : end);
})();

test('规则函数被导出', () => {
  assert.match(SOURCE, /export function previewOfThread\(/);
});

test('四种不许出现的形状都有显式处理', () => {
  assert.match(previewBody, /if \(!raw\) return '';/, '空 preview 必须直接返回空串（不许回退到 id/path）');
  assert.match(previewBody, /raw === id/, '等于会话 id 的值必须被吃掉');
  assert.match(previewBody, /UUID/, 'UUID 形状必须被吃掉');
  assert.ok(previewBody.includes('[a-zA-Z]:'), '盘符路径形状必须被吃掉');
  assert.ok(previewBody.includes('~['), '家目录路径形状必须被吃掉');
});

test('行渲染是「有 preview 才画这一行」', () => {
  assert.match(SOURCE, /\{preview && <span className="tl-thread-preview">/, '空的第二行不该占位');
});

test('旧的回退链不许回来', () => {
  assert.doesNotMatch(SOURCE, /thread\.preview \|\| thread\.cwd \|\| thread\.id/, '这是真机上显示 UUID 的原写法');
  assert.doesNotMatch(SOURCE, /\{String\(thread\.preview \|\| thread\.cwd/, '同上');
});
