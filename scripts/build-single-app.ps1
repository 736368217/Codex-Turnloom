#requires -Version 5.1
<#
.SYNOPSIS
  Single-line App build with authoritative staged release metadata.
.DESCRIPTION
  ASCII-only source for Windows PowerShell 5.1. Frontend dependencies are
  built only in the PI_SCRATCH_DIR build tree. Run this once after all app/
  and native-shell/ writers have finished. A release sidecar is written
  beside the exact staged APK only after every build/sign/badging check.
#>
[CmdletBinding()]
param(
    [string]$RepoRoot          = 'D:\pi11\11\Codex-Turnloom',
    [string]$FrontendBuildTree = (Join-Path $env:PI_SCRATCH_DIR 'app-build-tree'),
    [string]$Gradlew           = 'D:\pi11\11\Codex-Turnloom\native-shell\gradlew.bat',
    [string]$ZipAlign          = 'C:\Users\WIN10\AppData\Local\Android\Sdk\build-tools\35.0.0\zipalign.exe',
    [string]$ApkSigner         = 'C:\Users\WIN10\AppData\Local\Android\Sdk\build-tools\35.0.0\apksigner.bat',
    [string]$Aapt2             = 'C:\Users\WIN10\AppData\Local\Android\Sdk\build-tools\35.0.0\aapt2.exe',
    [string]$Adb               = 'C:\Users\WIN10\AppData\Local\Android\Sdk\platform-tools\adb.exe',
    [string]$Keystore          = 'C:\Users\WIN10\.android\debug.keystore',
    [string]$KeyAlias          = 'androiddebugkey',
    [string]$OutDir            = 'D:\pi11\11\Codex-Turnloom\dist-app',
    [string]$StagedApkPath     = '',
    [string]$ReleaseNotes      = '',
    [string]$NpmCmdPath        = 'npm.cmd',
    [string]$NodeCmd           = 'node.exe',
    [string]$GradleUserHome    = 'D:\HermesData\gradle',
    [string]$JavaHome          = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot',
    [string]$AndroidHome       = 'C:\Users\WIN10\AppData\Local\Android\Sdk',
    [string]$MuMuLease         = 'D:\Program Files\Netease\MuMu\mumu-patch-kit\mumu-lease.ps1',
    [string[]]$GradleArgs      = @(),
    [switch]$AllowDaemon
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
    param([string]$Path, [string]$Label)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { Fail "Missing tool: $Label ($Path)" }
}
function Resolve-CommandPath {
    param([string]$Command)
    $found = Get-Command $Command -ErrorAction SilentlyContinue
    if (-not $found) { Fail "Command not found: $Command" }
    if ($found.PSObject.Properties['Source'] -and $found.Source) { return [string]$found.Source }
    if ($found.PSObject.Properties['Definition'] -and $found.Definition) { return [string]$found.Definition }
    return $Command
}
function Assert-ScratchTree {
    param([string]$Root, [string]$Label)
    if (-not $env:PI_SCRATCH_DIR) { Fail 'PI_SCRATCH_DIR is required for a scratch-only build' }
    $scratchFull = [IO.Path]::GetFullPath($env:PI_SCRATCH_DIR).TrimEnd('\','/')
    $rootItem = Get-Item -LiteralPath $Root -Force
    if ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { Fail "$Label must not be a junction/symlink root: $Root" }
    $rootFull = [IO.Path]::GetFullPath($rootItem.FullName).TrimEnd('\','/')
    if (-not $rootFull.StartsWith($scratchFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        Fail "$Label must be contained by PI_SCRATCH_DIR: $Root"
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
    $p = Start-Process -FilePath $Aapt2 -ArgumentList @('dump','badging',$Apk) -WorkingDirectory $shellDir `
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

$startedAt = Get-Date
$repoFull = [IO.Path]::GetFullPath($RepoRoot).TrimEnd('\','/')
$appDir = Join-Path $repoFull 'app'
$shellDir = Join-Path $repoFull 'native-shell'
$publicAssets = Join-Path $shellDir 'app\src\main\assets\public'
$buildConfig = Join-Path $shellDir 'app\build.gradle.kts'
$gradleText = [IO.File]::ReadAllText($buildConfig)
$configuredPackage = [regex]::Match($gradleText, 'applicationId\s*=\s*"([^"]+)"').Groups[1].Value
$versionName = [regex]::Match($gradleText, 'versionName\s*=\s*"([^"]+)"').Groups[1].Value
$versionCodeText = [regex]::Match($gradleText, 'versionCode\s*=\s*(\d+)').Groups[1].Value
if (-not $configuredPackage -or -not $versionName -or -not $versionCodeText) { Fail 'native-shell/app/build.gradle.kts lacks package/version identity' }
$versionCode = [int]$versionCodeText
# Output name follows native-shell/app/build.gradle.kts versionName.
$apkName = "Codex-Turnloom-$versionName-app.apk"
$finalApk = Join-Path $OutDir $apkName
$treeFull = Assert-ScratchTree -Root $FrontendBuildTree -Label 'FrontendBuildTree'
$captureRoot = Join-Path $treeFull 'tool-capture'
$captureDir = Join-Path $captureRoot ('build-' + $startedAt.ToString('yyyyMMdd-HHmmss'))
$script:CaptureDir = $captureDir
$null = New-Item -ItemType Directory -Path $captureDir -Force
$treeDist = Join-Path $treeFull 'dist'
$unsignedDir = Join-Path $shellDir 'app\build\outputs\apk\release'
$unsignedApk = Join-Path $unsignedDir 'app-release-unsigned.apk'
$alignedApk = Join-Path $captureDir ($apkName + '.aligned.tmp')
$hashFile = "$finalApk.sha256"
$buildManifest = Join-Path $OutDir ('build-manifest-' + $versionName + '.json')

$resolvedNpm = Resolve-CommandPath -Command $NpmCmdPath
$resolvedNode = Resolve-CommandPath -Command $NodeCmd
if (-not $env:TURNLOOM_STORE_PASS) { Fail 'Set TURNLOOM_STORE_PASS (never pass passwords on the command line)' }
if (-not $env:TURNLOOM_KEY_PASS) { Fail 'Set TURNLOOM_KEY_PASS (never pass passwords on the command line)' }
$env:GRADLE_USER_HOME = $GradleUserHome
$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $AndroidHome
$env:ANDROID_SDK_ROOT = $AndroidHome
foreach ($p in @(@('Gradlew',$Gradlew),@('ZipAlign',$ZipAlign),@('ApkSigner',$ApkSigner),@('Aapt2',$Aapt2),@('Adb',$Adb),@('Keystore',$Keystore))) { Assert-Tool -Path $p[1] -Label $p[0] }
if (-not (Test-Path -LiteralPath $appDir -PathType Container)) { Fail "Missing app/: $appDir" }
if (-not (Test-Path -LiteralPath $shellDir -PathType Container)) { Fail "Missing native-shell/: $shellDir" }
if (-not (Test-Path -LiteralPath (Join-Path $treeFull 'node_modules') -PathType Container)) { Fail "Scratch tree needs preinstalled node_modules: $treeFull" }
if (Test-Path -LiteralPath $finalApk) { Fail "Refusing to overwrite existing output: $finalApk" }
if ($GradleArgs.Count -eq 0) {
    $GradleArgs = @('assembleRelease','--no-daemon','--console=plain')
} else {
    if (-not ($GradleArgs -contains '--no-daemon')) { $GradleArgs += '--no-daemon' }
    if (-not ($GradleArgs -contains '--console=plain')) { $GradleArgs += '--console=plain' }
}
if ($AllowDaemon -and ($GradleArgs -contains '--no-daemon')) {
    $GradleArgs = @($GradleArgs | Where-Object { $_ -ne '--no-daemon' })
}

$steps = New-Object System.Collections.ArrayList
function Step { param([string]$Name,[string]$Status,[string]$Detail='') $null = $steps.Add([ordered]@{name=$Name;status=$Status;detail=$Detail}) }
function Write-FailureManifest {
    param([string]$Message)
    try {
        if (-not (Test-Path -LiteralPath $OutDir)) { $null = New-Item -ItemType Directory -Path $OutDir -Force }
        Step 'failed' 'error' $Message
        $failed = [ordered]@{ generatedAt=(Get-Date).ToString('o'); result='FAILED'; versionName=$versionName; versionCode=$versionCode; error=$Message; steps=@($steps.ToArray()) }
        WriteUtf8NoBom -Path $buildManifest -Text (($failed | ConvertTo-Json -Depth 8) + "`n")
    } catch { }
}

Say "Building $apkName from native config $versionName / $versionCode"
try {
    Say '1/7 validate source trees and toolchain'
    Step 'validate' 'ok' "$repoFull / $treeFull"
    Say '2/7 clean scratch mirror (no npm install in worktree)'
    Clear-ScratchChildren -Root $treeFull
    if (Test-Path -LiteralPath $treeDist) { Remove-Item -LiteralPath $treeDist -Recurse -Force }
    foreach ($item in (Get-ChildItem -LiteralPath $appDir -Force)) {
        Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $treeFull $item.Name) -Recurse -Force
    }
    Step 'sync-source' 'ok' $treeFull
    Say '3/7 build frontend in scratch'
    Invoke-Tool -Tool $resolvedNpm -ToolArgs @('run','build','--prefix',$treeFull) -WorkDir $repoFull -Label 'vite-build'
    $indexHtml = Join-Path $treeDist 'index.html'
    if (-not (Test-Path -LiteralPath $indexHtml)) { Fail 'dist/index.html was not produced' }
    $indexText = [IO.File]::ReadAllText($indexHtml, [Text.Encoding]::UTF8).TrimStart([char]0xFEFF)
    if ([regex]::Matches($indexText, '(?:src|href)\s*=\s*["'']/(?!/)').Count -gt 0) { Fail 'Vite base must be ./ for the local packaged page' }
    Step 'vite-build' 'ok' "dist/index.html base='./'"
    Say '4/7 replace generated WebView assets'
    if (-not (Test-Path -LiteralPath $publicAssets)) { $null = New-Item -ItemType Directory -Path $publicAssets -Force }
    foreach ($old in (Get-ChildItem -LiteralPath $publicAssets -Force)) { Remove-Item -LiteralPath $old.FullName -Recurse -Force }
    foreach ($item in (Get-ChildItem -LiteralPath $treeDist -Force)) { Copy-Item -LiteralPath $item.FullName -Destination $publicAssets -Recurse -Force }
    if (-not (Test-Path -LiteralPath (Join-Path $publicAssets 'index.html'))) { Fail 'Generated assets lack index.html' }
    Step 'copy-assets' 'ok' $publicAssets
    Say '5/7 gradle assembleRelease (windowless, controlled exit)'
    if (Test-Path -LiteralPath $unsignedApk) { Remove-Item -LiteralPath $unsignedApk -Force }
    Invoke-Tool -Tool $Gradlew -ToolArgs $GradleArgs -WorkDir $shellDir -Label 'assembleRelease'
    if (-not (Test-Path -LiteralPath $unsignedApk)) { Fail "Missing unsigned APK: $unsignedApk" }
    Step 'assembleRelease' 'ok' $unsignedApk
    if (-not (Test-Path -LiteralPath $OutDir)) { $null = New-Item -ItemType Directory -Path $OutDir -Force }
    Say '6/7 zipalign -> apksigner sign -> verify -> badging'
    if (Test-Path -LiteralPath $alignedApk) { Remove-Item -LiteralPath $alignedApk -Force }
    Invoke-Tool -Tool $ZipAlign -ToolArgs @('-p','4',$unsignedApk,$alignedApk) -WorkDir $shellDir -Label 'zipalign'
    Step 'zipalign' 'ok' '-p 4'
    # apksigner reads both passwords directly from environment variables.
    # No password appears in a command line, generated script, or log.
    Invoke-Tool -Tool $ApkSigner -ToolArgs @(
        'sign','--ks',$Keystore,'--ks-key-alias',$KeyAlias,
        '--ks-pass','env:TURNLOOM_STORE_PASS','--key-pass','env:TURNLOOM_KEY_PASS',
        '--v1-signing-enabled','true','--v2-signing-enabled','true','--v3-signing-enabled','true',
        '--out',$finalApk,$alignedApk
    ) -WorkDir $shellDir -Label 'apksigner-sign'
    Step 'apksigner-sign' 'ok' 'v1/v2/v3'
    Invoke-Tool -Tool $ApkSigner -ToolArgs @('verify','--verbose','--print-certs',$finalApk) -WorkDir $shellDir -Label 'apksigner-verify'
    Step 'apksigner-verify' 'ok' 'v2/v3'
    $identity = Assert-Badging -Apk $finalApk
    if ($identity.applicationId -ne $configuredPackage -or $identity.versionName -ne $versionName -or [string]$identity.versionCode -ne [string]$versionCode) {
        Fail "Badging identity disagrees with native build config: $($identity.applicationId)/$($identity.versionName)/$($identity.versionCode)"
    }
    Step 'aapt2-badging' 'ok' "$($identity.applicationId)/$($identity.versionName)/$($identity.versionCode)"
    Say '7/7 write versioned build artifacts and stage release metadata'
    $hash = (Get-FileHash -LiteralPath $finalApk -Algorithm SHA256).Hash.ToLowerInvariant()
    $size = (Get-Item -LiteralPath $finalApk).Length
    WriteUtf8NoBom -Path $hashFile -Text ("$hash  $apkName`n")
    $manifest = [ordered]@{
        generatedAt=(Get-Date).ToString('o'); startedAt=$startedAt.ToString('o')
        result='ok'; route='dom-shell'; packageName=$configuredPackage
        versionName=$versionName; versionCode=$versionCode; apkName=$apkName
        sha256=$hash; sizeBytes=$size; notes=$ReleaseNotes
        identity=$identity; buildSteps=@($steps.ToArray())
        apk=[ordered]@{ name=$apkName; path=$finalApk; bytes=$size; sha256=$hash }
        entryUrl='file:///android_asset/public/index.html'
        gradleArgs=$GradleArgs
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
            schema='turnloom-app-release/1'; generatedAt=(Get-Date).ToString('o')
            packageName=$configuredPackage; versionName=$versionName; versionCode=$versionCode
            apkName=(Split-Path -Leaf $stagedFull); apkPath=$stagedFull
            sha256=$hash; sizeBytes=$size; notes=$ReleaseNotes
            artifactSha256=$hash; artifactSizeBytes=$size
            identity=$identity
            apk=[ordered]@{ name=(Split-Path -Leaf $stagedFull); bytes=$size; sha256=$hash }
            buildSteps=@($steps.ToArray()); sourceBuildManifest=$buildManifest
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
}
