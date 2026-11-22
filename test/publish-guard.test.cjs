'use strict';

/**
 * publish-r2.ps1 的签名门禁（2.2.3，task:f10ba9e9）。
 *
 * 这里守的是**门本身**，不是 APK：Vera 发现仓库里这一版在 Windows PowerShell
 * 5.1 下是"永远通过"——文件是 UTF-8 无 BOM，5.1 按 CP936 解码，参数块里一行
 * 中文注释以全角句号收尾，吃掉换行，把 `$ExpectedCertSha256` 并进 `#` 注释；
 * 空值进 `-notmatch ''` 恒真。pwsh 7 按 UTF-8 解码，所以本机用 pwsh 跑是绿的。
 *
 * 因此：① 文件必须是 UTF-8 with BOM；② 值必须被校验；③ 机器 key 的包必须被拒。
 * APK 依赖 dist-app/（gitignored），干净检出里自动 skip。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'publish-r2.ps1');
const MACHINE_KEY_APK = path.join(ROOT, 'dist-app', 'Codex-Turnloom-2.2.2-app-debug.apk');
const PROJECT_KEY_APK = path.join(ROOT, 'dist-app', 'Codex-Turnloom-2.2.3-app-debug.apk');
// 2.4.2 added a debuggable guard; the old "project key" fixture is a debug
// build, so it now belongs to the rejection test. The passing case needs a
// release build (dist-app is gitignored: clean checkouts skip that half).
const RELEASE_APK = path.join(ROOT, 'dist-app', 'Codex-Turnloom-2.4.2-app.apk');

function runPublish(args) {
  return spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...args],
    { encoding: 'utf8', timeout: 120_000 },
  );
}

test('publish-r2.ps1 必须是 UTF-8 with BOM（5.1 会按 CP936 解码无 BOM 文件）', () => {
  const head = fs.readFileSync(SCRIPT).subarray(0, 3);
  assert.deepEqual([...head], [0xEF, 0xBB, 0xBF]);
});

test(
  '机器 key 的 APK 必须被拒（跑的是 Windows PowerShell 5.1 那条路径）',
  { skip: process.platform === 'win32' && fs.existsSync(MACHINE_KEY_APK) ? false : '需要 Windows + dist-app 里的机器 key 包' },
  () => {
    const result = runPublish(['-Version', '2.2.2', '-VersionCode', '91', '-Apk', MACHINE_KEY_APK, '-DryRun']);
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    assert.notEqual(result.status, 0, `期望拒绝，实际通过：\n${output}`);
    assert.match(output, /not signed with the project key|expected cert sha256 is missing/);
  },
);

test(
  '项目 key 的 debug APK 必须被 debuggable 闸拒（2.4.1 漏发的根因）',
  { skip: process.platform === 'win32' && fs.existsSync(PROJECT_KEY_APK) ? false : '需要 Windows + dist-app 里的项目 key debug 包' },
  () => {
    const result = runPublish(['-Version', '2.2.3', '-VersionCode', '92', '-Apk', PROJECT_KEY_APK, '-DryRun']);
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    assert.notEqual(result.status, 0, `期望拒绝，实际通过：\n${output}`);
    assert.match(output, /debuggable=true/);
    assert.match(output, /refusing to publish a debug build/);
  },
);

test(
  '项目 key 的 release APK 预检通过',
  { skip: process.platform === 'win32' && fs.existsSync(RELEASE_APK) ? false : '需要 Windows + 先构建 dist-app 里的 release 包' },
  () => {
    const result = runPublish(['-Version', '2.4.2', '-VersionCode', '101', '-Apk', RELEASE_APK, '-DryRun']);
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    assert.equal(result.status, 0, output);
    assert.match(output, /signature matches the project key/);
    assert.match(output, /identity matches 2\.4\.2 \(101\); not debuggable/);
  },
);

test('publish-r2.ps1 的 debuggable 闸没被删掉（干净检出也能守）', () => {
  const script = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(script, /debuggable\\\(0x0101000f\\\)=true/);
  assert.match(script, /refusing to publish a debug build/);
});
