'use strict';

/**
 * 设置页「当前电脑」一行的文字布局（2.4.3，NB3 2026-11-26 复量时提的截断项）。
 *
 * 320×645 css 下量到标题 `.tl-settings-title` 只有 138/200 px，显示成
 * `Turnloom-QA · Cod…`——机器名与平台名挤在同一行 nowrap+ellipsis 里，
 * 两个信息互相吃宽度，谁都读不完整。
 *
 * 改法（NB3 提的「去平台名」方向）：标题只留机器名，平台名挪到副行与地址拼在
 * 一起。标题恒定短、副行本来就带省略号，最坏情况截掉的是地址尾巴，不是身份。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../app/src/screens/SettingsScreen.tsx'), 'utf8');

/** 取「当前电脑」那张卡里的标题与副行，别把别的 settings 行混进来。 */
const card = source.slice(source.indexOf('tl-settings-device'), source.indexOf('tl-settings-group', source.indexOf('tl-settings-device')));
const title = card.match(/<span className="tl-settings-title">([\s\S]*?)<\/span>/);
const sub = card.match(/<span className="tl-settings-sub tl-settings-address">([\s\S]*?)<\/span>/);

test('T1: 标题只放机器名，不再拼平台名', () => {
  assert.ok(title, '必须能定位到「当前电脑」卡的标题');
  assert.match(title[1], /^\s*\{session\.machineName\}\s*$/, `标题只能是机器名，实际：${title[1]}`);
  assert.doesNotMatch(title[1], /platformLabel/, '平台名不得再进标题（会把机器名挤成省略号）');
});

test('T2: 平台名与地址在副行合并，缺一项不留空分隔符', () => {
  assert.ok(sub, '必须能定位到「当前电脑」卡的副行');
  assert.match(sub[1], /platformLabel\(harness, session\.machineName\)/, '副行要带平台名');
  assert.match(sub[1], /session\.serverUrl/, '副行要继续带地址');
  assert.match(sub[1], /\.filter\(Boolean\)\.join\(' · '\)/, '空项必须先过滤再拼，否则会出现「· 127.0.0.1:8787」');
});

test('T3: 两者都没有时仍显示「尚未连接」', () => {
  assert.match(sub[1], /'尚未连接'/, '副行必须有兜底文案');
});
