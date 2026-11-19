'use strict';
/**
 * Entry-level wiring: whoever calls openSheet() must be rendered underneath a
 * CupertinoSheetHost.
 *
 * 2.2.4 shipped this exact defect: the unpaired connect screen's 「查看并安装」
 * called openSheet('update'), but that screen renders its own Konsta <App>
 * outside AppShell — the only place a host was mounted. Tapping it changed
 * state and rendered nothing (Rhea, emulator-5554, 2026-11-19). Every unit test
 * stayed green because each half was correct on its own.
 *
 * The check is structural on purpose: it follows the real import graph, so a
 * new screen mounted outside the shell is caught without anyone remembering to
 * register it. The pixel-level half lives in tools/qa/check-connect-update.mjs
 * (real bundle, real click, asserts a sheet appears).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../app/src');
const read = (file) => fs.readFileSync(path.resolve(root, file), 'utf8');

const ENTRY = 'main.tsx';
const SHELL = 'components/AppShell.tsx';
const HOST_TAG = '<CupertinoSheetHost';

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function sources() {
  const files = new Map();
  for (const full of walk(root)) {
    const rel = path.relative(root, full).replaceAll('\\', '/');
    files.set(rel, fs.readFileSync(full, 'utf8'));
  }
  return files;
}

/** Resolve one relative import against the files that actually exist. */
function resolveImport(files, fromRel, spec) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (files.has(candidate)) return candidate;
  }
  return null;
}

const IMPORT_RE = /(?:from\s+|import\s*\(\s*)['"](\.[^'"]+)['"]/g;

function importsOf(source) {
  return [...source.matchAll(IMPORT_RE)].map((match) => match[1]);
}

/** Every module the app actually mounts from one entry — the reachable set. */
function reachable(files, start) {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const rel = queue.shift();
    const source = files.get(rel) || '';
    for (const spec of importsOf(source)) {
      const target = resolveImport(files, rel, spec);
      if (target && !seen.has(target)) { seen.add(target); queue.push(target); }
    }
  }
  return seen;
}

/** Real call sites only: openSheet('update') — not the definition in sheetStore. */
const CALL_RE = /\bopenSheet\(\s*['"]/;

function violations(files) {
  const shell = reachable(files, SHELL);
  const live = reachable(files, ENTRY);
  return [...files.entries()]
    .filter(([, source]) => CALL_RE.test(source))
    // Dead modules cannot put a sheet on screen; they are a separate cleanup.
    .filter(([rel]) => live.has(rel))
    .filter(([rel, source]) => !shell.has(rel) && !source.includes(HOST_TAG))
    .map(([rel]) => rel)
    .sort();
}

test('E1: every openSheet() caller outside AppShell mounts its own sheet host', () => {
  const files = sources();
  assert.deepEqual(violations(files), [],
    'a screen calls openSheet() but is not under AppShell and has no <CupertinoSheetHost /> — ' +
    'the sheet state changes and nothing renders');
});

test('E2: the unpaired entry is exactly the case that needs its own host', () => {
  const files = sources();
  assert.ok(!reachable(files, SHELL).has('screens/ConnectScreen.tsx'),
    'ConnectScreen must stay outside AppShell — if it moves inside, this test no longer proves anything');
  const root7 = read('AppRoot.tsx');
  assert.match(root7, /return <ConnectScreen onRevalidate=\{retrySaved\} \/>/);
  const screen = read('screens/ConnectScreen.tsx');
  assert.match(screen, /<CupertinoSheetHost \/>/);
  // The wiring itself: the available state renders the CTA that opens the sheet.
  assert.match(screen, /updateCheck === 'available'[\s\S]{0,200}openSheet\('update'\)/);
  assert.match(screen, /查看并安装/);
});

test('E3: the update sheet key actually renders the update panel', () => {
  const host = read('components/CupertinoSheetHost.tsx');
  assert.match(host, /case 'update': return <UpdatePanel \/>/);
  assert.match(host, /update: '应用更新'/);
});

test('E4: the checker is sensitive to the exact 2.2.4 defect', () => {
  // A synthetic pre-fix screen: calls openSheet, mounted outside the shell, no host.
  const files = new Map([
    [ENTRY, "import AppRoot from './AppRoot';\n<AppRoot />"],
    ['AppRoot.tsx', "import LegacyConnect from './screens/LegacyConnect';\nreturn <LegacyConnect />"],
    [SHELL, "import CupertinoSheetHost from './CupertinoSheetHost';\n<CupertinoSheetHost />"],
    ['screens/LegacyConnect.tsx', "import { openSheet } from '../state/sheetStore';\n" +
      "<button onClick={() => openSheet('update')}>查看并安装</button>"],
  ]);
  assert.deepEqual(violations(files), ['screens/LegacyConnect.tsx']);

  // …and adding the host clears it, so the rule is not "always red".
  files.set('screens/LegacyConnect.tsx',
    "import CupertinoSheetHost from '../components/CupertinoSheetHost';\n" +
    "import { openSheet } from '../state/sheetStore';\n" +
    "<button onClick={() => openSheet('update')}>查看并安装</button>\n<CupertinoSheetHost />");
  assert.deepEqual(violations(files), []);
});
