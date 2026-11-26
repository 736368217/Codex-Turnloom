"use strict";

/**
 * The submit button under the soft keyboard (QA 2026-11-26, defect 4 / gate ④).
 *
 * Measured on the emulator before the fix: at 390dp the keyboard leaves a 517 px
 * band and 「验证并连接」(477..527) stuck out under it; at 320dp the band is
 * 293 px and the button (371..421) was entirely below the fold. The screen only
 * ran one `scrollIntoView` when the manual form opened — before the keyboard
 * animation — so nothing ever brought the button back.
 *
 * The rule locked here is the pure part: how far to scroll, and what "visible
 * bottom" means. The wiring assertions below keep the screen calling it on focus
 * and on every viewport change, and keep the slack class tied to the viewport.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');

function load(file) {
  const source = path.resolve(__dirname, '../app/src', file);
  const mod = { exports: {} };
  const typed = stripTypeScriptTypes(fs.readFileSync(source, 'utf8'));
  const names = [...typed.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g)].map(m => m[1]);
  const js = typed
    .replace(/export\s+interface\s+\w+\s*\{[\s\S]*?\n\}/g, '')
    .replace(/export\s+type\s+[\s\S]*?;/g, '')
    .replace(/\bexport\s+/g, '');
  new Function('module', 'exports', `${js}\n${names.map(name => `exports.${name} = ${name};`).join('\n')}`)(mod, mod.exports);
  return mod.exports;
}

const { revealOffset, needsReveal, visibleBottomOf, REVEAL_MARGIN } = load('lib/keyboardReveal.ts');
const screen = fs.readFileSync(path.resolve(__dirname, '../app/src/screens/ConnectScreen.tsx'), 'utf8');
const css = fs.readFileSync(path.resolve(__dirname, '../app/src/theme/globals.css'), 'utf8');

test('a clear button does not move the page', () => {
  // 390dp, keyboard up: band bottom 517, button 430..480.
  assert.equal(revealOffset({ top: 430, bottom: 480 }, 517), 0);
  assert.equal(needsReveal({ top: 430, bottom: 480 }, 517), false);
  // Exactly at the margin is still clear — no jitter on every focus.
  assert.equal(revealOffset({ top: 400, bottom: 517 - REVEAL_MARGIN }, 517), 0);
});

test('a button under the keyboard scrolls up by exactly the overlap', () => {
  // The two measured QA cases.
  assert.equal(revealOffset({ top: 477, bottom: 527 }, 517), 527 - (517 - REVEAL_MARGIN)); // 22
  assert.equal(revealOffset({ top: 371, bottom: 421 }, 293), 421 - (293 - REVEAL_MARGIN)); // 140
  assert.equal(needsReveal({ top: 371, bottom: 421 }, 293), true);
});

test('an unknown viewport never scrolls the page', () => {
  assert.equal(revealOffset({ top: 0, bottom: 900 }, Number.NaN), 0);
  assert.equal(revealOffset({ top: 0, bottom: 900 }, Number.POSITIVE_INFINITY), 0);
});

test('the visible bottom follows visualViewport, and falls back to innerHeight', () => {
  assert.equal(visibleBottomOf({ visualViewport: { height: 517, offsetTop: 0 }, innerHeight: 796 }), 517);
  assert.equal(visibleBottomOf({ visualViewport: { height: 400, offsetTop: 40 }, innerHeight: 796 }), 440);
  assert.equal(visibleBottomOf({ visualViewport: null, innerHeight: 796 }), 796);
  assert.equal(visibleBottomOf({ visualViewport: { height: 0, offsetTop: 0 }, innerHeight: 552 }), 552);
});

test('the screen reveals the button on focus and on every viewport change', () => {
  // Focus is the first moment we know a keyboard is coming.
  assert.equal((screen.match(/onFocus=\{focusField\}/g) || []).length, 2, 'both fields must ask for the reveal');
  assert.match(screen, /ref=\{submitButton\}/);
  assert.match(screen, /box\.scrollBy\(\{ top: offset, behavior \}\)/);
  // The keyboard shrinks the layout viewport; both viewports are observed.
  assert.match(screen, /window\.addEventListener\('resize', measure\)/);
  assert.match(screen, /window\.visualViewport\?\.addEventListener\('resize', measure\)/);
  // Slack exists only while the keyboard is up, and it is the same class the CSS styles.
  assert.match(screen, /keyboardUp \? ' is-editing' : ''/);
  assert.match(screen, /setKeyboardUp\(shrunk && focused\)/);
  assert.match(css, /\.tl-connect-scroll\.is-editing \{ padding-bottom: calc\(120px \+ env\(safe-area-inset-bottom, 0px\)\); \}/);
});
