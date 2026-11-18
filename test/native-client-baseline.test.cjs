"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

test("current mobile-app baseline is an Expo/RN client with RN-rendered bottom tabs", () => {
  const layout = read(path.join("mobile-app", "src", "app", "(tabs)", "_layout.tsx"));
  assert.match(layout, /GlassTabBar/);
  assert.match(layout, /Tabs\.Screen name="index"/);
  assert.match(layout, /Tabs\.Screen name="monitors"/);
  assert.match(layout, /Tabs\.Screen name="settings"/);

  const tabBar = read(path.join("mobile-app", "src", "components", "GlassTabBar.tsx"));
  for (const label of ["对话", "终端", "设置"]) assert.ok(tabBar.includes(label), `missing tab label: ${label}`);
  assert.match(tabBar, /accessibilityRole="tab"/);
});

test("RN client app identity is Codex-Turnloom and never the DSHgo experiment package", () => {
  const appJson = JSON.parse(read(path.join("mobile-app", "app.json")));
  assert.equal(appJson.expo.name, "Codex-Turnloom");
  assert.notEqual(appJson.expo.android.package, "io.github.ccch1mneyyy.dsh_app");

  const buildGradle = path.join(ROOT, "mobile-app", "android", "app", "build.gradle");
  if (fs.existsSync(buildGradle)) {
    const gradle = fs.readFileSync(buildGradle, "utf8");
    assert.match(gradle, /applicationId\s+'com\.codexpocket\.optiona\.native'/);
    assert.doesNotMatch(gradle, /io\.github\.ccch1mneyyy\.dsh_app/);
  }
  const delivery = read(path.join("dist-native", "delivery.html"));
  assert.match(delivery, /package|包名/);
  assert.match(delivery, /com\.codexpocket\.optiona\.native/);
  assert.doesNotMatch(delivery, /io\.github\.ccch1mneyyy\.dsh_app/);
});

test("delivery page identifies the RN client and rejects the Flutter one-code experiment", () => {
  const delivery = read(path.join("dist-native", "delivery.html"));
  assert.match(delivery, /Codex-Turnloom-Native-1\.20\.1-arm64-x86_64\.apk/);
  assert.match(delivery, /com\.codexpocket\.optiona\.native/);
  assert.doesNotMatch(delivery, /正式原生 App|纯原生 App/);
  assert.match(delivery, /Expo \/ React Native|RN 客户端/);
  assert.doesNotMatch(delivery, /Codex-Turnloom-4\.2\.0-one-code-arm64-release\.apk/);
  assert.equal(fs.existsSync(path.join(ROOT, "dist-dshgo", "delivery.html")), false);
});

test("Windows launchers do not expose a visible console window", () => {
  const launcher = read(path.join("scripts", "link-watchdog-launcher.vbs"));
  assert.match(launcher, /WScript\.Shell\.Run\(command, 0, False\)/i);

  const installer = read(path.join("installer", "install-machine-service.ps1"));
  assert.match(installer, /wscript\.exe/i);
  assert.match(installer, /WScript\.Shell\.Run/i);
  assert.doesNotMatch(installer, /Win32_Process\.Create/i);
  assert.doesNotMatch(installer, /Start-Process[^\n]*node\.exe[^\n]*(-WindowStyle\s+Normal|)/i);
});

test("project rules pin the single ROUTE=dom-shell App line and keep the windowless rule", () => {
  const agents = read("docs/option-a/SINGLE_APP_CONTRACT.md");
  // 用户 2026-11-11 决策覆盖旧「纯原生才叫 App」口径：唯一交付线是 App 化 DOM 容器。
  assert.match(agents, /ROUTE=dom-shell/);
  assert.match(agents, /App 化 DOM 容器（含 WebView）/);
  assert.match(agents, /Konsta UI/);
  assert.match(agents, /Vaul/);
  assert.match(agents, /冻结\s*\/\s*归档/);
  assert.match(agents, /mobile-app\//);
  assert.match(agents, /native-shell\//);
  // Public project contracts must be available in a clean checkout, unlike local agent memory.
  assert.match(agents, /Windows 无黑框/);
  assert.match(agents, /wscript\.exe/);
  assert.match(agents, /WScript\.Shell\.Run/);
});
