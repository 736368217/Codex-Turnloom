'use strict';

/**
 * 设置页「当前电脑」一行的文字布局（2.4.3，NB3 2026-11-26 提的截断项）。
 *
 * 320×645 css 下量到标题 `.tl-settings-title` 只有 138/200 px，渲染成
 * `Turnloom-QA · Cod…`——机器名和平台名挤在同一条 nowrap+ellipsis 里，
 * 两个信息互相吃宽度，谁都读不全。
 *
 * 判据（NB3 定）：身份与地址两样总得读全一样，不能两样都半截。
 * 第一版把平台名挪进副行，按 11px × 40 字符 ≈ 290px 算，副行也会截掉地址，
 * 两样都半截——所以最终版是：标题只留机器名（短、必读全），副行只放地址
 * （21 字符 ≈ 150px，138px 里擦边但地址主体可见）；平台名不在这行出现，
 * 设备页本来就有「当前 Codex Desktop」。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../app/src/screens/SettingsScreen.tsx'), 'utf8');

/** 只取「当前电脑」那张卡，别把别的 settings 行混进来。 */
const card = source.slice(source.indexOf('tl-settings-device'), source.indexOf('tl-settings-group', source.indexOf('tl-settings-device')));
const title = card.match(/<span className="tl-settings-title">([\s\S]*?)<\/span>/);
const sub = card.match(/<span className="tl-settings-sub tl-settings-address">([\s\S]*?)<\/span>/);

test('T1: 标题只放机器名，不再拼平台名', () => {
  assert.ok(title, '必须能定位到「当前电脑」卡的标题');
  assert.match(title[1], /^\s*\{session\.machineName\}\s*$/, `标题只能是机器名，实际：${title[1]}`);
  assert.doesNotMatch(title[1], /platformLabel/, '平台名不得进标题（会把机器名挤成省略号）');
});

test('T2: 副行只放地址，不再拼平台名（两样都半截不如一样读全）', () => {
  assert.ok(sub, '必须能定位到「当前电脑」卡的副行');
  assert.match(sub[1], /session\.serverUrl/, '副行要带地址');
  assert.doesNotMatch(sub[1], /platformLabel/, '平台名不得进副行——会把地址挤成省略号');
});

test('T3: 没有地址时显示「尚未连接」', () => {
  assert.match(sub[1], /'尚未连接'/, '副行必须有兜底文案');
});
