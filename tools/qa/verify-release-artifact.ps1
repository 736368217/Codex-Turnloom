#requires -Version 5.1
<#
  Independent acceptance check for the 2.4.0 package (Atlas).
  Read-only: nothing is written except a temp extraction dir under the system temp.

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File .scratch/atlas-verify/verify-240.ps1 `
      -Apk dist-app\Codex-Turnloom-2.4.0-app-debug.apk `
      [-ServerZip dist-app\turnloom-2.4.0-server.zip]

  Assertions (each prints PASS/FAIL and the measured value):
    1. certificate SHA-256 == 2feb63c5...fa9c  (the release key; 2.3.0 install-compatible)
    2. exactly one signer
    3. assets/public/assets/ contains index-6HSyn9q4.js and NOT index-CNwWW75a.js
    4. that bundle's sha256 == 18d557ee...f476 (the build of commit e043b69)
    5. badging versionName=2.4.0 versionCode=99 package com.codex.turnloom.app
    6. optional: server zip embeds an APK with the same sha256
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Apk,
  [string]$ServerZip = '',
  [string]$SdkRoot = 'C:\Users\Administrator\tools\android-sdk',
  [string]$ExpectedCert = '2feb63c511cd725795cadc8fa890f9cbc754fe59c0bbfe0787ac33f94f44fa9c',
  [string]$ExpectedVersion = '2.4.0',
  [string]$ExpectedVersionCode = '99',
  [string]$ExpectedBundleSha256 = '18d557eeef3b49326a5212496aebac17fba5cb24ce2c99b43a1ac0cf3140f476',
  [string]$ExpectedBundleName = 'index-6HSyn9q4.js',
  [string]$StaleBundleName = 'index-CNwWW75a.js',
  # Optional: prove the bundle inside the APK is the blob that commit tracks.
  # The packaged bytes must be the committed bytes, not whatever the worktree held
  # when the APK was built.
  [string]$BundleCommitRef = '',
  # Optional: the commit the server zip must record in VERSION.json (the tag target).
  [string]$ExpectedCommit = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$results = New-Object System.Collections.Generic.List[object]
function Check([string]$name, [bool]$ok, [string]$detail) {
  $results.Add([pscustomobject]@{ Name = $name; Ok = $ok; Detail = $detail })
  $tag = if ($ok) { 'PASS' } else { 'FAIL' }
  Write-Host ("{0}  {1}  {2}" -f $tag, $name.PadRight(28), $detail)
}

if (-not (Test-Path -LiteralPath $Apk -PathType Leaf)) { throw "apk not found: $Apk" }
$apkFull = (Resolve-Path -LiteralPath $Apk).Path

$apkSigner = Join-Path $SdkRoot 'build-tools\35.0.0\apksigner.bat'
$aapt2 = Join-Path $SdkRoot 'build-tools\35.0.0\aapt2.exe'
foreach ($tool in @($apkSigner, $aapt2)) { if (-not (Test-Path -LiteralPath $tool)) { throw "missing tool: $tool" } }

# 1 + 2. Signature identity (the whole point of this run).
$certOut = & $apkSigner verify --print-certs $apkFull 2>&1 | Out-String
$digests = [regex]::Matches($certOut, 'certificate SHA-256 digest:\s*([0-9a-fA-F:]+)')
$signers = [regex]::Matches($certOut, 'Signer #\d+ certificate SHA-256 digest').Count
$certHex = if ($digests.Count -gt 0) { ($digests[0].Groups[1].Value -replace ':', '').ToLowerInvariant() } else { '' }
Check 'cert is release key' ([bool]$certHex -and $certHex -eq $ExpectedCert) $certHex
Check 'exactly one signer' ($signers -eq 1) "signers=$signers"

# 3 + 4. The web bundle inside the APK is the fixed build.
$tmp = Join-Path $env:TEMP ('atlas-verify-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($apkFull)
  try {
    $assetEntries = $zip.Entries | Where-Object { $_.FullName -like 'assets/public/assets/*' }
    $names = @($assetEntries | ForEach-Object { Split-Path $_.FullName -Leaf })
    $hasNew = $names -contains $ExpectedBundleName
    $hasOld = $names -contains $StaleBundleName
    Check 'new bundle present' $hasNew ($names -join ',')
    $staleDetail = 'ok'
    if ($hasOld) { $staleDetail = "$StaleBundleName still inside the APK" }
    Check 'stale bundle absent' (-not $hasOld) $staleDetail

    $entry = $assetEntries | Where-Object { (Split-Path $_.FullName -Leaf) -eq $ExpectedBundleName } | Select-Object -First 1
    if ($entry) {
      $outFile = Join-Path $tmp $ExpectedBundleName
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $outFile, $true)
      $bundleSha = (Get-FileHash -LiteralPath $outFile -Algorithm SHA256).Hash.ToLowerInvariant()
      $bundleSize = (Get-Item -LiteralPath $outFile).Length
      Check 'bundle sha256' ($bundleSha -eq $ExpectedBundleSha256) "$bundleSha ($bundleSize B)"
      if ($BundleCommitRef) {
        # The shipped bytes must be the committed bytes: an APK built from an
        # uncommitted asset swap looks perfect and leaves the tag without them.
        $repo = if ($PSScriptRoot) { (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path } else { (Get-Location).Path }
        $rel = "native-shell/app/src/main/assets/public/assets/$ExpectedBundleName"
        $commitBlob = (& git -C $repo rev-parse "$($BundleCommitRef):$rel" 2>$null)
        $diskBlob = (& git -C $repo hash-object --no-filters $outFile 2>$null)
        $sameBlob = [bool]$commitBlob -and [bool]$diskBlob -and ($commitBlob.Trim() -eq $diskBlob.Trim())
        Check 'bundle is the committed blob' $sameBlob "$($diskBlob.Trim()) vs $($commitBlob.Trim()) ($BundleCommitRef)"
      }
    } else {
      Check 'bundle sha256' $false 'bundle not found in APK'
    }
  } finally { $zip.Dispose() }
} finally {
  if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
}

# 5. Version identity.
$badging = & $aapt2 dump badging $apkFull 2>&1 | Out-String
$vn = [regex]::Match($badging, "versionName='([^']*)'").Groups[1].Value
$vc = [regex]::Match($badging, "versionCode='([^']*)'").Groups[1].Value
$pkg = [regex]::Match($badging, "package: name='([^']*)'").Groups[1].Value
Check 'version identity' ($vn -eq $ExpectedVersion -and $vc -eq $ExpectedVersionCode) "$pkg $vn ($vc)"

# 6. Optional: the server zip embeds the same APK bytes.
if ($ServerZip) {
  if (-not (Test-Path -LiteralPath $ServerZip -PathType Leaf)) { throw "server zip not found: $ServerZip" }
  $zipFull = (Resolve-Path -LiteralPath $ServerZip).Path
  $apkSha = (Get-FileHash -LiteralPath $apkFull -Algorithm SHA256).Hash.ToLowerInvariant()
  $tmp2 = Join-Path $env:TEMP ('atlas-verify-zip-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Path $tmp2 | Out-Null
  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $z2 = [IO.Compression.ZipFile]::OpenRead($zipFull)
    try {
      $inner = $z2.Entries | Where-Object { $_.FullName -like '*.apk' } | Select-Object -First 1
      if ($inner) {
        $innerFile = Join-Path $tmp2 'inner.apk'
        [IO.Compression.ZipFileExtensions]::ExtractToFile($inner, $innerFile, $true)
        $innerSha = (Get-FileHash -LiteralPath $innerFile -Algorithm SHA256).Hash.ToLowerInvariant()
        Check 'zip embeds same apk' ($innerSha -eq $apkSha) "$($inner.FullName) $innerSha"
      } else {
        Check 'zip embeds same apk' $false 'no .apk inside the server zip'
      }

      # 7. The zip's own VERSION.json: version identity + the commit it was built from.
      $metaEntry = $z2.Entries | Where-Object { $_.FullName -eq 'VERSION.json' } | Select-Object -First 1
      if ($metaEntry) {
        $metaFile = Join-Path $tmp2 'VERSION.json'
        [IO.Compression.ZipFileExtensions]::ExtractToFile($metaEntry, $metaFile, $true)
        $meta = (Get-Content -LiteralPath $metaFile -Raw | ConvertFrom-Json)
        $metaVersion = [string]$meta.version
        $metaCode = [string]$meta.appVersionCode
        $metaCommit = [string]$meta.gitCommit
        Check 'zip VERSION.json identity' ($metaVersion -eq $ExpectedVersion -and $metaCode -eq $ExpectedVersionCode) "version=$metaVersion code=$metaCode"
        if ($ExpectedCommit) {
          Check 'zip VERSION.json commit' ($metaCommit -eq $ExpectedCommit) "$metaCommit (expected $ExpectedCommit)"
        }
      } else {
        Check 'zip VERSION.json identity' $false 'VERSION.json missing from the server zip'
      }

      # 8. The update sidecar inside the zip must describe that same APK, not a stale one.
      $sideEntry = $z2.Entries | Where-Object { $_.FullName -like '*downloads\*.apk.release.json' } | Select-Object -First 1
      if ($sideEntry -and $innerSha) {
        $sideFile = Join-Path $tmp2 'sidecar.json'
        [IO.Compression.ZipFileExtensions]::ExtractToFile($sideEntry, $sideFile, $true)
        $side = (Get-Content -LiteralPath $sideFile -Raw | ConvertFrom-Json)
        $sideSha = [string]$side.sha256
        $sideBytes = [string]$side.sizeBytes
        $innerBytes = [string](Get-Item -LiteralPath $innerFile).Length
        $sideOk = ($sideSha -eq $innerSha) -and ($sideBytes -eq $innerBytes)
        Check 'zip sidecar matches apk' $sideOk "$($sideSha.Substring(0, 12))... $sideBytes B (apk $innerBytes B)"
      } elseif ($sideEntry) {
        Check 'zip sidecar matches apk' $false 'embedded apk was not hashed'
      } else {
        Check 'zip sidecar matches apk' $false 'release sidecar missing from the server zip'
      }
    } finally { $z2.Dispose() }
  } finally {
    if (Test-Path -LiteralPath $tmp2) { Remove-Item -LiteralPath $tmp2 -Recurse -Force }
  }
}

$failed = @($results | Where-Object { -not $_.Ok })
Write-Host ''
if ($failed.Count -eq 0) {
  Write-Host ("RESULT: PASS  ({0} checks)" -f $results.Count)
  exit 0
}
Write-Host ("RESULT: FAIL  ({0} of {1} checks)" -f $failed.Count, $results.Count)
$failed | ForEach-Object { Write-Host ("  - {0}: {1}" -f $_.Name, $_.Detail) }
exit 1
