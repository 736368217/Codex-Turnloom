'use strict';
/**
 * 2.2.8 layout contracts: the connection hero and the slimmer fixed header.
 *
 * Both are visual, but their failure modes are structural: a logo tile coming
 * back, a hero that pushes the scan button below the 320x568 fold, a 28px row
 * whose hit band grows into the "+" button or the segmented control. These pin
 * the shape; the rendered geometry is measured by tools/qa/check-redesign.mjs.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../app/src');
const read = (file) => fs.readFileSync(path.resolve(root, file), 'utf8');

test('L1: the connect screen uses the 2x hero, centred, no logo tile', () => {
  const screen = read('screens/ConnectScreen.tsx');
  assert.match(screen, /import connectHero from '\.\.\/assets\/art\/connect-hero\.png'/);
  assert.match(screen, /className="tl-connect-hero"/);
  assert.match(screen, /<img src=\{connectHero\}/);
  assert.doesNotMatch(screen, /tl-brand/);
  const css = read('theme/globals.css');
  assert.match(css, /\.tl-connect-hero img \{[^}]*width: 334\.5px;[^}]*max-width: 100%;[^}]*height: auto;/s);
  assert.match(css, /\.tl-connect-hero \{[^}]*radial-gradient\(ellipse 60% 60% at 50% 45%/s);
  // Below 540px the hero is the first thing to go, protecting the fold.
  assert.match(css, /\.tl-connect-hero \{ display: none; \}/);
});

test('L2: the device row draws 28px and keeps a 44px band inside the header', () => {
  const css = read('theme/globals.css');
  assert.match(css, /\.tl-current-device \{[^}]*height: 28px;[^}]*min-height: 28px;/s);
  // 28 + 16 = 44; the band grows upward into the title row's empty space and
  // stops 60px short of the "+" button. The filters keep a 1px gap below it.
  assert.match(css, /\.tl-current-device::before \{[^}]*inset: -16px 60px 0 0;/s);
  // The filters keep their 54px total (1 + 44 + 9) while leaving a 1px gap
  // above the segmented control; the 16px band grows upward only.
  assert.match(css, /\.tl-thread-filters \{[^}]*padding: 1px 16px 9px;/s);
});
