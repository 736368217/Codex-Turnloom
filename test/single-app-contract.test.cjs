'use strict';

/**
 * 单线 App 合同回归测试（ROUTE=dom-shell）。
 *
 * 可独立运行：node --test test/single-app-contract.test.cjs
 *
 * 唯一真源：docs/option-a/SINGLE_APP_CONTRACT.md
 * 本测试只做「静态契约钉住」：合同措辞、关键文件存在、依赖、无旧 /threads 字面量、
 * 原生容器入口/桥/返回栈、清单权限、构建脚本存在。
 *
 * 注意：app/ 与 native-shell/ 由并行会话稍后落地；此刻缺文件导致的失败是预期的，
 * 断言绝不因缺文件而放宽（不放宽、不跳过、不 try 吞异常，用清晰 assert 消息失败）。
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const CONTRACT_REL = 'docs/option-a/SINGLE_APP_CONTRACT.md';

// 合同第 1 / 9 节列出的 app/ 关键文件（唯一维护的 App UI）。
const REQUIRED_APP_FILES = [
  'app/package.json',
  'app/index.html',
  'app/src/main.tsx',
  'app/src/AppRoot.tsx',
  'app/src/theme/optionATokens.ts',
  'app/src/lib/turnloomApi.ts',
  'app/src/lib/nativeBridge.ts',
  'app/src/components/AppShell.tsx',
];

const MAIN_ACTIVITY_REL =
  'native-shell/app/src/main/java/com/codex/turnloom/app/MainActivity.java';

const MANIFEST_PRIMARY_REL = 'native-shell/app/src/main/AndroidManifest.xml';

const BUILD_SCRIPTS = [
  'scripts/build-single-app.ps1',
  'scripts/verify-single-app.mjs',
];

function abs(rel) {
  return path.join(ROOT, rel);
}

function assertExists(rel) {
  assert.ok(
    fs.existsSync(abs(rel)),
    `[ROUTE=dom-shell] 缺少必需文件：${rel}（应为唯一交付线的组成部分，请确认对应子会话已落地；本断言不放宽）`,
  );
}

/** 读取文本：先断言存在，再读；读取失败也转成清晰 assert 失败，不抛未捕获异常。 */
function readText(rel) {
  assertExists(rel);
  try {
    return fs.readFileSync(abs(rel), 'utf8');
  } catch (err) {
    assert.fail(`[ROUTE=dom-shell] 无法读取文件 ${rel}：${err && err.message ? err.message : String(err)}`);
  }
  return '';
}

function readJson(rel) {
  const text = readText(rel);
  try {
    return JSON.parse(text);
  } catch (err) {
    assert.fail(`[ROUTE=dom-shell] ${rel} 不是合法 JSON：${err && err.message ? err.message : String(err)}`);
  }
  return {};
}

/** 递归收集源码文件，跳过构建/依赖目录。任何读取异常都被吞掉并跳过，不抛未捕获异常。 */
function collectSourceFiles(dirRel) {
  const out = [];
  const skipDirs = new Set([
    'node_modules', 'dist', 'build', 'out', 'coverage', '.git', '.vite', '.gradle',
  ]);
  const srcExt = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.html', '.json']);
  const skipFiles = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml']);

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_err) {
      return; // 目录不可读则跳过，避免未捕获异常
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) walk(full);
      } else if (entry.isFile()) {
        if (skipFiles.has(entry.name)) continue;
        if (srcExt.has(path.extname(entry.name).toLowerCase())) out.push(full);
      }
    }
  }
  walk(abs(dirRel));
  return out;
}

/**
 * 旧 API 字面量检测：源码里出现「引号紧接 /threads」视为旧 `'/threads'` 五元组字面量。
 * `/api/threads` 合法：引号后是 `/api`，不会被本正则命中。
 * 命中 `'/threads'`、`"/threads/:id/messages"`、`` `/threads/${id}/changes` `` 等。
 */
const LEGACY_THREADS_LINE_RE = /(['"`])(\/threads[^'"`\r\n]*)/;

describe('single-app-contract (ROUTE=dom-shell)', () => {
  test('合同声明 ROUTE=dom-shell', () => {
    const contract = readText(CONTRACT_REL);
    assert.ok(
      contract.includes('ROUTE=dom-shell'),
      `[ROUTE=dom-shell] ${CONTRACT_REL} 必须包含字面量 ROUTE=dom-shell（唯一决策真源）`,
    );
  });

  test('app/ 关键文件存在（合同第 1 / 9 节）', () => {
    for (const rel of REQUIRED_APP_FILES) {
      assertExists(rel);
    }
  });

  test('app/package.json 依赖含 konsta 与 vaul', () => {
    const pkg = readJson('app/package.json');
    const declared = Object.assign(
      {},
      pkg.dependencies || {},
      pkg.devDependencies || {},
      pkg.peerDependencies || {},
    );
    for (const dep of ['konsta', 'vaul']) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(declared, dep),
        `[ROUTE=dom-shell] app/package.json 必须声明依赖 ${dep}（React + Konsta UI + Vaul 单线）`,
      );
    }
  });

  test('app 源码不含旧 /threads 字面量（须带 /api 前缀）', () => {
    assertExists('app'); // 目录缺失也要用清晰 assert 失败，而非 readdir 抛异常
    const files = collectSourceFiles('app');
    const violations = [];
    for (const file of files) {
      let content;
      try {
        content = fs.readFileSync(file, 'utf8');
      } catch (_err) {
        continue; // 单个文件读不了就跳过，不抛未捕获异常
      }
      const lines = content.split(/\r?\n/);
      lines.forEach((line, idx) => {
        const m = line.match(LEGACY_THREADS_LINE_RE);
        if (m) {
          violations.push(
            `${path.relative(ROOT, file)}:${idx + 1} -> ${m[2].slice(0, 80)}`,
          );
        }
      });
    }
    assert.equal(
      violations.length,
      0,
      `[ROUTE=dom-shell] app/ 源码禁止出现不带 /api 前缀的 '/threads' 五元组字面量；` +
        `统一使用 /api/*（合同第 3 / 8 节）。命中：\n  ${violations.join('\n  ')}`,
    );
  });

  test('MainActivity.java 含本地入口 / 桥 / 返回栈且不含 goBack()', () => {
    const java = readText(MAIN_ACTIVITY_REL);
    const required = [
      'file:///android_asset/public/index.html',
      'TurnloomNative',
      'moveTaskToBack',
      'evaluateJavascript',
    ];
    for (const token of required) {
      assert.ok(
        java.includes(token),
        `[ROUTE=dom-shell] ${MAIN_ACTIVITY_REL} 必须包含 ${token}（离线本地入口 / 原生桥 / 系统返回栈，合同第 6 节）`,
      );
    }
    assert.ok(
      !java.includes('goBack()'),
      `[ROUTE=dom-shell] ${MAIN_ACTIVITY_REL} 禁止 goBack()：返回键须走 window.__turnloomBack() + moveTaskToBack(true)，禁止 WebView.goBack()（合同第 6 节）`,
    );
  });

  test('AndroidManifest.xml 含包名 / 网络安全配置 / 权限', () => {
    // 主路径优先；若并行会话采用其它布局，则在 native-shell/ 内递归查找真实的 manifest。
    let manifestRel = null;
    if (fs.existsSync(abs(MANIFEST_PRIMARY_REL))) {
      manifestRel = MANIFEST_PRIMARY_REL;
    } else {
      const candidates = collectSourceFiles('native-shell').filter(
        (f) => path.basename(f) === 'AndroidManifest.xml',
      );
      if (candidates.length > 0) manifestRel = path.relative(ROOT, candidates[0]);
    }
    assert.ok(
      manifestRel,
      `[ROUTE=dom-shell] 未找到 native-shell/ 下的 AndroidManifest.xml（预期至少 ${MANIFEST_PRIMARY_REL}；本断言不放宽）`,
    );
    const manifest = readText(manifestRel);
    for (const token of [
      'com.codex.turnloom.app',
      'networkSecurityConfig',
      'CAMERA',
      'VIBRATE',
    ]) {
      assert.ok(
        manifest.includes(token),
        `[ROUTE=dom-shell] ${manifestRel} 必须包含 ${token}（applicationId / network_security_config / CAMERA / VIBRATE，合同第 2 / 6 节）`,
      );
    }
  });

  test('构建与静态验收脚本存在', () => {
    for (const rel of BUILD_SCRIPTS) {
      assertExists(rel);
    }
  });
});
