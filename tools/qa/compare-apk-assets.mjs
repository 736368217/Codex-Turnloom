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
  console.error('usage: node tools/qa/compare-apk-assets.mjs <apkA> <apkB> [--prefix assets/public] [--show <substring>] [--rewrite <from> <to>]...');
  process.exit(2);
}

const argv = process.argv.slice(2);
const positional = [];
let prefix = 'assets/public';
let show = '';
let rewrite = [];
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--prefix') prefix = argv[++i] ?? usage('--prefix needs a value');
  else if (arg === '--show') show = argv[++i] ?? usage('--show needs a value');
  else if (arg === '--version') {
    // Sugar for the one rewrite every release needs, written so it survives a shell that
    // eats double quotes (PowerShell 5.1 strips them out of native arguments, which turns
    // versionName:"2.4.3",versionCode:102 into versionName:2.4.3,versionCode:102 and
    // silently rewrites nothing). Both values are <value>:<code>, B's first.
    const parse = (spec) => {
      const m = /^(\d+\.\d+\.\d+):(\d+)$/.exec(spec ?? '');
      if (!m) usage(`--version wants <value>:<code> pairs, got "${spec}"`);
      return { ver: m[1], code: m[2] };
    };
    const from = parse(argv[++i]);
    const to = parse(argv[++i]);
    rewrite.push({
      from: `versionName:"${from.ver}",versionCode:${from.code}`,
      to: `versionName:"${to.ver}",versionCode:${to.code}`,
    });
  } else if (arg === '--rewrite') {
    // Two argv values, not one "from=to": a self-delimiting span such as
    // versionName:"2.4.3",versionCode:102 contains commas and colons itself.
    const from = argv[++i] ?? usage('--rewrite needs two values: <from> <to>');
    const to = argv[++i] ?? usage('--rewrite needs two values: <from> <to>');
    // A bare literal like 102 or 2.4.3 is not unique inside a bundle: `102` also
    // appears inside colour tokens (`0 102 214`) and `101i4y` icon keys. A blanket
    // replace there can manufacture agreement, so demand a self-delimiting span.
    if (from.length < 8) usage(`--rewrite source "${from}" is too short to be unambiguous; pass a self-delimiting span such as versionName:"2.4.3",versionCode:102`);
    rewrite.push({ from, to });
  } else if (arg.startsWith('--')) usage(`unknown option ${arg}`);
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
if (rewrite.length) console.log(`rewrite: ${rewrite.map((r) => `${r.from}->${r.to}`).join(', ')} (applied to B)`);
console.log(`identical: ${identical}`);
if (onlyA.length) console.log(`only in A (${onlyA.length}): ${onlyA.join(', ')}`);
if (onlyB.length) console.log(`only in B (${onlyB.length}): ${onlyB.join(', ')}`);
for (const diff of differing) {
  console.log(`differ: ${diff.rel}  A ${diff.sizeA}B ${diff.ha.slice(0, 12)}  B ${diff.sizeB}B ${diff.hb.slice(0, 12)}`);
}

// Condition "the product only moved its version": rewrite B's new literals back to the
// old ones and see whether the pair becomes byte-identical. Equal-length replacements
// keep the file size, which is why the size check in the caller's gate is meaningful.
const rewriteText = (bytesB) => {
  let text = bytesB.toString('utf8');
  const counts = [];
  for (const { from, to } of rewrite) {
    const hits = text.split(from).length - 1;
    counts.push(`${from.length > 40 ? `${from.slice(0, 40)}…` : from}×${hits}`);
    text = text.split(from).join(to);
  }
  return { bytes: Buffer.from(text, 'utf8'), counts };
};

const comparePair = (label, fullA, fullB) => {
  const bytesA = fs.readFileSync(fullA);
  const bytesB0 = fs.readFileSync(fullB);
  if (bytesA.equals(bytesB0)) {
    console.log(`${label}: byte identical (${bytesA.length}B)`);
    return 'identical';
  }
  if (!rewrite.length) {
    let at = 0;
    while (at < bytesA.length && at < bytesB0.length && bytesA[at] === bytesB0[at]) at += 1;
    console.log(`${label}: differs at byte ${at}, sizes ${bytesA.length}/${bytesB0.length}`);
    return 'differs';
  }
  const { bytes: bytesB, counts } = rewriteText(bytesB0);
  console.log(`${label}: rewrite ${counts.join(' ')}`);
  if (bytesA.equals(bytesB)) {
    console.log(`${label}: resolved by rewrite (${bytesA.length}B, sizes ${bytesA.length}/${bytesB0.length})`);
    return 'resolved';
  }
  let at = 0;
  while (at < bytesA.length && at < bytesB.length && bytesA[at] === bytesB[at]) at += 1;
  const window = (buf) => JSON.stringify(buf.subarray(Math.max(0, at - 40), at + 40).toString('utf8'));
  console.log(`${label}: rewrite leaves a difference at byte ${at} of ${bytesA.length}/${bytesB.length}`);
  console.log(`  A …${window(bytesA)}…`);
  console.log(`  B …${window(bytesB)}…`);
  return 'differs';
};

let resolvedByRewrite = 0;
for (const diff of differing) {
  const outcome = comparePair(`differ ${diff.rel}`, diff.fullA, diff.fullB);
  if (outcome === 'resolved') resolvedByRewrite += 1;
}

// A bump renames the hashed bundle, so the two bundles land in `only in A/B` and never
// reach the loop above. Pair them when exactly one file is left on each side in the same
// directory with the same extension — that is the rename case and its content still has
// to be certified, otherwise "the only difference is the version" would go unproven.
let renamed = null;
if (onlyA.length === 1 && onlyB.length === 1) {
  const a = onlyA[0];
  const b = onlyB[0];
  if (path.posix.dirname(a) === path.posix.dirname(b) && path.posix.extname(a) === path.posix.extname(b)) {
    renamed = { a, b };
    const outcome = comparePair(`renamed ${a} -> ${b}`, filesA.get(a), filesB.get(b));
    if (outcome === 'differs') renamed.bad = true;
  }
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

const renameOk = !renamed || !renamed.bad;
const clean = differing.length === 0 && onlyA.length === 0 && onlyB.length === 0;
const resolved = rewrite.length > 0
  && renameOk
  && resolvedByRewrite === differing.length
  && (differing.length + (renamed ? 1 : 0)) > 0;
if (clean) console.log('RESULT: identical asset trees');
else if (resolved) {
  console.log(`RESULT: differences are exactly the rewritten literals${renamed ? ` (paired ${renamed.a} -> ${renamed.b})` : ''}`);
} else if (!renameOk) console.log('RESULT: the renamed file still differs beyond the rewrites');
else console.log('RESULT: differences found');
process.exit(clean || resolved ? 0 : 1);
