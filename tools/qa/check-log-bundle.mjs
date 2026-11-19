#!/usr/bin/env node
/**
 * 日志包脱敏与上传回归（Vera / #13）。
 *
 *   node tools/qa/check-log-bundle.mjs          # 起临时 server.js，跑完即杀
 *
 * 步骤：灌一条带唯一标记的诊断记录 → GET /api/admin/logs 取 zip → 解包扫描
 *      →（若本机有上传凭据）POST /api/admin/logs/upload → 用返回 key 公开 GET → 再扫一遍
 * 断言：标记与访问码在包内 0 命中；允许字段（code）仍在；上传回来的字节同样干净。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const port = Number(arg('port', '0')) || 8800 + Math.floor(Math.random() * 90);
const code = `qa-logs-${Math.random().toString(16).slice(2, 10)}`;
const canary = `QA-SECRET-${Math.random().toString(16).slice(2, 12)}`;
const work = mkdtempSync(path.join(os.tmpdir(), 'tl-logs-'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let child = null;
let exitCode = 0;
const fail = [];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function scan(dir, needles) {
  const files = walk(dir);
  const hits = [];
  for (const file of files) {
    const text = readFileSync(file, 'latin1');
    for (const needle of needles) {
      const index = text.indexOf(needle);
      if (index >= 0) hits.push(`${path.basename(file)}@${index} <- ${needle}`);
    }
  }
  return { files, hits };
}

try {
  const base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.js', '--port', String(port), '--password', code], {
    cwd: root, stdio: 'ignore', env: { ...process.env },
  });
  let ready = false;
  for (let i = 0; i < 60 && !ready; i += 1) {
    await sleep(500);
    try {
      const probe = await fetch(`${base}/api/health`, { headers: { 'x-access-token': code } });
      ready = probe.ok;
    } catch { /* booting */ }
  }
  if (!ready) throw new Error(`server did not answer on ${port}`);
  const headers = { 'x-access-token': code, 'content-type': 'application/json' };

  const diag = {
    machine: 'qa-machine',
    records: [{
      at: new Date().toISOString(), kind: 'send', phase: 'error', code: 'qa-canary-code', status: 0,
      message: `${canary}-message`, detail: { note: `${canary}-note`, stack: `${canary}-stack` },
    }],
  };
  const posted = await (await fetch(`${base}/api/diagnostics`, { method: 'POST', headers, body: JSON.stringify(diag) })).json();
  console.log(`diagnostics stored=${posted.stored} dropped=${posted.dropped} file=${posted.file}`);

  const zip = Buffer.from(await (await fetch(`${base}/api/admin/logs`, { headers })).arrayBuffer());
  const zipPath = path.join(work, 'logs.zip');
  writeFileSync(zipPath, zip);
  console.log(`zip bytes=${zip.length}`);

  const unpacked = path.join(work, 'unpacked');
  mkdirSync(unpacked);
  const untar = spawn('tar', ['-xf', zipPath, '-C', unpacked], { stdio: 'ignore' });
  await new Promise((resolve, reject) => { untar.on('exit', (code2) => (code2 === 0 ? resolve() : reject(new Error(`tar exit ${code2}`)))); });

  const inner = scan(unpacked, [canary, code]);
  console.log(`members: ${inner.files.map((file) => path.relative(unpacked, file)).join(', ')}`);
  if (inner.hits.length) fail.push(`包内泄漏: ${inner.hits.join(' | ')}`);
  else console.log('OK 包内没有标记、没有访问码');

  const kept = inner.files.filter((file) => readFileSync(file, 'latin1').includes('qa-canary-code'));
  if (kept.length) console.log(`OK 允许字段仍在（${kept.map((file) => path.basename(file)).join(', ')}）`);
  else fail.push('允许字段缺失：包内找不到 qa-canary-code（整行被丢？）');

  // 上传腿：凭据在时才跑（凭据属于 Human，脚本只让服务端自己读）
  const tokenFile = path.join(os.homedir(), 'Desktop', '认证', 'r2-upload-token.txt');
  if (!existsSync(tokenFile)) {
    console.log('SKIP 上传腿：本机没有 R2 上传凭据');
  } else {
    const upload = await (await fetch(`${base}/api/admin/logs/upload`, { method: 'POST', headers: { 'x-access-token': code } })).json();
    console.log(`upload: ${JSON.stringify(upload)}`);
    if (!upload?.ok) fail.push(`上传失败: ${JSON.stringify(upload)}`);
    else {
      const publicUrl = `https://dl.736.de5.net/${upload.key}`;
      const remote = Buffer.from(await (await fetch(publicUrl)).arrayBuffer());
      const remotePath = path.join(work, 'remote.zip');
      writeFileSync(remotePath, remote);
      const remoteDir = path.join(work, 'remote');
      mkdirSync(remoteDir);
      const untar2 = spawn('tar', ['-xf', remotePath, '-C', remoteDir], { stdio: 'ignore' });
      await new Promise((resolve, reject) => { untar2.on('exit', (code2) => (code2 === 0 ? resolve() : reject(new Error(`tar exit ${code2}`)))); });
      const remoteScan = scan(remoteDir, [canary, code]);
      console.log(`公开 GET ${publicUrl} → ${remote.length} B`);
      if (remoteScan.hits.length) fail.push(`上传回来的字节泄漏: ${remoteScan.hits.join(' | ')}`);
      else console.log('OK 上传回来的字节同样干净');
    }
  }
} catch (error) {
  fail.push(`执行失败: ${error.message}`);
} finally {
  if (child) { try { child.kill(); } catch { /* ignore */ } await sleep(300); }
}
if (fail.length) { fail.forEach((line) => console.log(`FAIL ${line}`)); exitCode = 1; }
else console.log('PASS 日志包脱敏（含上传腿）');
process.exit(exitCode);
