'use strict';

/**
 * logs/phone/ had a per-file bound (1,000 lines) and no directory bound: every
 * reporting day added one more file, forever. These tests pin the directory
 * budget, the oldest-first order, and the fact that nothing outside the archive
 * pattern is ever deleted.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const log = require('../server/request-log.cjs');

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'turnloom-phone-retention-'));
  fs.mkdirSync(path.join(dir, 'phone'), { recursive: true });
  return dir;
}

function writeDay(dir, name, lines, prefix = 'm') {
  const file = path.join(dir, 'phone', `${prefix}-${name}.jsonl`);
  const body = Array.from({ length: lines }, (_, index) => `{"at":"2026-01-01T00:00:0${index % 10}Z","kind":"send","n":${index}}`).join('\n') + '\n';
  fs.writeFileSync(file, body, 'utf8');
  return { file, bytes: Buffer.byteLength(body, 'utf8') };
}

function names(dir) {
  return fs.readdirSync(path.join(dir, 'phone')).sort();
}

test('keeps the newest day files and removes the oldest whole files first', () => {
  const dir = tempDir();
  try {
    const a = writeDay(dir, '20260101', 3);
    const b = writeDay(dir, '20260102', 3);
    const c = writeDay(dir, '20260103', 3);
    const d = writeDay(dir, '20260104', 3);
    const total = a.bytes + b.bytes + c.bytes + d.bytes;

    // Budget that fits exactly two files.
    const report = log.prunePhoneLogDir(dir, { maxBytes: Math.ceil(total / 2), maxLines: 10000 });
    assert.equal(report.removed.length, 2, 'two oldest files go');
    assert.deepEqual(report.removed.map((row) => row.name), ['m-20260101.jsonl', 'm-20260102.jsonl']);
    assert.deepEqual(names(dir), ['m-20260103.jsonl', 'm-20260104.jsonl']);
    assert.equal(report.bytes, c.bytes + d.bytes, 'reported bytes match what is left');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the line budget is a file budget because every file is already trimmed', () => {
  const dir = tempDir();
  try {
    for (const day of ['20260101', '20260102', '20260103', '20260104', '20260105']) writeDay(dir, day, 2);
    // 3,000 lines at 1,000 lines per file => at most 3 files.
    const report = log.prunePhoneLogDir(dir, { maxBytes: 10 * 1024 * 1024, maxLines: 3000, maxLinesPerFile: 1000 });
    assert.equal(report.maxFiles, 3);
    assert.equal(report.removed.length, 2);
    assert.deepEqual(names(dir), ['m-20260103.jsonl', 'm-20260104.jsonl', 'm-20260105.jsonl']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('never touches other files, other extensions, or subdirectories', () => {
  const dir = tempDir();
  try {
    writeDay(dir, '20260101', 2);
    writeDay(dir, '20260102', 2);
    fs.writeFileSync(path.join(dir, 'phone', 'keep-me.txt'), 'not a day file\n');
    fs.writeFileSync(path.join(dir, 'phone', 'm-20260102.jsonl.bak'), 'old copy\n');
    fs.writeFileSync(path.join(dir, 'phone', 'session-20260102.log'), 'other stream\n');
    fs.mkdirSync(path.join(dir, 'phone', 'nested'));
    fs.writeFileSync(path.join(dir, 'phone', 'nested', 'm-20250101.jsonl'), '{"at":"x"}\n');

    // A byte budget of zero would delete everything if the filter were loose.
    log.prunePhoneLogDir(dir, { maxBytes: 0, maxLines: 100000 });
    assert.deepEqual(names(dir), ['keep-me.txt', 'm-20260102.jsonl', 'm-20260102.jsonl.bak', 'nested', 'session-20260102.log']);
    assert.equal(fs.readFileSync(path.join(dir, 'phone', 'keep-me.txt'), 'utf8'), 'not a day file\n');
    assert.equal(fs.readFileSync(path.join(dir, 'phone', 'm-20260102.jsonl.bak'), 'utf8'), 'old copy\n');
    assert.ok(fs.existsSync(path.join(dir, 'phone', 'nested', 'm-20250101.jsonl')), 'no recursion into subdirectories');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the newest file survives even when it alone exceeds the budget', () => {
  const dir = tempDir();
  try {
    writeDay(dir, '20260101', 40);
    const report = log.prunePhoneLogDir(dir, { maxBytes: 1, maxLines: 1, maxLinesPerFile: 1 });
    assert.equal(report.removed.length, 0, 'a directory with one file keeps it');
    assert.deepEqual(names(dir), ['m-20260101.jsonl']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing phone directory is a no-op, not a throw', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'turnloom-phone-empty-'));
  try {
    const report = log.prunePhoneLogDir(dir, { maxBytes: 10, maxLines: 10 });
    assert.deepEqual(report.removed, []);
    assert.equal(report.files, 0);
    assert.equal(report.bytes, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writing diagnostics enforces the directory budget and reports it', () => {
  const dir = tempDir();
  try {
    for (const day of ['20260101', '20260102', '20260103']) writeDay(dir, day, 5, 'laptop');
    const messages = [];
    const written = log.writePhoneDiagnostics(dir, {
      machine: 'laptop',
      records: [{ at: '2026-01-04T00:00:00.000Z', kind: 'send', message: 'sent' }],
      dropped: 0,
    }, {
      date: new Date(2026, 0, 4),
      dirMaxBytes: 400,
      logger: (message) => messages.push(message),
    });

    assert.equal(written.stored, 1);
    assert.ok(written.retention, 'the append reports what retention did');
    assert.ok(written.retention.removed.length >= 1, 'older days are pruned');
    assert.ok(names(dir).includes('laptop-20260104.jsonl'), 'today\'s file is written');
    assert.ok(!names(dir).includes('laptop-20260101.jsonl'), 'the oldest day is gone');
    assert.equal(messages.length, 1, 'pruning is logged once per append that prunes');
    assert.match(messages[0], /phone log retention: removed \d+ oldest day file/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pruning can be turned off per call without changing the write', () => {
  const dir = tempDir();
  try {
    for (const day of ['20260101', '20260102']) writeDay(dir, day, 5, 'laptop');
    const written = log.writePhoneDiagnostics(dir, {
      machine: 'laptop',
      records: [{ at: '2026-01-03T00:00:00.000Z', kind: 'send', message: 'sent' }],
      dropped: 0,
    }, { date: new Date(2026, 0, 3), prune: false });
    assert.equal(written.stored, 1);
    assert.equal(written.retention, null);
    assert.equal(names(dir).length, 3, 'nothing was pruned');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
