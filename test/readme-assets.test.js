/**
 * Documentation asset gate.
 *
 * Verifies that README image references resolve to real PNG assets, that the
 * assets have the expected dimensions, and that retired mockup filenames are
 * no longer referenced. This prevents a future README rewrite from silently
 * reintroducing broken links or stale UI screenshots.
 */
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const README = readFileSync(path.join(ROOT, "README.md"), "utf8");

function pngSize(relativePath) {
  const bytes = readFileSync(path.join(ROOT, relativePath));
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${relativePath} must be a PNG`);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bytes: bytes.length,
  };
}

test("README only references image assets that exist", () => {
  const references = [...README.matchAll(/<img[^>]+src="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((src) => !/^https?:\/\//.test(src));
  assert.ok(references.length >= 8, "README should show the real screenshot set");
  for (const src of references) {
    const target = path.join(ROOT, src);
    assert.ok(statSync(target).isFile(), `missing image: ${src}`);
    assert.match(src, /^docs\/(assets|screenshots)\//, `unexpected image path: ${src}`);
  }
});

test("README image assets have stable, intentional dimensions", () => {
  assert.deepEqual(pngSize("docs/assets/hero.png").width, 1800);
  assert.deepEqual(pngSize("docs/assets/hero.png").height, 940);
  const expected = [
    "docs/screenshots/app-home.png",
    "docs/screenshots/app-thread.png",
    "docs/screenshots/app-approval.png",
    "docs/screenshots/app-model.png",
    "docs/screenshots/app-mentions.png",
    "docs/screenshots/app-terminals.png",
    "docs/screenshots/app-pairing.png",
  ];
  for (const src of expected) {
    const size = pngSize(src);
    assert.deepEqual([size.width, size.height], [1080, 1920], `${src} must use the phone viewport`);
    assert.ok(size.bytes > 50_000, `${src} is unexpectedly small`);
  }
});

test("README no longer references retired static mockups", () => {
  for (const stale of [
    "promo-Codex-Turnloom.png",
    "app-list.png",
    "app-chat.png",
    "app-terminal.png",
    "Codex-Turnloom-Native-universal.apk",
  ]) {
    assert.ok(!README.includes(stale), `stale documentation reference: ${stale}`);
  }
});

test("README documents the current runtime and security boundary", () => {
  assert.match(README, /Node\.js 22\.5\+/);
  assert.match(README, /npm run verify:ci/);
  assert.match(README, /mobile-app\//);
  assert.match(README, /可信局域网/);
  assert.match(README, /不要直接公网暴露服务/);
  assert.doesNotMatch(README, /Node\.js 18\+/);
  assert.doesNotMatch(README, /\breading、/);
});
