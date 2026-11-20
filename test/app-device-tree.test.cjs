'use strict';
/**
 * 2.2.6 device tree + segmented control contracts.
 *
 * The visual/behavioural side is measured by tools/qa/check-redesign.mjs (Vera,
 * Rhea). These assertions only pin the source shape that the report and
 * UI_SPEC §4 made non-negotiable — the parts a refactor could quietly undo
 * while every screenshot still looks plausible.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../app/src');
const read = (file) => fs.readFileSync(path.resolve(root, file), 'utf8');

test('D1: data-machine lives on the platform block, never per computer or per row', () => {
  const devices = read('screens/DevicesScreen.tsx');
  assert.equal((devices.match(/data-machine=/g) || []).length, 1, 'exactly one data-machine binding');
  assert.match(devices, /className="tl-platblock" data-machine=\{machine\.id\}/);
  assert.doesNotMatch(devices, /className="tl-devgrid"[^>]*data-machine/);
  assert.doesNotMatch(devices, /data-harness=\{harness\.id\}[^>]*data-machine/);
});

test('D2: the current computer never collapses and a tap on it is a no-op', () => {
  const devices = read('screens/DevicesScreen.tsx');
  assert.match(devices, /const openMachine = activeId/);
  assert.doesNotMatch(devices, /setManualOpen/);
  assert.match(devices, /aria-expanded=\{active \? true : undefined\}/);
  // Clicking the active card returns before any state write.
  assert.match(devices, /if \(machine\.active \|\| busy\) return;/);
});

test('D3: a failed switch reports the store snapshot, not the render closure', () => {
  const devices = read('screens/DevicesScreen.tsx');
  // Machine switches use the device-page-only switchError; harness switches
  // still read the error the store set for that attempt.
  assert.match(devices, /session\.switchError/);
  assert.match(devices, /sessionStore\.getState\(\)\.switchError/);
  assert.match(devices, /sessionStore\.getState\(\)\.error/);
  assert.doesNotMatch(devices, /session\.error/, 'the closure value is stale after await switchMachine()');
});

test('D4: the page has both entry points that make machines[] usable', () => {
  const devices = read('screens/DevicesScreen.tsx');
  assert.match(devices, /openAddMachine\(\)/);
  assert.match(devices, /添加一台电脑/);
  assert.match(devices, /forgetMachine\(menuMachine\.id\)/);
  assert.match(devices, /忘记这台电脑/);
});

test('D5: add-machine is a full-screen route, not a second Konsta App inside AppShell', () => {
  const rootView = read('AppRoot.tsx');
  assert.match(rootView, /if \(usable && addMachine\)/);
  assert.match(rootView, /<ConnectScreen mode="add" onBack=\{leaveAddMachine\} onPaired=\{closeAddMachine\} \/>/);
  assert.doesNotMatch(read('screens/DevicesScreen.tsx'), /<ConnectScreen/);
  assert.doesNotMatch(read('components/AppShell.tsx'), /ConnectScreen/);
});

test('D6: one track + one thumb, 44px rail, 38px cells, hit band inside the rail', () => {
  const css = read('theme/globals.css');
  assert.match(css, /\.tl-segmented \{[^}]*height: 44px/s);
  assert.match(css, /\.tl-segmented \{[^}]*padding: 3px/s);
  assert.match(css, /\.tl-segmented \{[^}]*border-radius: 999px/s);
  assert.match(css, /\.tl-segmented-thumb \{[^}]*transition: transform 300ms/s);
  assert.match(css, /\.tl-segmented-item \{[^}]*min-width: 92px/s);
  assert.match(css, /\.tl-segmented-item \{[^}]*height: 38px/s);
  // 38 + 3 + 3 = 44: the band is exactly the rail, never 1px outside it.
  assert.match(css, /\.tl-segmented-item::before \{[^}]*inset: -3px 0/s);
  // Inactive cards scale .985; a 44px manage button would measure 43.34.
  assert.match(css, /\.tl-devcard-more \{[^}]*width: 46px/s);
});

test('D7: the legacy pill classes carry no background rule', () => {
  // Strip comments first: the contract comment above .tl-segmented names the
  // two legacy classes and would otherwise span into the next rule.
  const css = read('theme/globals.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /\.tl-filter-chip[^{}]*\{[^}]*background/s);
  assert.doesNotMatch(css, /\.tl-segmented-item\.is-active[^{}]*\{[^}]*background/s);
});

test('D8: add mode starts from blank credentials and hides the updater', () => {
  const screen = read('screens/ConnectScreen.tsx');
  // Prefilling the current machine's URL/token here would re-pair the old
  // computer or look like editing it (NB3 09:21).
  assert.match(screen, /useState\(adding \? '' : session\.serverUrl\)/);
  assert.match(screen, /useState\(adding \? '' : session\.machineToken\)/);
  // Scan-first stays the default even when adding (NB3 09:22): the QR is on the
  // other computer's screen. Only a camera-less device opens the form.
  assert.match(screen, /useState\(!session\.cameraAvailable\)/);
  assert.match(screen, /\{!adding && \(\s*<section className="tl-card tl-connect-card" aria-label="应用更新">/);
});

test('D9: a harness row name never repeats its platform label', () => {
  const devices = read('screens/DevicesScreen.tsx');
  // deploy/machine.example.json names PI's harness "PI-Desktop"; repeating it
  // under the PI-Desktop platform card reads like a second platform.
  assert.match(devices, /const rowName = harness\.name === platform\.label \? \(harness\.id \|\| harness\.name\) : harness\.name/);
  assert.match(devices, /<span className="tl-hrow-name">\{rowName\}<\/span>/);
});

test('D10: an inactive computer card has no separate「切换」label', () => {
  const devices = read('screens/DevicesScreen.tsx');
  const css = read('theme/globals.css').replace(/\/\*[\s\S]*?\*\//g, '');
  // The whole card is the switch target; a second label reads as another action.
  assert.doesNotMatch(devices, /tl-devcard-switch/);
  assert.doesNotMatch(css, /\.tl-devcard-switch\b/);
});

test('D11: the running strip owns a 44px slot around its 34px pill', () => {
  const css = read('theme/globals.css');
  assert.match(css, /\.tl-runstrip \{[^}]*padding-top: 5px/s);
  assert.match(css, /\.tl-runstrip-head \{[^}]*margin-bottom: 5px/s);
  assert.match(css, /\.tl-runstrip-head \{[^}]*min-height: 34px/s);
  // 5 (strip padding) + 34 (head) + 5 (head margin) = 44; the pseudo fills the
  // strip box and never reaches the segmented control or the first run row.
  assert.match(css, /\.tl-runstrip-head::before \{[^}]*inset: -5px 0/s);
});
