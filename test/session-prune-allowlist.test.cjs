const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const script = path.resolve(__dirname, '../scripts/prune-session-artifacts.mjs');

test('session prune exact IDs protect unrelated and running sessions and back up selected rows', () => {
  const dir = fs.mkdtempSync(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'prune-ids-'));
  const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003'];
  const file = path.join(dir, 'test.sqlite');
  let db = new DatabaseSync(file);
  try {
    db.exec('CREATE TABLE sessions(id TEXT PRIMARY KEY,title TEXT,created_at INTEGER,project_id TEXT,deleted_at INTEGER); CREATE TABLE messages(session_id TEXT,seq INTEGER,role TEXT,tool_name TEXT,text TEXT); CREATE TABLE turns(session_id TEXT,status TEXT)');
    for (const [index, id] of ids.entries()) {
      db.prepare('INSERT INTO sessions VALUES(?,?,?,?,NULL)').run(id, 'test-' + index, Date.now(), 'qa');
      db.prepare('INSERT INTO messages VALUES(?,0,\'user\',\'\',?)').run(id, index === 0 ? '你是「多会话编排」派出的真实子会话' : '（可删）fixture');
    }
    db.prepare('INSERT INTO turns VALUES(?,\'running\')').run(ids[2]);
    db.close(); db = null;
    const args = [script, '--db', file, '--since', '2000-01-01', '--out', dir, '--ids', [ids[0], ids[2]].join(',')];
    const dry = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true });
    assert.equal(dry.status, 0, dry.stderr);
    db = new DatabaseSync(file); assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions WHERE deleted_at IS NOT NULL').get().n, 0); db.close(); db = null;
    const applied = spawnSync(process.execPath, [...args, '--apply'], { encoding: 'utf8', windowsHide: true });
    assert.equal(applied.status, 0, applied.stderr);
    db = new DatabaseSync(file);
    assert.ok(db.prepare('SELECT deleted_at FROM sessions WHERE id=?').get(ids[0]).deleted_at);
    for (const id of ids.slice(1)) assert.equal(db.prepare('SELECT deleted_at FROM sessions WHERE id=?').get(id).deleted_at, null);
    const backups = fs.readdirSync(dir).filter(n => n.startsWith('session-prune-'));
    assert.equal(backups.length, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, backups[0]), 'utf8')).sessions.map(s => s.id), [ids[0]]);
  } finally {
    if (db) db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('session prune refuses incomplete or empty explicit ID filters', () => {
  for (const args of [['--ids', 'partial'], ['--ids']]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /complete session UUIDs/);
  }
});
