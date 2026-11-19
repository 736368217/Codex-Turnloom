'use strict';

/**
 * 新建会话的项目选择：项目必须进幂等身份，否则「换项目重试」会命中上一次请求的 id。
 * 这里只测纯函数（`sendRequestIdentity`），请求体本身由 QA 夹具的 `sendsSeen`
 * 在端到端里记录（`projectId` / `newThread` / `clientRequestId`）。
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
const { sendRequestIdentity } = load('lib/chatContract.ts');

const base = { threadId: '', newThread: true, message: '新会话第一条消息', images: [], files: [] };

test('项目进身份：换项目就换 clientRequestId 的来源', () => {
  const withProject = sendRequestIdentity({ ...base, projectId: 'turnloom' });
  const otherProject = sendRequestIdentity({ ...base, projectId: 'pidesktop' });
  const noProject = sendRequestIdentity({ ...base, projectId: undefined });
  assert.notEqual(withProject, otherProject);
  assert.notEqual(withProject, noProject);
  assert.match(withProject, /"projectId":"turnloom"/);
  assert.match(noProject, /"projectId":""/);
});

test('同一输入重试必须保持同一身份', () => {
  assert.equal(
    sendRequestIdentity({ ...base, projectId: 'turnloom' }),
    sendRequestIdentity({ ...base, projectId: 'turnloom' }),
  );
});

test('新会话与已有会话的身份不同', () => {
  const fresh = sendRequestIdentity({ ...base, projectId: 'turnloom' });
  const existing = sendRequestIdentity({ ...base, threadId: 'qa-long', newThread: false, projectId: 'turnloom' });
  assert.notEqual(fresh, existing);
});
