'use strict';

/**
 * 公网更新通道（2.2.3，task:f10ba9e9）的回归口径。
 *
 * 这里的负例**不依赖实现形状**：无论白名单写成 host 相等、path 前缀还是正则，
 * 下面这些 URL 都必须被 `isAllowedApiUrl` 拒绝。它们挡的不是"忘了放行"，
 * 而是"放行放宽了"——`endsWith('dl.736.de5.net')` / `includes(...)` 这类写法会把
 * `dl.736.de5.net.evil.com` 一起放进去。
 *
 * 正例（真放行 `https://dl.736.de5.net/turnloom/*`）等 Atlas 的第一版落地再启用，
 * 避免我先编一个他不得不迁就的形状。
 *
 * 注意：https / 端口这两条**目前是靠旧的 `/api/` 前缀规则顺带通过的**，
 * 等 `/turnloom/` 被真正放进来，它们才开始承担拦截作用。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'src');

/** 与 test/app-chat-contract.test.cjs 相同的 TS 直执行加载器（无构建步骤）。 */
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
const bridge = load('lib/nativeBridge.ts');
const { isAllowedApiUrl } = bridge;

const PUBLIC_MANIFEST = 'https://dl.736.de5.net/turnloom/latest.json';
const PUBLIC_APK = 'https://dl.736.de5.net/turnloom/Codex-Turnloom-2.2.3.apk';

test('公网地址：同后缀伪装域名必须拒绝', () => {
  // 扩白名单最容易踩的写法是 endsWith / includes，这条就是拦它的。
  assert.equal(isAllowedApiUrl('https://dl.736.de5.net.evil.com/turnloom/latest.json'), false);
  assert.equal(isAllowedApiUrl('https://evil-dl.736.de5.net/turnloom/latest.json'), false);
  assert.equal(isAllowedApiUrl('https://evil.com/dl.736.de5.net/turnloom/latest.json'), false);
  assert.equal(isAllowedApiUrl('https://evil.com/?u=https://dl.736.de5.net/turnloom/latest.json'), false);
});

test('公网地址：userinfo 与端口伪装必须拒绝', () => {
  assert.equal(isAllowedApiUrl('https://dl.736.de5.net@evil.com/turnloom/latest.json'), false);
  assert.equal(isAllowedApiUrl('https://user:pass@dl.736.de5.net/turnloom/latest.json'), false);
  // 同一 host 的非 443 端口是另一个服务，不能当公网更新源。
  assert.equal(isAllowedApiUrl('https://dl.736.de5.net:8443/turnloom/latest.json'), false);
});

test('公网地址：协议必须是 https（清单本身携带 sha，走明文等于整链可替换）', () => {
  assert.equal(isAllowedApiUrl('http://dl.736.de5.net/turnloom/latest.json'), false);
  assert.equal(isAllowedApiUrl('ftp://dl.736.de5.net/turnloom/latest.json'), false);
  assert.equal(isAllowedApiUrl('file:///android_asset/public/index.html'), false);
});

test('公网地址：路径穿越、片段与非绝对地址必须拒绝', () => {
  assert.equal(isAllowedApiUrl('https://dl.736.de5.net/turnloom/../latest.json'), false);
  assert.equal(isAllowedApiUrl('https://dl.736.de5.net/turnloom\\latest.json'), false);
  assert.equal(isAllowedApiUrl(`${PUBLIC_MANIFEST}#frag`), false);
  assert.equal(isAllowedApiUrl('turnloom/latest.json'), false);
  assert.equal(isAllowedApiUrl(''), false);
});

test('回归：电脑端既有 API 地址不受本次改动影响', () => {
  // 配对机器的 origin 是任意的（局域网 IP、隧道域名），这条今天成立、改完也必须成立。
  assert.equal(isAllowedApiUrl('http://192.168.50.42:8787/api/app/update'), true);
  assert.equal(isAllowedApiUrl('https://tl.z736.cc.cd/api/app/update-public'), true);
});

test('公网地址：清单与 APK 两个绝对地址必须放行', { skip: '待 Atlas 落地 isAllowedApiUrl 公网白名单后启用' }, () => {
  assert.equal(isAllowedApiUrl(PUBLIC_MANIFEST), true);
  assert.equal(isAllowedApiUrl(PUBLIC_APK), true);
});

/**
 * NB 第 5 条：白名单拒绝必须有自己的原因，不能落成 `status 0 / offline`。
 * `isPublicUpdateUrl` 一旦导出，下面这组自动生效（不需要谁来记得取消 skip）。
 * 传输层那条（`nativeHttpRequest` 对白名单外地址不得返回 offline）等 Atlas 定下
 * 返回形状我再补——不先编一个他得迁就的结构。
 */
const hasPublicUrlCheck = typeof bridge.isPublicUpdateUrl === 'function';
test('公网判定：isPublicUpdateUrl 只认 R2 的清单与 APK', { skip: hasPublicUrlCheck ? false : '待 Atlas 导出 isPublicUpdateUrl' }, () => {
  assert.equal(bridge.isPublicUpdateUrl(PUBLIC_MANIFEST), true);
  assert.equal(bridge.isPublicUpdateUrl(PUBLIC_APK), true);
  assert.equal(bridge.isPublicUpdateUrl('https://dl.736.de5.net.evil.com/turnloom/latest.json'), false);
  assert.equal(bridge.isPublicUpdateUrl('https://dl.736.de5.net@evil.com/turnloom/latest.json'), false);
  assert.equal(bridge.isPublicUpdateUrl('http://dl.736.de5.net/turnloom/latest.json'), false);
  // 电脑端的相对路径不是公网地址，别把两者混成一个判断。
  assert.equal(bridge.isPublicUpdateUrl('/api/apk'), false);
  assert.equal(bridge.isPublicUpdateUrl('/api/app/update'), false);
});
