#requires -Version 5.1
<#
.SYNOPSIS
  Build the server upgrade package for an existing Codex-Turnloom install.

.DESCRIPTION
  ASCII-only source for Windows PowerShell 5.1. Produces

      <OutDir>\turnloom-<version>-server.zip
      <OutDir>\turnloom-<version>-server.zip.sha256

  The zip is a replace-in-place overlay for a running install: it carries the
  host code (server.js, server/, backends/, shared/, scripts/, desktop/),
  package.json + lock, a VERSION.json manifest digest and, optionally, the
  staged phone APK for public/downloads so /api/app/update-public follows.

  It never carries node_modules, test/, docs/, app/, native-shell/, android/,
  mobile-app/, third-party/, tmp/, .git/ or .scratch/: an existing install keeps
  its own dependency tree and its own data.

.PARAMETER Version
  Version stamped into VERSION.json and the file name. Defaults to the app
  versionName in native-shell/app/build.gradle.kts, so server and phone agree.

.PARAMETER OutDir
  Output directory. Defaults to dist-app/.

.PARAMETER Apk
  APK to stage as public/downloads/Codex-Turnloom.apk. Its release sidecar is
  written with shared/app-release.cjs --stamp so the host advertises exactly
  these bytes. Omit to ship code only.

.PARAMETER ExpectedCertSha256
  Signing certificate the staged APK must carry. The check fails closed: a
  missing apksigner, a malformed expected value, or a different certificate all
  refuse to build the package (-SkipSignatureCheck overrides).

.PARAMETER Force
  Overwrite an existing zip instead of failing.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-server-upgrade.ps1 `
      -Apk dist-app/Codex-Turnloom-2.2.1-app-debug.apk -Force
#>
[CmdletBinding()]
param(
    [string]$Version = '',
    [string]$OutDir = '',
    [string]$Apk = '',
    [string]$ApkManifest = '',
    [string]$ExpectedCertSha256 = '2feb63c511cd725795cadc8fa890f9cbc754fe59c0bbfe0787ac33f94f44fa9c',
    [string]$AndroidHome = '',
    [switch]$SkipSignatureCheck,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

function Say([string]$Message) { Write-Host "[package-server] $Message" }
function Fail([string]$Message) { throw "[package-server] $Message" }

# build-tools\apksigner found from -AndroidHome, ANDROID_HOME / ANDROID_SDK_ROOT,
# or the usual per-user install. Highest version wins.
function Find-BuildTool([string]$Name) {
    $roots = @()
    if ($AndroidHome) { $roots += $AndroidHome }
    if ($env:ANDROID_HOME) { $roots += $env:ANDROID_HOME }
    if ($env:ANDROID_SDK_ROOT) { $roots += $env:ANDROID_SDK_ROOT }
    $roots += (Join-Path $env:USERPROFILE 'tools\android-sdk')
    foreach ($root in $roots) {
        $buildTools = Join-Path $root 'build-tools'
        if (-not (Test-Path -LiteralPath $buildTools)) { continue }
        $dirs = Get-ChildItem -LiteralPath $buildTools -Directory |
            Sort-Object { try { [version]$_.Name } catch { [version]'0.0.0' } } -Descending
        foreach ($dir in $dirs) {
            $candidate = Join-Path $dir.FullName $Name
            if (Test-Path -LiteralPath $candidate) { return $candidate }
        }
    }
    return ''
}

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'server.js') -PathType Leaf)) {
    Fail "server.js not found under $repoRoot"
}
if (-not $OutDir) { $OutDir = Join-Path $repoRoot 'dist-app' }
$OutDir = [IO.Path]::GetFullPath($OutDir)

$gradleFile = Join-Path $repoRoot 'native-shell\app\build.gradle.kts'
if (-not $Version) {
    if (-not (Test-Path -LiteralPath $gradleFile -PathType Leaf)) { Fail 'native-shell/app/build.gradle.kts is missing; pass -Version' }
    $gradleText = Get-Content -LiteralPath $gradleFile -Raw -Encoding UTF8
    $Version = [regex]::Match($gradleText, 'versionName\s*=\s*"([^"]+)"').Groups[1].Value
    if (-not $Version) { Fail 'native-shell/app/build.gradle.kts has no versionName; pass -Version' }
}
if ($Version -notmatch '^[0-9A-Za-z][0-9A-Za-z._-]*$') { Fail "invalid -Version '$Version'" }

$appVersionCode = 0
if (Test-Path -LiteralPath $gradleFile -PathType Leaf) {
    $appVersionCode = [int]([regex]::Match((Get-Content -LiteralPath $gradleFile -Raw -Encoding UTF8), 'versionCode\s*=\s*(\d+)').Groups[1].Value)
}

# ---------------------------------------------------------------- staging --
$scratchRoot = Join-Path $repoRoot '.scratch'
$stage = Join-Path $scratchRoot ('server-package-' + $Version)
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
$null = New-Item -ItemType Directory -Path $stage -Force

$includeDirs = @('server', 'backends', 'shared', 'scripts', 'desktop')
$includeFiles = @('server.js', 'package.json', 'package-lock.json')
foreach ($name in $includeFiles) {
    $source = Join-Path $repoRoot $name
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { Fail "missing required file: $name" }
    Copy-Item -LiteralPath $source -Destination (Join-Path $stage $name) -Force
}
foreach ($name in $includeDirs) {
    $source = Join-Path $repoRoot $name
    if (-not (Test-Path -LiteralPath $source -PathType Container)) { Fail "missing required directory: $name" }
    $target = Join-Path $stage $name
    $null = New-Item -ItemType Directory -Path $target -Force
    Copy-Item -Path (Join-Path $source '*') -Destination $target -Recurse -Force
}

# A package must be self-checkable on the host it lands on.
$required = @(
    'server.js', 'package.json',
    'server\request-log.cjs', 'server\machine-gateway.cjs',
    'shared\app-release.cjs', 'shared\machine-pairing.cjs', 'shared\send-files.cjs',
    'scripts\bounded-log.cjs', 'scripts\windows-supervisor.ps1', 'scripts\start-console.ps1',
    'update-turnloom.ps1'
)
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'update-turnloom.ps1') -Destination (Join-Path $stage 'update-turnloom.ps1') -Force

$apkStaged = ''
if ($Apk) {
    $apkFull = [IO.Path]::GetFullPath($Apk)
    if (-not (Test-Path -LiteralPath $apkFull -PathType Leaf)) { Fail "APK not found: $apkFull" }
    $manifest = $ApkManifest
    if (-not $manifest) {
        $manifest = Join-Path (Split-Path -Parent $apkFull) ('build-manifest-' + $Version + '.json')
        if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { $manifest = '' }
    }
    if (-not $manifest) {
        Fail 'pass -ApkManifest: the staged APK must carry its real build record (build-manifest-<version>.json)'
    }
    $downloads = Join-Path $stage 'public\downloads'
    $null = New-Item -ItemType Directory -Path $downloads -Force
    $stagedApk = Join-Path $downloads 'Codex-Turnloom.apk'
    Copy-Item -LiteralPath $apkFull -Destination $stagedApk -Force

    # The host only advertises an APK whose sidecar re-hashes the staged bytes and
    # carries complete build steps, so reuse the build's own manifest verbatim and
    # rename only the artifact it names.
    $record = Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $record.buildSteps) { Fail "build manifest has no buildSteps: $manifest" }
    $stagedHash = (Get-FileHash -LiteralPath $stagedApk -Algorithm SHA256).Hash.ToLowerInvariant()
    $recordHash = [string]$record.sha256
    if (-not $recordHash) { $recordHash = [string]$record.apk.sha256 }
    if ($recordHash.ToLowerInvariant() -ne $stagedHash) { Fail 'APK bytes do not match the build manifest sha256' }
    $record | Add-Member -NotePropertyName apkName -NotePropertyValue 'Codex-Turnloom.apk' -Force
    $record | Add-Member -NotePropertyName stagedFor -NotePropertyValue 'server-upgrade-package' -Force
    $sidecar = $stagedApk + '.release.json'
    [IO.File]::WriteAllText($sidecar, ($record | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))

    $node = (Get-Command node.exe -ErrorAction Stop).Source
    & $node (Join-Path $repoRoot 'shared\app-release.cjs') --verify --apk $stagedApk
    if ($LASTEXITCODE -ne 0) { Fail 'the staged APK sidecar does not verify' }

    # Fail closed on the signing certificate: this zip is what an install
    # downloads, so a wrong-key APK inside it would make every update fail with
    # "package not installed". The value itself is validated, not just presence.
    if ($SkipSignatureCheck) {
        Say 'WARNING: APK signature check skipped by request'
    } else {
        if ($ExpectedCertSha256 -notmatch '^[0-9a-f]{64}$') {
            Fail 'expected cert sha256 is missing or malformed; refusing to package (pass -SkipSignatureCheck to override)'
        }
        $apkSigner = Find-BuildTool 'apksigner.bat'
        if (-not $apkSigner) { $apkSigner = Find-BuildTool 'apksigner' }
        if (-not $apkSigner) { Fail 'apksigner not found (set -AndroidHome); refusing to package an unverified APK (pass -SkipSignatureCheck to override)' }
        $certs = (& $apkSigner verify --print-certs $stagedApk 2>&1 | Out-String)
        if ($LASTEXITCODE -ne 0) { Fail "apksigner verify failed: $certs" }
        if ($certs -notmatch [regex]::Escape($ExpectedCertSha256)) {
            Fail "APK is not signed with the project key. Expected $ExpectedCertSha256. Cert output: $certs"
        }
        Say 'signature matches the project key (2feb63c5...)'
    }
    # 2.4.1 shipped a debuggable APK; this zip is what paired computers serve,
    # so a debug build must never be staged even when the signature is right.
    $aapt2 = Find-BuildTool 'aapt2.exe'
    if (-not $aapt2) { $aapt2 = Find-BuildTool 'aapt2' }
    if (-not $aapt2) { Fail 'aapt2 not found (set -AndroidHome); refusing to package an APK whose debuggable flag cannot be proved' }
    $tree = (& $aapt2 dump xmltree $stagedApk --file AndroidManifest.xml 2>&1 | Out-String)
    if ($tree -match 'debuggable\(0x0101000f\)=true') {
        Fail 'staged APK has android:debuggable=true; refusing to package a debug build'
    }
    Say 'APK is not debuggable'
    $apkStaged = 'public/downloads/Codex-Turnloom.apk'
    Say ("staged APK {0} bytes (sha256 {1})" -f (Get-Item -LiteralPath $stagedApk).Length, $stagedHash)
}

# --------------------------------------------------------------- manifest --
$files = Get-ChildItem -LiteralPath $stage -Recurse -File | Sort-Object FullName
$lines = New-Object System.Collections.Generic.List[string]
$totalBytes = 0L
foreach ($file in $files) {
    if ($file.Name -eq 'VERSION.json') { continue }
    $relative = $file.FullName.Substring($stage.Length).TrimStart('\', '/') -replace '\\', '/'
    $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $lines.Add(($relative + "`0" + $hash))
    $totalBytes += $file.Length
}
$sha = [System.Security.Cryptography.SHA256]::Create()
try {
    $manifestDigest = -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(($lines -join "`n"))) | ForEach-Object { $_.ToString('x2') })
} finally { $sha.Dispose() }

$gitCommit = ''
try { $gitCommit = (& git -C $repoRoot rev-parse --short HEAD 2>$null) } catch { $gitCommit = '' }
if ($gitCommit -eq $null) { $gitCommit = '' }

$versionFile = [ordered]@{
    name           = 'codex-turnloom-server'
    version        = $Version
    appVersionName = $Version
    appVersionCode = $appVersionCode
    generatedAt    = (Get-Date).ToString('o')
    gitCommit      = ([string]$gitCommit).Trim()
    sha256         = $manifestDigest
    files          = [ordered]@{ count = $lines.Count; bytes = $totalBytes }
    apk            = $apkStaged
}
$versionJson = $versionFile | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText((Join-Path $stage 'VERSION.json'), $versionJson, (New-Object Text.UTF8Encoding($false)))

foreach ($relative in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $stage $relative))) { Fail "package is missing $relative" }
}

# ------------------------------------------------------------------- zip ---
if (-not (Test-Path -LiteralPath $OutDir)) { $null = New-Item -ItemType Directory -Path $OutDir -Force }
$zipName = "turnloom-$Version-server.zip"
$zipPath = Join-Path $OutDir $zipName
if ((Test-Path -LiteralPath $zipPath) -and -not $Force) { Fail "$zipPath exists; pass -Force" }
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)

$zipItem = Get-Item -LiteralPath $zipPath
$zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $OutDir ($zipName + '.sha256')), "$zipHash  $zipName`n", (New-Object Text.UTF8Encoding($false)))

Add-Type -AssemblyName System.IO.Compression
$probe = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try { $entryCount = $probe.Entries.Count } finally { $probe.Dispose() }
if ($entryCount -lt 40) { Fail "zip looks truncated ($entryCount entries)" }

Say ("built {0} ({1} bytes, {2} entries, sha256 {3})" -f $zipPath, $zipItem.Length, $entryCount, $zipHash)
Say ("version {0} / manifest {1} / apk {2}" -f $Version, $manifestDigest, ($(if ($apkStaged) { 'staged' } else { 'none' })))
Say 'next: copy the zip to the target machine and run update-turnloom.ps1 -PackageZip <zip>'
