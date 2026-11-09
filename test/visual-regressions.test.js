/**
 * Regression guard for visual defects found in the native app.
 *
 * The Android UI previously depended on expo-symbols' runtime Material
 * Symbols font loading. When that load silently failed, tab icons, chevrons,
 * attachment controls and send/stop controls became blank dots. The sheet
 * container also used flexGrow: 0 on its ScrollView, compressing model and
 * mention rows into a narrow strip. These checks keep both classes of defects
 * from returning without requiring an emulator in CI.
 */
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MOBILE_SRC = path.join(ROOT, "mobile-app", "src");
const FONT = path.join(ROOT, "mobile-app", "assets", "fonts", "MaterialSymbols_400Regular.ttf");

function source(relativePath) {
  return readFileSync(path.join(MOBILE_SRC, relativePath), "utf8");
}

test("native UI uses the bundled, deterministic icon font", () => {
  assert.ok(statSync(FONT).size > 500_000, "Material Symbols font must be checked in");
  const icon = source("components/ui/icon.tsx");
  assert.match(icon, /@expo-google-fonts\/material-symbols\/400Regular\/MaterialSymbols_400Regular\.ttf/);
  assert.match(icon, /loadAsync/);
  assert.match(icon, /TurnloomMaterialSymbols/);
  assert.match(icon, /FALLBACK_GLYPHS/);
});

test("native UI no longer imports expo-symbols directly", () => {
  const files = [
    "app/(tabs)/index.tsx",
    "app/thread/[id].tsx",
    "components/AgentStepCard.tsx",
    "components/GlassTabBar.tsx",
    "components/OptionASheets.tsx",
    "components/PairingSheet.tsx",
    "components/ThumbPromptBar.tsx",
  ];
  for (const file of files) {
    const text = source(file);
    assert.doesNotMatch(text, /from ['"]expo-symbols['"]/, `${file} must not use the runtime-only icon font`);
    assert.match(text, /from ['"](?:\.\/ui\/icon|@\/components\/ui\/icon)['"]/, `${file} must use the bundled icon component`);
  }
});

test("bottom sheets keep a usable, bottom-aligned scroll area", () => {
  const text = source("components/OptionASheets.tsx");
  assert.match(text, /justifyContent:\s*["']flex-end["']/);
  assert.doesNotMatch(text, /style=\{\{\s*flexGrow:\s*0\s*\}\}/);
  assert.match(text, /flexShrink:\s*1/);
  assert.match(text, /contentContainerStyle=\{\{ paddingVertical: 4, paddingHorizontal: 18 \}\}/, "sheet list rows need a consistent inset");
  assert.doesNotMatch(text, /contentContainerStyle=\{\{[^}]*flexGrow:\s*1/);
});

test("README visual assets are refreshed from the fixed build", () => {
  const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
  for (const name of [
    "app-home.png",
    "app-thread.png",
    "app-approval.png",
    "app-model.png",
    "app-mentions.png",
    "app-pairing.png",
    "app-terminals.png",
  ]) {
    assert.match(readme, new RegExp(name.replace(".", "\\.")));
    assert.ok(statSync(path.join(ROOT, "docs", "screenshots", name)).isFile());
  }
});

test("desktop console has a stable minimum layout width", () => {
  const css = readFileSync(path.join(ROOT, "desktop", "renderer", "styles.css"), "utf8");
  assert.match(css, /\.app\s*\{[^}]*min-width:\s*1120px/);
});