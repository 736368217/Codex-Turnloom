'use strict';

/**
 * PowerShell 5.1 按系统 ANSI 码页（这台机器是 CP936）解码**没有 BOM** 的 .ps1。
 * 中文注释若以全角标点结尾，它最后一个字节会和行尾 CR 配成一个 GBK 字符，
 * 换行被吞掉，下一行就被并进注释里。
 *
 * 2026-11-19 的 `publish-r2.ps1` 正是这样丢掉了 `$ExpectedCertSha256` 参数，
 * 于是"APK 必须用项目 key 签名"这道预检恒过（空值进 regex 匹配永远为真）。
 *
 * 这里不评判注释好坏，只断言一件可判定的事：同一份字节按 UTF-8 与按 GBK
 * 解出来的行数必须一致。少一行就说明有换行被吞，后面可能藏着被合并掉的代码。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');

test('scripts/*.ps1 survive a CP936 (PowerShell 5.1) read without losing lines', () => {
  const gbk = new TextDecoder('gbk');
  const offenders = [];
  const names = fs.readdirSync(SCRIPTS_DIR).filter((name) => name.endsWith('.ps1'));
  assert.ok(names.length > 0, 'expected at least one .ps1 under scripts/');

  for (const name of names) {
    const bytes = fs.readFileSync(path.join(SCRIPTS_DIR, name));
    const utf8Lines = bytes.toString('utf8').split(/\r?\n/).length;
    const gbkLines = gbk.decode(bytes).split(/\r?\n/).length;
    if (utf8Lines !== gbkLines) {
      offenders.push(`${name}: utf8=${utf8Lines} lines, cp936=${gbkLines} lines`);
    }
  }

  assert.deepEqual(offenders, [], `PowerShell 5.1 would swallow lines in:\n${offenders.join('\n')}`);
});
