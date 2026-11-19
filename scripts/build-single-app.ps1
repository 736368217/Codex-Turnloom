#requires -Version 5.1
<#
.SYNOPSIS
  Single-line App build with authoritative staged release metadata.
.DESCRIPTION
  ASCII-only source for Windows PowerShell 5.1. Frontend dependencies are
  built only in the scratch build tree. Run this once after all app/ and
  native-shell/ writers have finished. A release sidecar is written beside the
  exact staged APK only after every build/sign/badging check.

  Every tool path defaults to auto-detection so the script is reproducible on
  any machine: repo root derives from $PSScriptRoot, the Android SDK comes from
  ANDROID_HOME / ANDROID_SDK_ROOT or the usual install locations, build-tools
  resolve to the highest installed version, and the debug keystore comes from
  $env:USERPROFILE\.android. Pass an explicit parameter (or the matching
  environment variable) only when the auto-detected value is wrong.

  -BuildType debug produces an installable, debug-signed APK for emulator
  acceptance without needing a release keystore or store/key passwords.
  -BuildType release is the shipping path (zipalign + apksigner + sidecar).
.PARAMETER BuildType
  debug: gradle assembleDebug, AGP signs with the debug key, no passwords.
  release: gradle assembleRelease, then zipalign -p 4 + apksigner (needs
  TURNLOOM_STORE_PASS / TURNLOOM_KEY_PASS).
.PARAMETER HttpProxy
  Optional HTTP proxy for the Gradle distribution and dependency downloads,
  for example http://127.0.0.1:7897. Defaults to $env:TURNLOOM_BUILD_PROXY.
.PARAMETER BuildInWorktree
  Build the frontend directly in app/ instead of mirroring it into the scratch
  tree. Never runs npm install there; app/node_modules must already exist.
.PARAMETER Force
  Overwrite an existing output APK/hash/manifest in -OutDir.
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-single-app.ps1 -BuildType debug
.EXAMPLE
  $env:TURNLOOM_STORE_PASS='...'; $env:TURNLOOM_KEY_PASS='...'
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-single-app.ps1
#>
[CmdletBinding()]
param(
    [string]$RepoRoot          = '',
    [string]$FrontendBuildTree = '',
    [string]$Gradlew           = '',
    [string]$ZipAlign          = '',
    [string]$ApkSigner         = '',
    [string]$Aapt2             = '',
    [string]$Adb               = '',
    [string]$Keystore          = '',
    [string]$KeyAlias          = 'androiddebugkey',
    [string]$OutDir            = '',
    [string]$StagedApkPath     = '',
    [string]$ReleaseNotes      = '',
    [string]$NpmCmdPath        = 'npm.cmd',
    [string]$NodeCmd           = 'node.exe',
    [string]$GradleUserHome    = '',
    [string]$JavaHome          = '',
    [string]$AndroidHome       = '',
    [string]$BuildToolsDir     = '',
    [string]$HttpProxy         = '',
    [string[]]$GradleArgs      = @(),
    [ValidateSet('release', 'debug')]
    [string]$BuildType         = 'release',
    [switch]$AllowDaemon,
    [switch]$BuildInWorktree,
    [switch]$SkipTypecheck,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# PS is case-insensitive: $npmCmd and $NpmCmd are the SAME variable. Use
# distinct names for the typed parameter and the Get-Command result.
function Say { param([string]$Msg) Write-Host ('[build-single-app] ' + $Msg) }
function Fail { param([string]$Msg) throw $Msg }
function WriteUtf8NoBom {
    param([string]$Path, [string]$Text)
    [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false)))
}
function Assert-Tool {
    param([string]$Path, [string]$Label, [string]$Hint = '')
    if (-not $Path) { Fail ("Missing tool: $Label (not auto-detected)" + $(if ($Hint) { "`n$Hint" } else { '' })) }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        $msg = "Missing tool: $Label ($Path)"
        if ($Hint) { $msg = $msg + "`n$Hint" }
        Fail $msg
    }
}
function Resolve-CommandPath {
    param([string]$Command)
    $found = Get-Command $Command -ErrorAction SilentlyContinue
    if (-not $found) { Fail "Command not found: $Command" }
    if ($found.PSObject.Properties['Source'] -and $found.Source) { return [string]$found.Source }
    if ($found.PSObject.Properties['Definition'] -and $found.Definition) { return [string]$found.Definition }
    return $Command
}
# First candidate that exists on disk; '' when none do. Keeps auto-detection
# readable without repeated Test-Path blocks.
function FirstExistingPath {
    param([string[]]$Candidates, [string]$Relative = '')
    foreach ($candidate in $Candidates) {
        if (-not $candidate) { continue }
        $probe = if ($Relative) { Join-Path $candidate $Relative } else { $candidate }
        if (Test-Path -LiteralPath $probe) { return $candidate }
    }
    return ''
}
function Get-EnvOrEmpty {
    param([string]$Name)
    $value = [Environment]::GetEnvironmentVariable($Name)
    if ($null -eq $value) { return '' }
    return [string]$value
}
# Highest installed build-tools version that actually ships the three tools.
function Find-BuildToolsDir {
    param([string]$SdkRoot)
    if (-not $SdkRoot) { return '' }
    $root = Join-Path $SdkRoot 'build-tools'
    if (-not (Test-Path -LiteralPath $root -PathType Container)) { return '' }
    $candidates = @()
    foreach ($dir in (Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue)) {
        $hasZipAlign = Test-Path -LiteralPath (Join-Path $dir.FullName 'zipalign.exe')
        $hasSigner = Test-Path -LiteralPath (Join-Path $dir.FullName 'apksigner.bat')
        $hasAapt2 = Test-Path -LiteralPath (Join-Path $dir.FullName 'aapt2.exe')
        if (-not ($hasZipAlign -and $hasSigner -and $hasAapt2)) { continue }
        $parsed = $null
        if (-not [version]::TryParse(($dir.Name -replace '[^0-9.].*$', ''), [ref]$parsed)) { $parsed = $null }
        $candidates += [pscustomobject]@{ Path = $dir.FullName; Name = $dir.Name; Version = $parsed }
    }
    if ($candidates.Count -eq 0) { return '' }
    $sorted = $candidates | Sort-Object -Property @{ Expression = { if ($_.Version) { $_.Version } else { [version]'0.0' } } }, @{ Expression = { $_.Name } }
    return ($sorted | Select-Object -Last 1).Path
}
function Assert-ScratchTree {
    param([string]$Root, [string]$AllowedRoot, [string]$Label)
    if (-not $AllowedRoot) { Fail 'No scratch root configured for a scratch-only build' }
    $allowedFull = [IO.Path]::GetFullPath($AllowedRoot).TrimEnd('\', '/')
    if (-not (Test-Path -LiteralPath $Root)) { $null = New-Item -ItemType Directory -Path $Root -Force }
    $rootItem = Get-Item -LiteralPath $Root -Force
    if ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { Fail "$Label must not be a junction/symlink root: $Root" }
    $rootFull = [IO.Path]::GetFullPath($rootItem.FullName).TrimEnd('\', '/')
    if (-not $rootFull.StartsWith($allowedFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        Fail "$Label must be contained by the scratch root ${allowedFull}: $Root"
    }
    return $rootFull
}
function Clear-ScratchChildren {
    param([string]$Root)
    foreach ($child in (Get-ChildItem -LiteralPath $Root -Force)) {
        if ($child.Name -eq 'node_modules') { continue }
        if ($child.Name -eq 'tool-capture') { continue }
        if ($child.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            # Remove the link, never recursively delete its external target.
            if ($child.PSIsContainer) { [IO.Directory]::Delete($child.FullName, $false) }
            else { [IO.File]::Delete($child.FullName) }
        } else {
            Remove-Item -LiteralPath $child.FullName -Recurse -Force
        }
    }
}
function Invoke-Tool {
    param([string]$Tool, [string[]]$ToolArgs, [string]$WorkDir, [string]$Label)
    # Start-Process joins ArgumentList with spaces, so quote each native arg.
    $nativeArgs = ($ToolArgs | ForEach-Object { '"' + ($_ -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"' }) -join ' '
    $stdout = Join-Path $script:CaptureDir ($Label + '.stdout.log')
    $stderr = Join-Path $script:CaptureDir ($Label + '.stderr.log')
    $exitFile = Join-Path $script:CaptureDir ($Label + '.exit.txt')
    $p = Start-Process -FilePath $Tool -ArgumentList $nativeArgs -WorkingDirectory $WorkDir `
        -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -Wait
    if (-not $p) { Fail "$Label did not start" }
    [IO.File]::WriteAllText($exitFile, [string]$p.ExitCode, [Text.Encoding]::ASCII)
    if ($p.ExitCode -ne 0) {
        $tail = if (Test-Path -LiteralPath $stderr) { ([IO.File]::ReadAllText($stderr) -split "`r?`n" | Select-Object -Last 20) -join "`n" } else { '' }
        Fail "$Label failed (exit $($p.ExitCode))`n$tail"
    }
    [IO.File]::WriteAllText($exitFile, [string]$p.ExitCode, [Text.Encoding]::ASCII)
}
function Assert-Badging {
    param([string]$Apk)
    $output = Join-Path $script:CaptureDir 'aapt2.badging.stdout.log'
    $errors = Join-Path $script:CaptureDir 'aapt2.badging.stderr.log'
    $exitFile = Join-Path $script:CaptureDir 'aapt2.badging.exit.txt'
    $p = Start-Process -FilePath $Aapt2 -ArgumentList @('dump', 'badging', $Apk) -WorkingDirectory $shellDir `
        -WindowStyle Hidden -RedirectStandardOutput $output -RedirectStandardError $errors -PassThru -Wait
    if (-not $p -or $p.ExitCode -ne 0) { Fail 'aapt2 badging launcher failed' }
    [IO.File]::WriteAllText($exitFile, [string]$p.ExitCode, [Text.Encoding]::ASCII)
    $text = [IO.File]::ReadAllText($output)
    $pkg = [regex]::Match($text, "package:\s+name='([^']+)'").Groups[1].Value
    $verName = [regex]::Match($text, "versionName='([^']+)'").Groups[1].Value
    $verCode = [regex]::Match($text, "versionCode='([^']+)'").Groups[1].Value
    if (-not $pkg -or -not $verName -or -not $verCode) { Fail 'aapt2 badging did not return package/version identity' }
    return [ordered]@{ applicationId = $pkg; versionName = $verName; versionCode = $verCode }
}

# ---------------------------------------------------------------------------
# 0/8 resolve every path and tool (explicit parameter > environment > probe)
# ---------------------------------------------------------------------------
$startedAt = Get-Date
if (-not $RepoRoot) { $RepoRoot = Split-Path -Parent $PSScriptRoot }
if (-not $RepoRoot) { Fail 'Cannot derive the repository root; pass -RepoRoot' }
$repoFull = [IO.Path]::GetFullPath($RepoRoot).TrimEnd('\', '/')
$appDir = Join-Path $repoFull 'app'
$shellDir = Join-Path $repoFull 'native-shell'
if (-not (Test-Path -LiteralPath $appDir -PathType Container)) { Fail "Missing app/: $appDir (is -RepoRoot correct?)" }
if (-not (Test-Path -LiteralPath $shellDir -PathType Container)) { Fail "Missing native-shell/: $shellDir (is -RepoRoot correct?)" }

# Android SDK: ANDROID_HOME wins, then ANDROID_SDK_ROOT, then common layouts.
if (-not $AndroidHome) {
    $AndroidHome = FirstExistingPath -Candidates @(
        (Get-EnvOrEmpty 'ANDROID_HOME'),
        (Get-EnvOrEmpty 'ANDROID_SDK_ROOT'),
        (Get-EnvOrEmpty 'ANDROID_SDK_HOME'),
        (Join-Path $env:USERPROFILE 'tools\android-sdk'),
        (Join-Path $env:USERPROFILE 'AppData\Local\Android\Sdk'),
        (Join-Path $env:LOCALAPPDATA 'Android\Sdk'),
        'C:\Android\Sdk'
    ) -Relative 'build-tools'
}
$SdkHint = 'Set -AndroidHome or $env:ANDROID_HOME to the Android SDK root (it must contain build-tools/ and platform-tools/).'
if (-not $AndroidHome) { Fail "Android SDK not found. $SdkHint" }
$AndroidHome = [IO.Path]::GetFullPath($AndroidHome).TrimEnd('\', '/')
if (-not (Test-Path -LiteralPath (Join-Path $AndroidHome 'build-tools'))) { Fail "Android SDK at $AndroidHome has no build-tools/. $SdkHint" }

# build-tools: explicit dir > env > highest installed that ships all three tools.
if (-not $BuildToolsDir) { $BuildToolsDir = Get-EnvOrEmpty 'ANDROID_BUILD_TOOLS_DIR' }
if (-not $BuildToolsDir) { $BuildToolsDir = Find-BuildToolsDir -SdkRoot $AndroidHome }
if (-not $BuildToolsDir) { Fail "No usable build-tools under $AndroidHome\build-tools (need zipalign.exe, apksigner.bat, aapt2.exe).`nInstall one: sdkmanager `"build-tools;34.0.0`"" }
if (-not $ZipAlign) { $ZipAlign = Join-Path $BuildToolsDir 'zipalign.exe' }
if (-not $ApkSigner) { $ApkSigner = Join-Path $BuildToolsDir 'apksigner.bat' }
if (-not $Aapt2) { $Aapt2 = Join-Path $BuildToolsDir 'aapt2.exe' }
if (-not $Adb) { $Adb = Join-Path $AndroidHome 'platform-tools\adb.exe' }
if (-not $Gradlew) { $Gradlew = Join-Path $shellDir 'gradlew.bat' }

# JDK: explicit > JAVA_HOME > the JDK that owns the java on PATH.
if (-not $JavaHome) { $JavaHome = Get-EnvOrEmpty 'JAVA_HOME' }
if (-not $JavaHome) {
    $javaExe = $null
    $javaCmd = Get-Command 'java.exe' -ErrorAction SilentlyContinue
    if ($javaCmd -and $javaCmd.Source) { $javaExe = [string]$javaCmd.Source }
    if ($javaExe) { $JavaHome = Split-Path -Parent (Split-Path -Parent $javaExe) }
}
if ($JavaHome) { $JavaHome = [IO.Path]::GetFullPath($JavaHome).TrimEnd('\', '/') }
if (-not $JavaHome -or -not (Test-Path -LiteralPath (Join-Path $JavaHome 'bin\java.exe'))) {
    Fail "No JDK 17+ found. Set -JavaHome or `$env:JAVA_HOME to a JDK root containing bin\java.exe."
}

# Gradle caches: keep the user profile default instead of a machine-local disk.
if (-not $GradleUserHome) { $GradleUserHome = Get-EnvOrEmpty 'GRADLE_USER_HOME' }
if (-not $GradleUserHome) { $GradleUserHome = Join-Path $env:USERPROFILE '.gradle' }

# Keystore is only needed for the release path; debug uses the AGP debug key.
if ($BuildType -eq 'release') {
    if (-not $Keystore) { $Keystore = Get-EnvOrEmpty 'TURNLOOM_KEYSTORE' }
    if (-not $Keystore) { $Keystore = Join-Path $env:USERPROFILE '.android\debug.keystore' }
}

# HTTP proxy for the Gradle distribution/AGP downloads (optional).
if (-not $HttpProxy) { $HttpProxy = Get-EnvOrEmpty 'TURNLOOM_BUILD_PROXY' }

if (-not $OutDir) { $OutDir = Join-Path $repoFull 'dist-app' }
$OutDir = [IO.Path]::GetFullPath($OutDir).TrimEnd('\', '/')

# ---------------------------------------------------------------- identity --
$buildConfig = Join-Path $shellDir 'app\build.gradle.kts'
if (-not (Test-Path -LiteralPath $buildConfig -PathType Leaf)) { Fail "Missing native build config: $buildConfig" }
$gradleText = [IO.File]::ReadAllText($buildConfig)
$configuredPackage = [regex]::Match($gradleText, 'applicationId\s*=\s*"([^"]+)"').Groups[1].Value
$versionName = [regex]::Match($gradleText, 'versionName\s*=\s*"([^"]+)"').Groups[1].Value
$versionCodeText = [regex]::Match($gradleText, 'versionCode\s*=\s*(\d+)').Groups[1].Value
if (-not $configuredPackage -or -not $versionName -or -not $versionCodeText) { Fail 'native-shell/app/build.gradle.kts lacks package/version identity' }
$versionCode = [int]$versionCodeText
$compileSdkText = [regex]::Match($gradleText, 'compileSdk\s*=\s*(\d+)').Groups[1].Value
$compileSdk = if ($compileSdkText) { [int]$compileSdkText } else { 0 }

# Output name follows native-shell/app/build.gradle.kts versionName. The
# release artifact keeps the shipped name; a debug build is suffixed so the two
# never overwrite each other in dist-app/.
$apkName = "Codex-Turnloom-$versionName-app.apk"
if ($BuildType -eq 'debug') { $apkName = "Codex-Turnloom-$versionName-app-debug.apk" }
$finalApk = Join-Path $OutDir $apkName

# ------------------------------------------------------------ scratch tree --
$scratchRoot = Get-EnvOrEmpty 'PI_SCRATCH_DIR'
if (-not $scratchRoot) { $scratchRoot = Join-Path $repoFull '.scratch' }
$scratchRoot = [IO.Path]::GetFullPath($scratchRoot).TrimEnd('\', '/')
if (-not $FrontendBuildTree) { $FrontendBuildTree = Join-Path $scratchRoot 'app-build-tree' }
$treeFull = if ($BuildInWorktree) { [IO.Path]::GetFullPath($appDir) } else { Assert-ScratchTree -Root $FrontendBuildTree -AllowedRoot $scratchRoot -Label 'FrontendBuildTree' }
$captureRoot = Join-Path $scratchRoot 'tool-capture'
$captureDir = Join-Path $captureRoot ('build-' + $startedAt.ToString('yyyyMMdd-HHmmss'))
$script:CaptureDir = $captureDir
$null = New-Item -ItemType Directory -Path $captureDir -Force
$treeDist = Join-Path $treeFull 'dist'
$publicAssets = Join-Path $shellDir 'app\src\main\assets\public'

if ($BuildType -eq 'debug') {
    $builtApk = Join-Path $shellDir 'app\build\outputs\apk\debug\app-debug.apk'
} else {
    $builtApk = Join-Path $shellDir 'app\build\outputs\apk\release\app-release-unsigned.apk'
}
$alignedApk = Join-Path $captureDir ($apkName + '.aligned.tmp')
$hashFile = "$finalApk.sha256"
$buildManifest = Join-Path $OutDir ('build-manifest-' + $versionName + '.json')

# ------------------------------------------------------------------ tools ---
$resolvedNpm = Resolve-CommandPath -Command $NpmCmdPath
$resolvedNode = Resolve-CommandPath -Command $NodeCmd
if ($BuildType -eq 'release') {
    if (-not (Get-EnvOrEmpty 'TURNLOOM_STORE_PASS')) { Fail 'Set TURNLOOM_STORE_PASS (never pass passwords on the command line)' }
    if (-not (Get-EnvOrEmpty 'TURNLOOM_KEY_PASS')) { Fail 'Set TURNLOOM_KEY_PASS (never pass passwords on the command line)' }
}
$env:GRADLE_USER_HOME = $GradleUserHome
$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $AndroidHome
$env:ANDROID_SDK_ROOT = $AndroidHome
$toolChecks = @(
    @('Gradlew', $Gradlew),
    @('ApkSigner', $ApkSigner),
    @('Aapt2', $Aapt2)
)
if ($BuildType -eq 'release') { $toolChecks += @(, @('ZipAlign', $ZipAlign)) }
if ($BuildType -eq 'release') { $toolChecks += @(, @('Keystore', $Keystore)) }
foreach ($entry in $toolChecks) { Assert-Tool -Path $entry[1] -Label $entry[0] -Hint $SdkHint }

if (Test-Path -LiteralPath $finalApk) {
    if (-not $Force) { Fail "Refusing to overwrite existing output: $finalApk (pass -Force to replace it)" }
    Remove-Item -LiteralPath $finalApk -Force
}
if ($GradleArgs.Count -eq 0) {
    if ($BuildType -eq 'debug') { $GradleArgs = @('assembleDebug', '--no-daemon', '--console=plain') }
    else { $GradleArgs = @('assembleRelease','--no-daemon','--console=plain') }
} else {
    if (-not ($GradleArgs -contains '--no-daemon')) { $GradleArgs += '--no-daemon' }
    if (-not ($GradleArgs -contains '--console=plain')) { $GradleArgs += '--console=plain' }
}
if ($AllowDaemon -and ($GradleArgs -contains '--no-daemon')) {
    $GradleArgs = @($GradleArgs | Where-Object { $_ -ne '--no-daemon' })
}
# Route the Gradle distribution download and AGP resolution through a proxy
# only when one was explicitly configured.
$gradleEnvBackup = @{ HTTP_PROXY = (Get-EnvOrEmpty 'HTTP_PROXY'); HTTPS_PROXY = (Get-EnvOrEmpty 'HTTPS_PROXY') }
if ($HttpProxy) {
    $env:HTTP_PROXY = $HttpProxy
    $env:HTTPS_PROXY = $HttpProxy
    $proxyUri = [Uri]$HttpProxy
    $proxyOpts = @(
        "-Dhttp.proxyHost=$($proxyUri.Host)", "-Dhttp.proxyPort=$($proxyUri.Port)",
        "-Dhttps.proxyHost=$($proxyUri.Host)", "-Dhttps.proxyPort=$($proxyUri.Port)"
    ) -join ' '
    $env:GRADLE_OPTS = (($env:GRADLE_OPTS + ' ' + $proxyOpts).Trim())
    # Gradle forwards launcher -D arguments to the build JVM, which is what the
    # AGP dependency resolver and the wrapper download actually use.
    $GradleArgs += @(
        "-Dhttp.proxyHost=$($proxyUri.Host)", "-Dhttp.proxyPort=$($proxyUri.Port)",
        "-Dhttps.proxyHost=$($proxyUri.Host)", "-Dhttps.proxyPort=$($proxyUri.Port)"
    )
}

$steps = New-Object System.Collections.ArrayList
function Step { param([string]$Name, [string]$Status, [string]$Detail = '') $null = $steps.Add([ordered]@{ name = $Name; status = $Status; detail = $Detail }) }
function Write-FailureManifest {
    param([string]$Message)
    try {
        if (-not (Test-Path -LiteralPath $OutDir)) { $null = New-Item -ItemType Directory -Path $OutDir -Force }
        Step 'failed' 'error' $Message
        $failed = [ordered]@{ generatedAt = (Get-Date).ToString('o'); result = 'FAILED'; buildType = $BuildType; versionName = $versionName; versionCode = $versionCode; error = $Message; steps = @($steps.ToArray()) }
        WriteUtf8NoBom -Path $buildManifest -Text (($failed | ConvertTo-Json -Depth 8) + "`n")
    } catch { }
}

Say "Building $apkName ($BuildType) from native config $versionName / $versionCode"
Say "repo=$repoFull sdk=$AndroidHome build-tools=$(Split-Path -Leaf $BuildToolsDir) jdk=$JavaHome"
try {
    Say '1/8 validate source trees and toolchain'
    Step 'validate' 'ok' "$repoFull / $treeFull"
    Step 'toolchain' 'ok' "sdk=$AndroidHome tools=$(Split-Path -Leaf $BuildToolsDir) jdk=$JavaHome gradle=$GradleUserHome"
    if ($compileSdk -gt 0) {
        $platformProbe = Join-Path $AndroidHome ('platforms\android-' + $compileSdk)
        if (-not (Test-Path -LiteralPath $platformProbe)) {
            Say "NOTE: compileSdk $compileSdk is not installed under $AndroidHome\platforms; Gradle will try to fetch it."
            Step 'platform-missing' 'warn' "platforms;android-$compileSdk"
        }
    }
    if ($BuildInWorktree) {
        Say '2/8 use the worktree app/ tree directly (-BuildInWorktree, no npm install)'
        Step 'sync-source' 'skipped' 'BuildInWorktree'
    } else {
        Say '2/8 clean scratch mirror (no npm install in worktree)'
        Clear-ScratchChildren -Root $treeFull
        if (Test-Path -LiteralPath $treeDist) { Remove-Item -LiteralPath $treeDist -Recurse -Force }
        foreach ($item in (Get-ChildItem -LiteralPath $appDir -Force)) {
            if ($item.Name -eq 'node_modules') { continue }
            Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $treeFull $item.Name) -Recurse -Force
        }
        if (-not (Test-Path -LiteralPath (Join-Path $treeFull 'node_modules') -PathType Container)) {
            $worktreeModules = Join-Path $appDir 'node_modules'
            if (Test-Path -LiteralPath $worktreeModules -PathType Container) {
                Say "copying preinstalled app/node_modules into the scratch tree (no network install)"
                $null = New-Item -ItemType Directory -Path (Join-Path $treeFull 'node_modules') -Force
                & robocopy $worktreeModules (Join-Path $treeFull 'node_modules') /E /NFL /NDL /NJH /NJS /MT:8 /R:1 /W:1 | Out-Null
                if ($LASTEXITCODE -ge 8) { Fail "robocopy of node_modules failed (exit $LASTEXITCODE)" }
            } else {
                Say 'scratch tree has no node_modules; installing dependencies inside the scratch tree'
                Invoke-Tool -Tool $resolvedNpm -ToolArgs @('ci', '--prefix', $treeFull) -WorkDir $treeFull -Label 'npm-ci'
            }
        }
        Step 'sync-source' 'ok' $treeFull
    }
    Say '3/8 typecheck + build frontend'
    if ($SkipTypecheck) {
        Step 'typecheck' 'skipped' '-SkipTypecheck'
    } else {
        Invoke-Tool -Tool $resolvedNpm -ToolArgs @('run', 'typecheck', '--prefix', $treeFull) -WorkDir $treeFull -Label 'tsc-typecheck'
        Step 'typecheck' 'ok' 'tsc --noEmit'
    }
    Invoke-Tool -Tool $resolvedNpm -ToolArgs @('run', 'build', '--prefix', $treeFull) -WorkDir $treeFull -Label 'vite-build'
    $indexHtml = Join-Path $treeDist 'index.html'
    if (-not (Test-Path -LiteralPath $indexHtml)) { Fail 'dist/index.html was not produced' }
    $indexText = [IO.File]::ReadAllText($indexHtml, [Text.Encoding]::UTF8).TrimStart([char]0xFEFF)
    if ([regex]::Matches($indexText, '(?:src|href)\s*=\s*["'']/(?!/)').Count -gt 0) { Fail 'Vite base must be ./ for the local packaged page' }
    Step 'vite-build' 'ok' "dist/index.html base='./'"
    Say '4/8 replace generated WebView assets'
    if (-not (Test-Path -LiteralPath $publicAssets)) { $null = New-Item -ItemType Directory -Path $publicAssets -Force }
    foreach ($old in (Get-ChildItem -LiteralPath $publicAssets -Force)) { Remove-Item -LiteralPath $old.FullName -Recurse -Force }
    foreach ($item in (Get-ChildItem -LiteralPath $treeDist -Force)) { Copy-Item -LiteralPath $item.FullName -Destination $publicAssets -Recurse -Force }
    if (-not (Test-Path -LiteralPath (Join-Path $publicAssets 'index.html'))) { Fail 'Generated assets lack index.html' }
    Step 'copy-assets' 'ok' $publicAssets
    Say ("5/8 gradle " + ($GradleArgs[0]) + ' (windowless, controlled exit)')
    if (Test-Path -LiteralPath $builtApk) { Remove-Item -LiteralPath $builtApk -Force }
    Invoke-Tool -Tool $Gradlew -ToolArgs $GradleArgs -WorkDir $shellDir -Label ($GradleArgs[0])
    if (-not (Test-Path -LiteralPath $builtApk)) { Fail "Missing gradle output APK: $builtApk" }
    Step ($GradleArgs[0]) 'ok' $builtApk
    if (-not (Test-Path -LiteralPath $OutDir)) { $null = New-Item -ItemType Directory -Path $OutDir -Force }
    if ($BuildType -eq 'debug') {
        Say '6/8 debug APK is already zipaligned and debug-signed by AGP; copy it as the deliverable'
        Copy-Item -LiteralPath $builtApk -Destination $finalApk -Force
        Step 'zipalign' 'skipped' 'AGP debug output is aligned'
        Step 'apksigner-sign' 'skipped' 'AGP debug keystore'
    } else {
        Say '6/8 zipalign -> apksigner sign'
        if (Test-Path -LiteralPath $alignedApk) { Remove-Item -LiteralPath $alignedApk -Force }
        Invoke-Tool -Tool $ZipAlign -ToolArgs @('-p', '4', $builtApk, $alignedApk) -WorkDir $shellDir -Label 'zipalign'
        Step 'zipalign' 'ok' '-p 4'
        # apksigner reads both passwords directly from environment variables.
        # No password appears in a command line, generated script, or log.
        Invoke-Tool -Tool $ApkSigner -ToolArgs @(
            'sign','--ks',$Keystore,'--ks-key-alias',$KeyAlias,
            '--ks-pass','env:TURNLOOM_STORE_PASS','--key-pass','env:TURNLOOM_KEY_PASS',
            '--v1-signing-enabled', 'true', '--v2-signing-enabled', 'true', '--v3-signing-enabled', 'true',
            '--out', $finalApk, $alignedApk
        ) -WorkDir $shellDir -Label 'apksigner-sign'
        Step 'apksigner-sign' 'ok' 'v1/v2/v3'
    }
    Say '7/8 verify signature -> badging identity -> sha256'
    Invoke-Tool -Tool $ApkSigner -ToolArgs @('verify', '--verbose', '--print-certs', $finalApk) -WorkDir $shellDir -Label 'apksigner-verify'
    Step 'apksigner-verify' 'ok' 'v2/v3'
    $identity = Assert-Badging -Apk $finalApk
    if ($identity.applicationId -ne $configuredPackage -or $identity.versionName -ne $versionName -or [string]$identity.versionCode -ne [string]$versionCode) {
        Fail "Badging identity disagrees with native build config: $($identity.applicationId)/$($identity.versionName)/$($identity.versionCode)"
    }
    Step 'aapt2-badging' 'ok' "$($identity.applicationId)/$($identity.versionName)/$($identity.versionCode)"
    Say '8/8 write versioned build artifacts and stage release metadata'
    $hash = (Get-FileHash -LiteralPath $finalApk -Algorithm SHA256).Hash.ToLowerInvariant()
    $size = (Get-Item -LiteralPath $finalApk).Length
    WriteUtf8NoBom -Path $hashFile -Text ("$hash  $apkName`n")
    $manifest = [ordered]@{
        generatedAt   = (Get-Date).ToString('o'); startedAt = $startedAt.ToString('o')
        result        = 'ok'; route = 'dom-shell'; buildType = $BuildType
        # shared/app-release.cjs treats a manifest without a channel as a release
        # build (it then demands assembleRelease) — name the channel explicitly.
        channel       = $(if ($BuildType -eq 'debug') { 'debug' } else { 'release' })
        packageName   = $configuredPackage
        versionName   = $versionName; versionCode = $versionCode; apkName = $apkName
        sha256        = $hash; sizeBytes = $size; notes = $ReleaseNotes
        identity      = $identity; buildSteps = @($steps.ToArray())
        toolchain     = [ordered]@{
            androidSdk = $AndroidHome; buildTools = $BuildToolsDir; jdk = $JavaHome
            gradleUserHome = $GradleUserHome; node = ($resolvedNode); npm = ($resolvedNpm)
        }
        apk           = [ordered]@{ name = $apkName; path = $finalApk; bytes = $size; sha256 = $hash }
        entryUrl      = 'file:///android_asset/public/index.html'
        gradleArgs    = $GradleArgs
    }
    WriteUtf8NoBom -Path $buildManifest -Text (($manifest | ConvertTo-Json -Depth 8) + "`n")
    if ($StagedApkPath) {
        $stagedFull = [IO.Path]::GetFullPath($StagedApkPath)
        if ((Get-FileHash -LiteralPath $stagedFull -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) {
            Fail 'Staged APK bytes do not match the signed build artifact'
        }
        if ((Get-Item -LiteralPath $stagedFull).Length -ne $size) { Fail 'Staged APK size does not match the signed build artifact' }
        $releaseFile = "$stagedFull.release.json"
        $releaseTmp = "$releaseFile.tmp"
        $releaseManifest = [ordered]@{
            schema              = 'turnloom-app-release/1'; generatedAt = (Get-Date).ToString('o')
            channel             = $(if ($BuildType -eq 'debug') { 'debug' } else { 'release' })
            packageName         = $configuredPackage; versionName = $versionName; versionCode = $versionCode
            apkName             = (Split-Path -Leaf $stagedFull); apkPath = $stagedFull
            sha256              = $hash; sizeBytes = $size; notes = $ReleaseNotes
            artifactSha256      = $hash; artifactSizeBytes = $size
            identity            = $identity
            apk                 = [ordered]@{ name = (Split-Path -Leaf $stagedFull); bytes = $size; sha256 = $hash }
            buildSteps          = @($steps.ToArray()); sourceBuildManifest = $buildManifest
        }
        WriteUtf8NoBom -Path $releaseTmp -Text (($releaseManifest | ConvertTo-Json -Depth 8) + "`n")
        Move-Item -LiteralPath $releaseTmp -Destination $releaseFile -Force
        $release = & $resolvedNode (Join-Path $repoFull 'shared\app-release.cjs') --verify --apk $stagedFull
        if ($LASTEXITCODE -ne 0) { Fail 'Final staged release metadata validation failed' }
        Say "Staged release: $release"
        Step 'release-metadata' 'ok' $releaseFile
    }
    Remove-Item -LiteralPath $alignedApk -Force -ErrorAction SilentlyContinue
    Say "Done: $finalApk ($size bytes, sha256 $hash)"
} catch {
    Write-FailureManifest -Message $_.Exception.Message
    throw
} finally {
    if ($HttpProxy) {
        $env:HTTP_PROXY = $gradleEnvBackup['HTTP_PROXY']
        $env:HTTPS_PROXY = $gradleEnvBackup['HTTPS_PROXY']
    }
}
