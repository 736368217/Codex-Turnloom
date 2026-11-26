'use strict';

/**
 * 「显示/隐藏归档会话」开关的零状态（2.4.3，NB3 2026-11-26 09:50 判据，NB agent 实现）。
 *
 * AGENTS.md 的「零状态不渲染」在这里与「不要把人关在没有出口的视图里」打架：
 *
 *   1. 没展开且归档数是 0 —— 没有任何东西可显示，整颗按钮不渲染；
 *   2. 已展开、归档数恰好掉到 0（用户刚取消最后一条）—— 按钮必须留着，
 *      否则列表停在「只显示归档」的视图里，界面上没有回到正常列表的入口；
 *   3. 归档数大于 0 时文案与计数不变。
 *
 * 第 2 条是这次真正修掉的缺陷：旧写法 `archivedCount > 0 ? undefined : 'none'`
 * 只看计数，展开态归零后按钮一起消失。两个布局分支（时间 / 项目）各一颗按钮，
 * 必须同时满足。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../app/src/screens/ThreadsScreen.tsx'), 'utf8');

/** 只取真正的 style 表达式，注释里的旧写法不能影响断言。 */
const styleGuards = [...source.matchAll(/display:\s*([^,}]+?)\s*\?\s*undefined\s*:\s*'none'/g)]
  .map((match) => match[1].trim());

test('T1: 两颗归档开关都允许「已展开但计数为 0」时继续渲染', () => {
  assert.equal(styleGuards.length, 2, '时间与项目两个分支各一颗按钮');
  for (const guard of styleGuards) {
    assert.match(guard, /showArchived\s*\|\|\s*archivedCount\s*>\s*0/, `守卫必须包含展开态：${guard}`);
  }
});

test('T2: 未展开且计数为 0 时仍然什么都不渲染', () => {
  for (const guard of styleGuards) {
    // showArchived=false、archivedCount=0 时表达式必须是假。
    const whenCollapsed = guard.replace(/\bshowArchived\b/g, 'false').replace(/\barchivedCount\b/g, '0');
    assert.equal(Function(`return (${whenCollapsed});`)(), false, guard);
    // 展开或计数非零任一成立就要渲染。
    const whenExpanded = guard.replace(/\bshowArchived\b/g, 'true').replace(/\barchivedCount\b/g, '0');
    assert.equal(Function(`return (${whenExpanded});`)(), true, guard);
    const whenCounted = guard.replace(/\bshowArchived\b/g, 'false').replace(/\barchivedCount\b/g, '2');
    assert.equal(Function(`return (${whenCounted});`)(), true, guard);
  }
});

test('T3: 文案与计数不变', () => {
  assert.match(source, /showArchived \? `隐藏归档会话（\$\{archivedCount\}）` : `显示归档会话（\$\{archivedCount\}）`/);
});
