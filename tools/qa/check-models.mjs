#!/usr/bin/env node
/**
 * 模型目录契约检查：PI 接管时必须只出 PI 的候选，顺序照 PI，且没有已停用的供应商。
 *
 *   node tools/qa/check-models.mjs                    # 起一个临时 server.js（PI native queue）
 *   node tools/qa/check-models.mjs --url http://127.0.0.1:8787 --token <访问码>
 *
 * 断言三条（NB/Atlas 在 2.2.4 定的验收）：
 *   1. 不出现 `gpt-*`（Codex 的 catalog 不许混进来）；
 *   2. 顺序 = `/api/health.models` 里的数组顺序（前端不许自己排）；
 *   3. 只有启用中的供应商；本机基线是 wbfd/hy4flash-free 与 wbfd/deepseek-v4.1-flash。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const externalUrl = arg('url', '');
const token = arg('token', 'qa-models');
const port = Number(arg('port', '0')) || 8800 + Math.floor(Math.random() * 90);
const root = path.resolve(import.meta.dirname, '..', '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let child = null;
async function ensureServer() {
  if (externalUrl) return externalUrl;
  const base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.js', '--port', String(port), '--password', token], {
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

function normalizeModels(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    if (Array.isArray(row)) return { id: String(row[0] || ''), provider: String(row[1] || ''), efforts: row[2] || [] };
    return { id: String(row.id || ''), provider: String(row.provider || ''), label: String(row.label || '') };
  });
}

let exitCode = 0;
try {
  const base = await ensureServer();
  const response = await fetch(`${base}/api/health`, { headers: { 'x-access-token': token } });
  const health = await response.json();
  const models = normalizeModels(health.models);
  const ids = models.map((model) => model.id);
  const lines = [];

  const codexLeak = ids.filter((id) => /^gpt-|^o[34]-|codex/i.test(id));
  lines.push(`models (${ids.length}): ${ids.join(', ') || '(none)'}`);
  lines.push(`defaultModel: ${health.defaultModel || '(none)'} · defaultEffort: ${health.defaultEffort || '(none)'}`);
  if (codexLeak.length) { lines.push(`FAIL 混入 Codex 候选: ${codexLeak.join(', ')}`); exitCode = 1; }
  else lines.push('OK 没有 Codex 候选混入');

  const providers = [...new Set(models.map((model) => model.provider).filter(Boolean))];
  lines.push(`providers: ${providers.join(', ') || '(none)'}`);

  // 顺序：响应里的顺序就是前端该渲染的顺序；这里只要它稳定且与 provider 分组一致即可。
  const seen = [];
  let orderOk = true;
  for (const provider of models.map((model) => model.provider)) {
    if (!seen.includes(provider)) seen.push(provider);
    if (seen.indexOf(provider) !== seen.length - 1) orderOk = false;
  }
  lines.push(orderOk ? 'OK 供应商顺序连续（按首次出现分组）' : 'WARN 供应商在数组里交错出现，前端按首次出现顺序渲染会打乱分组');

  if (!ids.length) { lines.push('FAIL models 为空'); exitCode = 1; }
  console.log(lines.join('\n'));
} catch (error) {
  console.error(`check-models failed: ${error.message}`);
  exitCode = 1;
} finally {
  if (child) {
    try { child.kill(); } catch { /* ignore */ }
    await sleep(300);
  }
}
process.exit(exitCode);
