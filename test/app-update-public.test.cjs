'use strict';

/**
 * 公网更新通道（2.2.3，task:f10ba9e9）的合同测试。
 *
 * 覆盖：R2 地址白名单、R2 清单归一化、绝对 APK URL、评估结果的来源字段。
 * 与 `app-update-regress.test.cjs`（Vera 的负例表）互补：这里测"我的实现形状"，
 * 那里测"任何实现都必须拒绝的东西"。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'src');

function makeLoader() {
  const modules = new Map();
  function load(file) {
    let full = path.resolve(SRC, file);
    if (!path.extname(full)) full += '.ts';
    if (modules.has(full)) return modules.get(full).exports;
    const mod = { exports: {} };
    modules.set(full, mod);
    let js = stripTypeScriptTypes(fs.readFileSync(full, 'utf8'));
    const names = [...js.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g)].map((m) => m[1]);
    js = js
      .replace(/import\s+type\s+[^;]+;/g, '')
      .replace(/import\s+(?:type\s+)?\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/g, (_, vars, source) =>
        `const {${vars.replace(/\btype\s+/g, '')}} = require(${JSON.stringify(source)});`)
      .replace(/export default [^;]+;/g, '')
      .replace(/\bexport\s+(?=(?:async\s+)?(?:function|const|class|interface|type))/g, '');
    new Function('require', 'module', 'exports', js + '\n' + names.map((name) => `exports.${name} = ${name};`).join('\n'))(
      (source) => {
        if (source === 'react') return { useSyncExternalStore() {} };
        if (source === 'vaul' || source === 'lucide-react' || source === 'konsta/react' || source === 'motion/react') return {};
        return load(path.resolve(path.dirname(full), source));
      }, mod, mod.exports,
    );
    return mod.exports;
  }
  return { load };
}

global.window = global.window || {};
const { load } = makeLoader();
const appUpdate = load('lib/appUpdate.ts');
const bridge = load('lib/nativeBridge.ts');

const MANIFEST = 'https://dl.736.de5.net/turnloom/latest.json';
const APK = 'https://dl.736.de5.net/turnloom/Codex-Turnloom-2.2.3.apk';
const SHA = 'a'.repeat(64);
const INSTALLED = { versionCode: 91, packageName: 'com.codex.turnloom.app' };

function r2Manifest(overrides = {}) {
  return {
    version: '2.2.3',
    versionCode: 92,
    apk: 'turnloom/Codex-Turnloom-2.2.3.apk',
    size: 2238347,
    sha256: SHA,
    publishedAt: '2026-11-19T05:00:00Z',
    notes: '公网优先',
    ...overrides,
  };
}

test('公网白名单：只放行 R2 的清单与 APK', () => {
  assert.equal(bridge.isPublicUpdateUrl(MANIFEST), true);
  assert.equal(bridge.isPublicUpdateUrl(APK), true);
  assert.equal(bridge.isPublicUpdateUrl('https://dl.736.de5.net/turnloom/history/2.2.3.json'), true);
  assert.equal(bridge.isPublicUpdateUrl('https://dl.736.de5.net/turnloom/../api/app/update'), false);
  assert.equal(bridge.isPublicUpdateUrl('https://dl.736.de5.net/other/latest.json'), false);
  assert.equal(bridge.isPublicUpdateUrl('http://dl.736.de5.net/turnloom/latest.json'), false);
  assert.equal(bridge.isPublicUpdateUrl('https://dl.736.de5.net:8443/turnloom/latest.json'), false);
  assert.equal(bridge.isPublicUpdateUrl('/api/apk'), false);
});

test('公网白名单：URL 解析前先拒绝反斜杠（解析器会把它当路径分隔符）', () => {
  const raw = 'https://dl.736.de5.net/turnloom' + String.fromCharCode(92) + 'latest.json';
  assert.equal(bridge.isPublicUpdateUrl(raw), false);
  assert.equal(bridge.isAllowedApiUrl(raw), false);
});

test('isAllowedApiUrl：电脑端 /api/* 规则不回退，公网地址并入', () => {
  assert.equal(bridge.isAllowedApiUrl('http://192.168.50.42:8787/api/app/update'), true);
  assert.equal(bridge.isAllowedApiUrl('https://tl.z736.cc.cd/api/app/update-public'), true);
  assert.equal(bridge.isAllowedApiUrl(MANIFEST), true);
  assert.equal(bridge.isAllowedApiUrl(APK), true);
  assert.equal(bridge.isAllowedApiUrl('https://evil.com/api/app/update'), true); // 旧规则本来就允许任意 /api/* 主机
  assert.equal(bridge.isAllowedApiUrl('https://evil.com/turnloom/latest.json'), false);
});

test('R2 清单：存在即可用，绝对 apkUrl 由 host + 对象 key 拼出', () => {
  const result = appUpdate.validatePublicManifest(r2Manifest());
  assert.equal(result.ok, true);
  const release = result.release;
  assert.equal(release.available, true);
  assert.equal(release.packageName, 'com.codex.turnloom.app');
  assert.equal(release.versionName, '2.2.3');
  assert.equal(release.versionCode, 92);
  assert.equal(release.apkUrl, APK);
  assert.equal(release.sizeBytes, 2238347);
  assert.equal(release.sha256, SHA);
  assert.equal(release.notes, '公网优先');
});

test('R2 清单：坏字段必须拒，不能解析成"最新版"或"暂无安装包"', () => {
  assert.equal(appUpdate.validatePublicManifest(r2Manifest({ versionCode: 0 })).ok, false);
  assert.equal(appUpdate.validatePublicManifest(r2Manifest({ version: '' })).ok, false);
  assert.equal(appUpdate.validatePublicManifest(r2Manifest({ sha256: 'xyz' })).ok, false);
  assert.equal(appUpdate.validatePublicManifest(r2Manifest({ size: 0 })).ok, false);
  assert.equal(appUpdate.validatePublicManifest(r2Manifest({ apk: '/etc/passwd' })).ok, false);
  assert.equal(appUpdate.validatePublicManifest(r2Manifest({ apk: 'turnloom/../secret' })).ok, false);
  assert.equal(appUpdate.validatePublicManifest(r2Manifest({ apk: 'other/app.apk' })).ok, false);
  assert.equal(appUpdate.validatePublicManifest(null).ok, false);
});

test('评估：公网来源可下载；电脑端旧形状仍可评估', () => {
  const publicRelease = appUpdate.validatePublicManifest(r2Manifest()).release;
  const assessed = appUpdate.assessUpdate(publicRelease, INSTALLED, { source: 'public', host: 'dl.736.de5.net' });
  assert.equal(assessed.state, 'available');
  assert.equal(assessed.source, 'public');
  assert.equal(assessed.host, 'dl.736.de5.net');

  const current = appUpdate.assessUpdate({ ...publicRelease, versionCode: 91, versionName: '2.2.2' }, INSTALLED, { source: 'public', host: 'dl.736.de5.net' });
  assert.equal(current.state, 'current');
  assert.equal(appUpdate.absoluteApkUrl('http://192.168.0.115:8787', current.release.apkUrl), APK);
});

test('validateAppUpdate：接受白名单绝对 URL，拒绝任意绝对 URL', () => {
  const ok = appUpdate.validateAppUpdate({
    available: true, packageName: 'com.codex.turnloom.app', versionCode: 92, versionName: '2.2.3',
    apkUrl: APK, sha256: SHA, sizeBytes: 2238347, notes: '',
  });
  assert.equal(ok.ok, true);
  const bad = appUpdate.validateAppUpdate({
    available: true, packageName: 'com.codex.turnloom.app', versionCode: 92, versionName: '2.2.3',
    apkUrl: 'https://evil.com/turnloom/x.apk', sha256: SHA, sizeBytes: 2238347, notes: '',
  });
  assert.equal(bad.ok, false);
  const old = appUpdate.validateAppUpdate({
    available: true, packageName: 'com.codex.turnloom.app', versionCode: 92, versionName: '2.2.3',
    apkUrl: '/api/apk', sha256: SHA, sizeBytes: 2238347, notes: '',
  });
  assert.equal(old.ok, true);
});

test('absoluteApkUrl：公网绝对地址原样返回，/api/apk 才拼 origin', () => {
  assert.equal(appUpdate.absoluteApkUrl('http://192.168.0.115:8787', APK), APK);
  assert.equal(appUpdate.absoluteApkUrl('http://192.168.0.115:8787/', '/api/apk'), 'http://192.168.0.115:8787/api/apk');
  assert.equal(appUpdate.absoluteApkUrl('http://192.168.0.115:8787', 'https://evil.com/x.apk'), '');
  assert.equal(appUpdate.absoluteApkUrl('', '/api/apk'), '');
});

test('评估：包名不一致、清单版本不高于已装都不得提示更新', () => {
  const wrongPackage = appUpdate.validateAppUpdate({
    available: true, packageName: 'com.other.app', versionCode: 99, versionName: '9.9.9',
    apkUrl: '/api/apk', sha256: SHA, sizeBytes: 1, notes: '',
  });
  assert.equal(wrongPackage.ok, false);

  const release = appUpdate.validatePublicManifest(r2Manifest()).release;
  const same = appUpdate.assessUpdate(release, { versionCode: 92, packageName: 'com.codex.turnloom.app' });
  assert.equal(same.state, 'current');
});

/**
 * NB 在复核 2036fcb 时抓到的静默失败：download() 先要 context，未配对时点下载没反应。
 * 这条钉住"公网分支不需要配对、且不携带令牌"的实现形状（与 app-usability 的 U 系列同法）。
 */
test('未配对 + 公网 release：下载入口不得被 context 挡住，且不带机器令牌', () => {
  const src = fs.readFileSync(path.join(SRC, 'screens', 'SettingsScreen.tsx'), 'utf8');
  const body = src.slice(src.indexOf('const download = '), src.indexOf('const percent'));
  assert.match(body, /isPublicUpdateUrl\(release\.apkUrl\)/);
  assert.match(body, /if \(!isPublic && !context\)/);
  assert.match(body, /absoluteApkUrl\(context \? context\.target\.origin : ''/);
  assert.match(body, /token: isPublic \? '' :/);
});
