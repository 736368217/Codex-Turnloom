/**
 * The web bundle's fallback identity must agree with the APK identity.
 *
 * Why this exists: on 2.4.2 the native bridge is authoritative, but
 * `APP_IDENTITY` is what the first paint and every non-Android preview show.
 * It had drifted to 2.4.0 / 99 while the app was 2.4.1 / 100, so a web preview
 * (or a failed `getAppInfo`) could tell the update checker the wrong installed
 * version. Three literals, one truth: app/package.json, build.gradle.kts and
 * optionATokens.ts.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const appVersion = JSON.parse(fs.readFileSync(path.join(ROOT, "app/package.json"), "utf8")).version;
const rootVersion = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const gradle = fs.readFileSync(path.join(ROOT, "native-shell/app/build.gradle.kts"), "utf8");
const tokens = fs.readFileSync(path.join(ROOT, "app/src/theme/optionATokens.ts"), "utf8");

const gradleName = (gradle.match(/versionName\s*=\s*"([^"]+)"/) || [])[1] || "";
const gradleCode = Number((gradle.match(/versionCode\s*=\s*(\d+)/) || [])[1] || 0);
const fallbackName = (tokens.match(/versionName:\s*'([^']+)'/) || [])[1] || "";
const fallbackCode = Number((tokens.match(/versionCode:\s*(\d+)/) || [])[1] || 0);

test("app/package.json, build.gradle.kts and APP_IDENTITY carry one version", () => {
  assert.match(appVersion, /^\d+\.\d+\.\d+$/);
  // The root package.json names the desktop console installer (electron-builder uses
  // `build.win.artifactName` with ${version}); a stale root version ships a console
  // package labelled with the previous release while the APK says otherwise.
  assert.equal(rootVersion, appVersion, "root package.json version drifted from app/package.json");
  assert.equal(gradleName, appVersion, "gradle versionName drifted from app/package.json");
  assert.equal(fallbackName, appVersion, "APP_IDENTITY.versionName drifted from the app version");
  assert.ok(gradleCode > 0, "gradle versionCode is missing");
  assert.equal(fallbackCode, gradleCode, "APP_IDENTITY.versionCode drifted from gradle versionCode");
});

test("the fallback identity is the shipping package, not a stand-in", () => {
  assert.match(tokens, /applicationId: 'com\.codex\.turnloom\.app'/);
  assert.equal(fallbackName, gradleName);
});
