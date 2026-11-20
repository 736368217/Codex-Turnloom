#!/usr/bin/env node
/**
 * Generate one image through the susu.wiki OpenAI-compatible channel.
 *
 *   $env:SUSU_API_KEY = '<key>'          # never commit it; kept outside the repo
 *   node scripts/gen-image.mjs --prompt "..." --out tmp/hero.png [--size 1024x1024] [--model image2.6]
 *
 * Design notes:
 * - The key travels in an env var, never in argv (argv lands in shell history).
 * - Base URL and model are overridable so a channel move does not need a code change.
 * - Response shape: `{data:[{b64_json|url}]}`; both are handled.
 */
import fs from 'node:fs';
import path from 'node:path';

const argOf = (name, fallback = '') => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : String(process.argv[i + 1] ?? fallback);
};

const key = process.env.SUSU_API_KEY || '';
const base = (process.env.SUSU_BASE_URL || 'https://susu.wiki/v1').replace(/\/+$/, '');
const model = argOf('model', process.env.SUSU_MODEL || 'gpt-image-2.6-flare');
const prompt = argOf('prompt');
const out = argOf('out');
const size = argOf('size', '1024x1024');

if (!key) { console.error('SUSU_API_KEY is not set (keep it in the env, never in the repo)'); process.exit(2); }
if (!prompt || !out) { console.error('usage: node scripts/gen-image.mjs --prompt "..." --out <file.png> [--size 1024x1024] [--model image2.6]'); process.exit(2); }

const response = await fetch(`${base}/images/generations`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
  body: JSON.stringify({ model, prompt, n: 1, size }),
});

const text = await response.text();
if (!response.ok) {
  // The channel answers 401 with a human-readable reason; surface it verbatim, it is the whole diagnosis.
  console.error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
  process.exit(1);
}

let payload;
try { payload = JSON.parse(text); } catch { console.error(`not JSON: ${text.slice(0, 300)}`); process.exit(1); }
const first = payload?.data?.[0] || {};
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });

if (first.b64_json) {
  fs.writeFileSync(path.resolve(out), Buffer.from(first.b64_json, 'base64'));
} else if (first.url) {
  const image = await fetch(first.url);
  if (!image.ok) { console.error(`download failed: HTTP ${image.status}`); process.exit(1); }
  fs.writeFileSync(path.resolve(out), Buffer.from(await image.arrayBuffer()));
} else {
  console.error(`unexpected payload: ${text.slice(0, 300)}`);
  process.exit(1);
}

const bytes = fs.statSync(path.resolve(out)).size;
console.log(`ok ${out} ${bytes} B · model=${model} · size=${size}`);
