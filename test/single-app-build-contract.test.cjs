"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const BUILD = path.join(ROOT, "scripts", "build-single-app.ps1");
const RELEASE = path.join(ROOT, "shared", "app-release.cjs");

function powershellParse() {
  const script = [
    "$tokens = $null; $errors = $null",
    `[System.Management.Automation.Language.Parser]::ParseFile(${JSON.stringify(BUILD)}, [ref]$tokens, [ref]$errors) | Out-Null`,
    "if ($errors.Count) { $errors | ForEach-Object { Write-Output $_.Message }; exit 1 }"
  ].join("; ");
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
}

test("build script parses in Windows PowerShell 5.1 and stays ASCII/BOM-free", () => {
  const bytes = fs.readFileSync(BUILD);
  assert.equal(bytes[0], 0x23, "#requires must be the first line");
  assert.equal(bytes.slice(0, 3).toString("hex"), "237265", "first line is #requires, with no UTF-8 BOM");
  assert.equal(bytes.some((value) => value > 127), false, "PowerShell 5.1 reads BOM-less scripts in ANSI");
  assert.equal(bytes.includes(0), false, "no NUL bytes");
  if (process.platform === "win32") assert.doesNotThrow(powershellParse);
});

test("version and output filename come from the native build config", () => {
  const source = fs.readFileSync(BUILD, "utf8");
  assert.match(source, /buildConfig\s*=\s*Join-Path\s+\$shellDir[^\n]*build\.gradle\.kts/);
  assert.match(source, /\$versionName\s*=\s*\[regex\]::Match\(\$gradleText,\s*'versionName/);
  assert.match(source, /\$versionCodeText\s*=\s*\[regex\]::Match\(\$gradleText,\s*'versionCode/);
  assert.match(source, /\$apkName\s*=\s*"Codex-Turnloom-\$versionName-app\.apk"/);
  assert.doesNotMatch(source, /Codex-Turnloom-2\.0\.0-app\.apk/);
  assert.doesNotMatch(source, /version\s*=\s*'2\.0\.0-app'|versionCode\s*=\s*80/);
  assert.match(source, /Refusing to overwrite existing output/);
  assert.match(source, /build-manifest-'\s*\+\s*\$versionName/);
});

test("scratch root is contained and reparse points are removed without recursing", () => {
  const source = fs.readFileSync(BUILD, "utf8");
  assert.match(source, /PI_SCRATCH_DIR is required/);
  assert.match(source, /StartsWith\(\$scratchFull \+ \[IO\.Path\]::DirectorySeparatorChar/);
  assert.match(source, /ReparsePoint/);
  assert.match(source, /\[IO\.Directory\]::Delete\(\$child\.FullName, \$false\)/);
  assert.match(source, /node_modules/);
  assert.match(source, /NEVER npm install|no npm install/i);
  assert.match(source, /\$alignedApk\s*=\s*Join-Path\s+\$captureDir/);
  assert.match(source, /Remove-Item -LiteralPath \$treeDist -Recurse -Force/);
});

test("Gradle defaults to no daemon and plain console with hidden controlled exit", () => {
  const source = fs.readFileSync(BUILD, "utf8");
  assert.match(source, /@\('assembleRelease','--no-daemon','--console=plain'\)/);
  assert.match(source, /--console=plain/);
  assert.match(source, /-WindowStyle Hidden/);
  assert.match(source, /exit\.txt/);
  assert.match(source, /\$p\.ExitCode -ne 0/);
  assert.match(source, /Start-Process -FilePath \$Tool/);
});

test("signing passwords come from environment and are never printed", () => {
  const source = fs.readFileSync(BUILD, "utf8");
  assert.match(source, /TURNLOOM_STORE_PASS/);
  assert.match(source, /TURNLOOM_KEY_PASS/);
  assert.match(source, /--ks-pass','env:TURNLOOM_STORE_PASS'/);
  assert.match(source, /--key-pass','env:TURNLOOM_KEY_PASS'/);
  assert.doesNotMatch(source, /\$StorePass\s*=\s*'android'/);
  assert.doesNotMatch(source, /\$KeyPass\s*=\s*'android'/);
  assert.doesNotMatch(source, /pass:\$StorePass|pass:\$KeyPass/);
  assert.doesNotMatch(source, /Write-Host[^\n]*\$storePass|Write-Host[^\n]*\$keyPass/i);
});

test("release sidecar is adjacent, post-verification, and checked against staged bytes", () => {
  const source = fs.readFileSync(BUILD, "utf8");
  assert.match(source, /apksigner-verify/);
  assert.match(source, /aapt2-badging/);
  assert.match(source, /Badging identity disagrees/);
  assert.match(source, /\$stagedFull\.release\.json/);
  assert.match(source, /Staged APK bytes do not match/);
  assert.match(source, /app-release\.cjs'\) --verify --apk \$stagedFull/);
  assert.match(source, /ReleaseNotes|notes=\$ReleaseNotes/);
  assert.doesNotMatch(source, /build-manifest\.json/);
  assert.match(fs.readFileSync(RELEASE, "utf8"), /--verify --apk/);
});

test("typed npm parameter no longer collides with a case-insensitive resolver variable", () => {
  const source = fs.readFileSync(BUILD, "utf8");
  assert.match(source, /\[string\]\$NpmCmdPath/);
  assert.match(source, /Resolve-CommandPath -Command \$NpmCmdPath/);
  assert.doesNotMatch(source, /\$npmCmd\s*=\s*Get-Command \$NpmCmd/);
  assert.doesNotMatch(source, /\[string\]\$NpmCmd\s*=/);
});

test("release helper CLI verifies a staged fixture without writing it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-build-contract-"));
  try {
    const apk = path.join(dir, "Codex-Turnloom.apk");
    const bytes = Buffer.from("build-contract-fixture");
    const digest = require("node:crypto").createHash("sha256").update(bytes).digest("hex");
    const steps = require(RELEASE).REQUIRED_BUILD_STEPS.map((name) => ({ name, status: "ok" }));
    fs.writeFileSync(apk, bytes);
    fs.writeFileSync(`${apk}.release.json`, JSON.stringify({
      packageName: "com.codex.turnloom.app",
      versionName: "2.1.0",
      versionCode: 81,
      apkName: path.basename(apk),
      sha256: digest,
      sizeBytes: bytes.length,
      buildSteps: steps
    }));
    const output = execFileSync(process.execPath, [RELEASE, "--verify", "--apk", apk], { encoding: "utf8" });
    assert.equal(output.trim(), "2.1.0/81");
    fs.writeFileSync(apk, Buffer.from("build-contract-swap"));
    assert.throws(() => execFileSync(process.execPath, [RELEASE, "--verify", "--apk", apk], { encoding: "utf8", stdio: "pipe" }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('hidden launcher preserves spaced arguments and rejects a real nonzero child exit', { skip: process.platform !== 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'launcher test '));
  const child = path.join(dir, 'child with spaces.cjs');
  fs.writeFileSync(child, 'console.log(JSON.stringify(process.argv.slice(2))); process.exit(Number(process.env.LAUNCHER_CHILD_EXIT || 0));');
  const psQuote = value => "'" + value.replaceAll("'", "''") + "'";
  const script = path.join(dir, 'launcher-test.ps1');
  fs.writeFileSync(script, [
    "$ErrorActionPreference = 'Stop'",
    "$tokens=$null; $errors=$null",
    `$ast=[Management.Automation.Language.Parser]::ParseFile(${psQuote(BUILD)},[ref]$tokens,[ref]$errors)`,
    "$ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -in @('Invoke-Tool','Fail')},$true) | ForEach-Object { Invoke-Expression $_.Extent.Text }",
    `$script:CaptureDir=${psQuote(dir)}`,
    `$tool=${psQuote(process.execPath)}; $child=${psQuote(child)}`,
    "Invoke-Tool -Tool $tool -ToolArgs @($child,'two words','quote\"inside','C:\\tail path\\') -WorkDir $script:CaptureDir -Label 'success'",
    "$env:LAUNCHER_CHILD_EXIT='7'",
    "$caught=$false; try { Invoke-Tool -Tool $tool -ToolArgs @($child) -WorkDir $script:CaptureDir -Label 'failure' } catch { $caught=$true }",
    "if (-not $caught) { throw 'nonzero child was accepted' }"
  ].join('\r\n'));
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script], { windowsHide: true, stdio: 'pipe' });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'success.stdout.log'), 'utf8')), ['two words', 'quote"inside', 'C:\\tail path\\']);
  assert.equal(fs.readFileSync(path.join(dir, 'success.exit.txt'), 'utf8'), '0');
  assert.equal(fs.readFileSync(path.join(dir, 'failure.exit.txt'), 'utf8'), '7');
});
