'use strict';
/**
 * 2.4.3 tab-bar motion contract (NB3's four-point ruling, 2026-11-26).
 *
 * The defect looked like "the press never fades back": the opacity transition
 * was declared *inside* `:active`, so releasing the press removed the rule and
 * the glyph snapped to full strength in one frame. The blanket
 * `.tl-tabbar [role="tab"] { transition: none }` (carried over from Konsta's
 * tabbar) then killed the colour fade on the button itself, so selection
 * flipped in the same frame too.
 *
 * A refactor can quietly reintroduce either shape while every screenshot still
 * looks right, so the source shape is pinned here; the timing itself is
 * measured on the device (acceptance: press ≈102 ms to 0.5, release back to 1.0
 * within 120 ms, selection colour inside 120 ms — same script energy).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../app/src');
const read = (file) => fs.readFileSync(path.resolve(root, file), 'utf8');
// Comments carry the story of the two defects; they must not satisfy (or trip)
// a source-shape assertion.
const bare = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

test('T1: the press fade is declared on the glyph and label, not inside :active', () => {
  const css = bare(read('theme/globals.css'));
  // Resting state: the two layers that actually change opacity own the timing.
  assert.match(
    css,
    /\.tl-tabbar-item svg,\s*\.tl-tabbar-item \.tl-tabbar-label \{\s*transition: opacity 120ms ease;/,
  );
  // Press state carries the value only.
  const active = css.slice(css.indexOf('.tl-tabbar-item:active svg'));
  const block = active.slice(0, active.indexOf('}'));
  assert.match(block, /opacity: \.5;/);
  assert.doesNotMatch(block, /transition:/, 'a transition inside :active disappears with the state');
});

test('T2: no blanket transition:none suppresses the tab bar any more', () => {
  const css = bare(read('theme/globals.css'));
  assert.doesNotMatch(css, /\.tl-tabbar\s*\[role="tab"\]\s*\{[^}]*transition:\s*none/);
  // The colour fade the selected state relies on must still exist.
  assert.match(css, /\.tl-tabbar-item \{[^}]*transition: color 120ms ease;/);
});

test('T3: gate 1 stays intact — no accent wash and no !important inside the bar', () => {
  const css = bare(read('theme/globals.css'));
  const bar = css.slice(css.indexOf('.tl-tabbar {'), css.indexOf('.tl-tabbar-label {'));
  assert.ok(bar.length > 0, 'tab bar rules still exist');
  assert.doesNotMatch(bar, /rgba\(0,\s*122,\s*255/, 'a blue background block under glass is the 2.4.1 defect');
  assert.doesNotMatch(bar, /!important/, 'the bar never needs to out-shout anything');
  // Press feedback stays on the glyph layer: no transform, no background wash.
  assert.doesNotMatch(bar, /\.tl-tabbar-item:active\s*\{[^}]*transform/);
});

test('T4: the component ships state only — colour stays in the stylesheet', () => {
  const bar = read('components/GlassTabBar.tsx');
  assert.doesNotMatch(bar, /style=\{/, 'inline style would beat the fades declared in CSS');
  assert.match(bar, /role="tab"/);
  assert.match(bar, /tl-tabbar-item--active/);
});
