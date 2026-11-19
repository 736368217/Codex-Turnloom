#!/usr/bin/env node
/**
 * 模型面板的端到端交叉断言（读 capture 的 report.json，不抓 DOM）。
 *
 *   node tools/qa/check-model-sheet.mjs --report .scratch/qa/sheet225/report.json
 *   node tools/qa/check-model-sheet.mjs --report … --expected kimi-k3.1-pro,deepseek-v4.1-flash,hy4flash-free
 *
 * 判据（NB3 的口径）：
 *   - chip 上那一个模型必须在面板条目里（chip ⊂ panel）——否则「默认值不在集合内」
 *     只是从一处挪到了另一处；
 *   - 面板行集合 = 服务端集合 ∪（当前会话模型，仅在它不在集合内时）：
 *     集合外最多一条、不可选、带「电脑端未加入」；顺序照服务端数组；
 *   - 同一个模型不出现两次。
 */
import fs from 'node:fs';
import path from 'node:path';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
};

const reportPath = arg('report', '.scratch/qa/sheet225/report.json');
const expected = (arg('expected', '') || '').split(',').map((item) => item.trim()).filter(Boolean);

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` · ${detail}` : ''}`);
  if (!ok) failures += 1;
};

try {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const sheets = report.modelSheets || {};
  const labels = Object.keys(sheets);
  check(labels.length > 0, 'report contains a model sheet reading', labels.join(', '));

  for (const label of labels) {
    const sheet = sheets[label];
    const names = (sheet.rows || []).map((row) => row.name);
    const disabled = (sheet.rows || []).filter((row) => row.disabled);
    // Recompute from the row the panel marks selected: trusting the flag capture
    // wrote would only re-assert capture's own arithmetic.
    const selectedRow = (sheet.rows || []).find((row) => row.selected);
    const chipInPanel = Boolean(selectedRow) && selectedRow.name === sheet.chipName;
    check(chipInPanel, `[${label}] chip ⊂ panel`, `chip=${sheet.chipName} rows=${names.join(' > ')}`);
    if (sheet.chipInPanel !== undefined) {
      check(sheet.chipInPanel === chipInPanel, `[${label}] capture's own chipInPanel matches the recompute`);
    }
    check(names.length === new Set(names).size, `[${label}] no duplicate rows`, names.join(' > '));
    check(disabled.length <= 1, `[${label}] at most one row outside the server set`, String(disabled.length));
    if (disabled.length === 1) {
      check(sheet.rows[0].disabled === true, `[${label}] the outside row is first (a status line, not an option)`);
      check((sheet.rows[0].meta || '').includes('电脑端未加入'), `[${label}] the outside row says 电脑端未加入`, sheet.rows[0].meta || '');
    }
    if (expected.length) {
      const inside = names.filter((name) => !disabled.some((row) => row.name === name));
      const missing = expected.filter((name) => !inside.includes(name));
      const extra = inside.filter((name) => !expected.includes(name));
      check(missing.length === 0 && extra.length === 0, `[${label}] panel set equals the expected set`,
        missing.length ? `missing=${missing.join(',')}` : extra.length ? `extra=${extra.join(',')}` : `${inside.length} rows`);
      const sameOrder = expected.every((name, index) => inside[index] === name);
      check(sameOrder, `[${label}] panel keeps the server order`, inside.join(' > '));
    }
  }
} catch (error) {
  check(false, 'harness', error.message);
}

console.log(failures === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
