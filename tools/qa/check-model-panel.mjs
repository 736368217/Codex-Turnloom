#!/usr/bin/env node
/**
 * 模型面板对账：把 PI 的库当唯一真源，和 `/api/health.models`（也就是面板渲染的数据）逐条比。
 *
 *   node tools/qa/check-model-panel.mjs                # 起临时 server.js（PI 分支）
 *   node tools/qa/check-model-panel.mjs --url … --token …
 *
 * 期望集合 = providers.enabled=1（按 created_at 升序） × config_json.models（按数组顺序），
 * slug 记作 `<provider>/<modelId>`。多一条、少一条、顺序错，都算红。
 */
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const externalUrl = arg('url', '');
const hostUrl = arg('http', '');
const token = arg('token', 'qa-models');
const port = Number(arg('port', '0')) || 8800 + Math.floor(Math.random() * 90);
const root = path.resolve(import.meta.dirname, '..', '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function expectedFromPi() {
  const db = new DatabaseSync(path.join(os.homedir(), '.pi-desktop', 'pi.sqlite'), { readOnly: true });
  const providers = db.prepare('select name, enabled, config_json from providers where enabled = 1 order by created_at asc').all();
  const expected = [];
  for (const provider of providers) {
    let config = {};
    try { config = JSON.parse(provider.config_json || '{}'); } catch { config = {}; }
    const models = Array.isArray(config.models) ? config.models : [];
    for (const model of models) {
      const id = String(model?.id || model?.modelId || '').trim();
      if (!id) continue;
      expected.push(`${provider.name}/${id}`);
    }
  }
  return { expected, providers: providers.map((provider) => provider.name) };
}

function normalise(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    if (Array.isArray(row)) return { id: String(row[0] || ''), provider: String(row[1] || '') };
    return {
      id: String(row.id || row.modelId || ''),
      provider: String(row.provider || ''),
      label: String(row.label || ''),
      providerLabel: String(row.providerLabel || ''),
    };
  });
}

let child = null;
async function ensureServer() {
  if (externalUrl) return externalUrl;
  const base = `http://127.0.0.1:${port}`;
  const extra = hostUrl ? ['--backend', 'http', '--backend-url', hostUrl] : [];
  child = spawn(process.execPath, ['server.js', '--port', String(port), '--password', token, ...extra], {
    cwd: root,
    env: { ...process.env, CODEX_LAN_PI_NATIVE_QUEUE: '1' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i += 1) {
    await sleep(500);
    try {
      const response = await fetch(`${base}/api/health`, { headers: { 'x-access-token': token } });
      if (response.ok) return base;
    } catch { /* still booting */ }
  }
  throw new Error(`server did not answer on ${base} within 30s`);
}

let exitCode = 0;
try {
  // --http <host>：de 形态，期望值取宿主自己的 /health（不读 PI 库）。
  const { expected, providers } = hostUrl
    ? await (async () => {
      const hostRes = await (await fetch(hostUrl.replace(/\/$/, '') + '/health')).json();
      const rows = normalise(hostRes.models);
      return { expected: rows.map((row) => row.id), providers: [...new Set(rows.map((row) => row.provider))] };
    })()
    : expectedFromPi();
  const base = await ensureServer();
  const health = await (await fetch(`${base}/api/health`, { headers: { 'x-access-token': token } })).json();
  const models = normalise(health.models);
  // 接口的 id 已经是 `provider/model` 形式，别再拼一次前缀（我第一次就拼重了）。
  const actual = models.map((model) => model.id);

  console.log(`PI 启用供应商: ${providers.join(', ') || '(none)'}`);
  console.log(`PI 期望 ${expected.length} 条: ${expected.join(', ')}`);
  console.log(`接口返回 ${actual.length} 条: ${actual.join(', ')}`);

  const missing = expected.filter((slug) => !actual.includes(slug));
  const extra = actual.filter((slug) => !expected.includes(slug));
  if (missing.length) { console.log(`FAIL 少了: ${missing.join(', ')}`); exitCode = 1; }
  if (extra.length) { console.log(`FAIL 多了: ${extra.join(', ')}`); exitCode = 1; }
  if (!missing.length && !extra.length) {
    const sameOrder = expected.every((slug, index) => actual[index] === slug);
    console.log(sameOrder ? 'OK 集合与顺序都与 PI 一致' : `WARN 集合一致但顺序不同：期望 ${expected.join(' > ')}，实际 ${actual.join(' > ')}`);
    if (!sameOrder) exitCode = 1;
  }

  const defaultModel = String(health.defaultModel || '');
  if (defaultModel && !expected.includes(defaultModel) && !expected.some((slug) => slug.endsWith(`/${defaultModel}`))) {
    console.log(`FAIL 默认模型不在 PI 的已加入集合里: ${defaultModel}`);
    exitCode = 1;
  } else if (defaultModel) {
    console.log(`OK 默认模型 ${defaultModel} 在集合内`);
  }
  if (health.lastUsedModel) {
    // `lastUsedModel` 会变成新会话的默认模型，它必须在面板可选集合里——
    // 否则新会话的默认值是一个用户根本选不到的模型（2.2.4 上 Human 撞到的就是这类）。
    const lastUsed = String(health.lastUsedModel);
    if (expected.includes(lastUsed)) {
      console.log(`OK lastUsedModel ${lastUsed} 在集合内`);
    } else {
      console.log(`FAIL lastUsedModel ${lastUsed} 不在 PI 的已加入集合里（它会成为新会话默认模型）`);
      exitCode = 1;
    }
  } else {
    // 契约只保证「不指向集合外的模型」，不保证非空——为空是合法的回落起点。
    console.log('OK lastUsedModel 为空（合法：会回落 defaultModel）');
  }
} catch (error) {
  console.error(`check-model-panel failed: ${error.message}`);
  exitCode = 1;
} finally {
  if (child) { try { child.kill(); } catch { /* ignore */ } await sleep(300); }
}
process.exit(exitCode);

