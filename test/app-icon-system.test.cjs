'use strict';
/**
 * 2.2.7 icon system: one family (Lucide), one size ladder, one stroke width.
 *
 * The screenshots show the defect this locks down: 11–26px icons in one
 * viewport read as unrelated families, and a 2.4 arrow next to 1.9 tab icons
 * looks like two different apps. These are source contracts; the rendered
 * centre-to-centre measurement lives in tools/qa/check-redesign.mjs.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../app/src');
const read = (file) => fs.readFileSync(path.resolve(root, file), 'utf8');

function tsxFiles(dir) {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.tsx'))
    .map((entry) => path.join(entry.parentPath || entry.path, entry.name));
}

test('I1: every icon size is on the 14 / 16 / 20 / 22 ladder', () => {
  const sizes = new Set();
  for (const file of tsxFiles(root)) {
    const source = fs.readFileSync(file, 'utf8');
    // The ladder is about Lucide glyphs. A component that takes a pixel box
    // (KindAvatar's 20/24 source mark) is not an icon and must not widen the
    // ladder, so only tags whose name came from `lucide-react` are counted.
    const imports = /import\s*\{([^}]*)\}\s*from\s*['"]lucide-react['"]/.exec(source);
    if (!imports) continue;
    const names = imports[1].split(',').map((entry) => entry.trim().split(/\s+as\s+/).pop()).filter(Boolean);
    for (const name of names) {
      const tag = new RegExp(`<${name}\\b[^>]*\\bsize=\\{(\\d+)\\}`, 'g');
      for (const match of source.matchAll(tag)) sizes.add(Number(match[1]));
    }
  }
  assert.deepEqual([...sizes].sort((a, b) => a - b), [14, 16, 20, 22]);
});

test('I2: stroke width is the Lucide default 2 everywhere', () => {
  for (const file of tsxFiles(root)) {
    const source = fs.readFileSync(file, 'utf8');
    // The brand logo is a hand-drawn SVG with a literal strokeWidth="6"; the
    // rule is about Lucide icons, which carry a numeric JSX strokeWidth prop.
    assert.doesNotMatch(source, /strokeWidth=\{/, path.relative(root, file));
  }
});

test('I3: icon + label containers centre the icon instead of using the text baseline', () => {
  const css = read('theme/globals.css');
  assert.match(css, /\.tl-connect-footer-line \{[^}]*display: inline-flex;[^}]*align-items: center;/s);
  assert.match(css, /\.tl-connect-footer svg \{ display: block; \}/);
  assert.doesNotMatch(css, /\.tl-connect-footer svg \{[^}]*vertical-align/s);
  // The chip and the device line are the two persistent icon+label rows.
  assert.match(css, /\.tl-header-model \{[^}]*gap: 6px/s);
  assert.match(css, /\.tl-current-device \{[^}]*gap: 6px/s);
});

test('I4: settings rows use Lucide chevrons, not a text glyph', () => {
  const settings = read('screens/SettingsScreen.tsx');
  assert.doesNotMatch(settings, /›/, 'no text arrow may stand in for a Lucide icon');
  assert.match(settings, /<ChevronRight size=\{14\} \/>/);
  // 2.4.0: the duplicate "switch service" row is gone; the icon system still
  // uses Lucide only and this screen must not adopt warning glyphs.
  assert.doesNotMatch(settings, /CircleCheck|AlertTriangle/);
});

test('I5: the running-strip disclosure has a Lucide chevron that flips with aria-expanded', () => {
  const strip = read('components/RunningStrip.tsx');
  const css = read('theme/globals.css');
  assert.match(strip, /<ChevronDown size=\{14\} className="tl-runstrip-caret"/);
  assert.match(css, /\.tl-runstrip-pill \{[^}]*display: inline-flex;/s);
  assert.match(css, /\.tl-runstrip-pill\[aria-expanded="true"\] \.tl-runstrip-caret \{[^}]*rotate\(180deg\)/s);
});
