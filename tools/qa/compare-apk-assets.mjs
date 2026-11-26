#!/usr/bin/env node
/**
 * Compare the web assets inside two APKs, byte for byte.
 *
 * Why: a gate can only say "the读数 I signed still applies to this product" if the
 * assets the WebView actually loads are the same bytes. R8 touches Java/Kotlin only —
 * `assets/public/` goes in verbatim — so a debug build and a release build of the same
 * `app/` tree differ in the version string at most. This script proves that instead of
 * assuming it.
 *
 *   node tools/qa/compare-apk-assets.mjs <apkA> <apkB> [--prefix assets/public] [--show <substring>]
 *
 * Exit code 0 = identical asset trees; 1 = differences (listed); 2 = usage error.
 * `--show` writes both copies of every matching file into a temp dir so they can be
 * diffed by eye; the paths are printed.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function usage(message) {
  if (message) console.error(`compare-apk-assets: ${message}`);
  console.error('usage: node tools/qa/compare-apk-assets.mjs <apkA> <apkB> [--prefix assets/public] [--show <substring>]');
  process.exit(2);
}

const argv = process.argv.slice(2);
const positional = [];
let prefix = 'assets/public';
let show = '';
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--prefix') prefix = argv[++i] ?? usage('--prefix needs a value');
  else if (arg === '--show') show = argv[++i] ?? usage('--show needs a value');
  else if (arg.startsWith('--')) usage(`unknown option ${arg}`);
  else positional.push(arg);
}
if (positional.length !== 2) usage('need exactly two APK paths');
for (const apk of positional) {
  if (!fs.existsSync(apk)) usage(`no such file: ${apk}`);
}

const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function extract(apk) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apk-assets-'));
  try {
    // bsdtar reads zip; Expand-Archive refuses the .apk extension.
    execFileSync('tar', ['-xf', path.resolve(apk), '-C', dir, prefix], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (error) {
    const detail = error?.stderr ? String(error.stderr).trim() : error?.message || String(error);
    usage(`could not read ${prefix} out of ${apk}: ${detail}`);
  }
  const root = path.join(dir, ...prefix.split('/'));
  if (!fs.existsSync(root)) usage(`${apk} has no ${prefix}`);
  return { dir, root };
}

function walk(root) {
  const out = new Map();
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) out.set(path.relative(root, full).split(path.sep).join('/'), full);
    }
  };
  visit(root);
  return out;
}

const a = extract(positional[0]);
const b = extract(positional[1]);
const filesA = walk(a.root);
const filesB = walk(b.root);

const onlyA = [...filesA.keys()].filter((key) => !filesB.has(key)).sort();
const onlyB = [...filesB.keys()].filter((key) => !filesA.has(key)).sort();
const differing = [];
let identical = 0;
for (const [rel, fullA] of [...filesA].sort((x, y) => x[0].localeCompare(y[0]))) {
  const fullB = filesB.get(rel);
  if (!fullB) continue;
  const ha = sha256(fullA);
  const hb = sha256(fullB);
  if (ha === hb) identical += 1;
  else differing.push({ rel, fullA, fullB, ha, hb, sizeA: fs.statSync(fullA).size, sizeB: fs.statSync(fullB).size });
}

const report = (label, apk) => console.log(`${label}: ${apk}`);
report('A', positional[0]);
report('B', positional[1]);
console.log(`prefix: ${prefix}`);
console.log(`identical: ${identical}`);
if (onlyA.length) console.log(`only in A (${onlyA.length}): ${onlyA.join(', ')}`);
if (onlyB.length) console.log(`only in B (${onlyB.length}): ${onlyB.join(', ')}`);
for (const diff of differing) {
  console.log(`differ: ${diff.rel}  A ${diff.sizeA}B ${diff.ha.slice(0, 12)}  B ${diff.sizeB}B ${diff.hb.slice(0, 12)}`);
}

if (show) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'apk-show-'));
  for (const [rel, fullA] of [...filesA].sort((x, y) => x[0].localeCompare(y[0]))) {
    if (!rel.includes(show)) continue;
    const target = path.join(out, rel.replaceAll('/', '_'));
    fs.copyFileSync(fullA, `${target}.A`);
    const fullB = filesB.get(rel);
    if (fullB) fs.copyFileSync(fullB, `${target}.B`);
    console.log(`show: ${rel} -> ${target}.A${fullB ? ' / .B' : ''}`);
  }
  console.log(`show dir: ${out}`);
}

const clean = differing.length === 0 && onlyA.length === 0 && onlyB.length === 0;
console.log(clean ? 'RESULT: identical asset trees' : 'RESULT: differences found');
process.exit(clean ? 0 : 1);
