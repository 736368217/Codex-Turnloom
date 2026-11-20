#requires -Version 5.1
<#
.SYNOPSIS
  Put one built APK on emulator-5554, launch it, keep a screenshot trail and a
  logcat error scan. The device half of a release smoke; it asserts nothing
  about the UI - screenshots are the evidence a human (or another agent) reads.

.DESCRIPTION
  ASCII-only source: Windows PowerShell 5.1 decodes BOM-less .ps1 as the system
  code page, and full-width punctuation in comments has swallowed newlines here
  before. Keep it ASCII.

  The emulator is shared, so this never starts one by default unless it is
  missing and -StartEmulator is passed. adb targets exactly $Serial; it never
  falls back to "any attached device" (a phone may be plugged in and must not
  be touched).

.PARAMETER Apk
  Path to the built APK (dist-app\Codex-Turnloom-<version>-app-debug.apk).

.PARAMETER ExpectVersionName
  Optional. When set, the installed package's versionName is read back from
  dumpsys and the script fails when it differs.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\smoke-app-device.ps1 `
    -Apk dist-app\Codex-Turnloom-2.3.0-app-debug.apk -ExpectVersionName 2.3.0
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Apk,
    [string]$Serial = 'emulator-5554',
    [string]$Avd = 'paopao_api33',
    [string]$PackageName = 'com.codex.turnloom.app',
    [string]$OutDir = '',
    [string[]]$ShotLabels = @('launch'),
    [switch]$StartEmulator,
    [switch]$QaDebug,
    [int]$BootTimeoutSeconds = 180,
    [int]$LogcatTail = 600
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

function Fail([string]$Message) {
    Write-Host "[smoke] FAIL: $Message"
    exit 1
}

function Say([string]$Message) {
    Write-Host "[smoke] $Message"
}

function Find-FirstTool([string[]]$Candidates) {
    foreach ($candidate in $Candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    return $null
}

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $repoRoot '.scratch\rhea\smoke' }
if (-not (Test-Path -LiteralPath $OutDir)) { $null = New-Item -ItemType Directory -Path $OutDir -Force }

$apkFull = (Resolve-Path -LiteralPath $Apk -ErrorAction SilentlyContinue)
if (-not $apkFull) { Fail "APK not found: $Apk" }

$sdkRoot = [Environment]::GetEnvironmentVariable('ANDROID_HOME')
if (-not $sdkRoot) { $sdkRoot = [Environment]::GetEnvironmentVariable('ANDROID_SDK_ROOT') }
if (-not $sdkRoot) { $sdkRoot = Join-Path $env:USERPROFILE 'tools\android-sdk' }

$adb = Find-FirstTool @(
    (Join-Path $env:USERPROFILE 'tools\platform-tools\adb.exe'),
    (Join-Path $sdkRoot 'platform-tools\adb.exe')
)
if (-not $adb) { Fail 'adb.exe not found (set ANDROID_HOME or install platform-tools)' }

$emulator = Find-FirstTool @((Join-Path $sdkRoot 'emulator\emulator.exe'))

function Get-DeviceState {
    $lines = & $adb devices 2>&1
    foreach ($line in $lines) {
        if ($line -match "^$([regex]::Escape($Serial))\s+(\S+)") { return $Matches[1] }
    }
    return ''
}

function Start-EmulatorIfNeeded {
    $state = Get-DeviceState
    if ($state -eq 'device') { return }
    if ($state) { Fail "$Serial is '$state', not ready (another owner may be using it)" }
    if (-not $StartEmulator) { Fail "$Serial is not running. Start it or pass -StartEmulator" }
    if (-not $emulator) { Fail 'emulator.exe not found' }
    $log = Join-Path $OutDir 'emulator.log'
    $err = Join-Path $OutDir 'emulator-error.log'
    Say "starting $Avd (headless)"
    Start-Process -FilePath $emulator -ArgumentList @(
        '-avd', $Avd, '-no-window', '-no-audio', '-no-boot-anim', '-no-snapshot-save'
    ) -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $err | Out-Null
}

function Wait-Boot {
    $deadline = (Get-Date).AddSeconds($BootTimeoutSeconds)
    Say "waiting for boot (<= $BootTimeoutSeconds s)"
    while ((Get-Date) -lt $deadline) {
        $state = Get-DeviceState
        if ($state -eq 'device') {
            $booted = (& $adb -s $Serial shell getprop sys.boot_completed 2>&1) -join ''
            if ($booted.Trim() -eq '1') { return }
        }
        Start-Sleep -Seconds 3
    }
    Fail "emulator did not finish booting in $BootTimeoutSeconds s"
}

function Invoke-Adb([string[]]$Arguments) {
    $output = & $adb -s $Serial @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        Fail ("adb {0} exited {1}: {2}" -f ($Arguments -join ' '), $LASTEXITCODE, ($output -join ' '))
    }
    return $output
}

function Save-Shot([string]$Label) {
    $stamp = Get-Date -Format 'HHmmss'
    $path = Join-Path $OutDir ("{0}-{1}.png" -f $Label, $stamp)
    # screencap on-device then pull: PowerShell 5.1 mangles binary through a
    # native pipe, so "exec-out ... > file" is not safe here.
    Invoke-Adb @('shell', 'screencap', '-p', '/data/local/tmp/turnloom-smoke.png') | Out-Null
    $pull = & $adb -s $Serial pull '/data/local/tmp/turnloom-smoke.png' $path 2>&1
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $path)) {
        Fail ("screencap pull failed for {0}: {1}" -f $Label, ($pull -join ' '))
    }
    & $adb -s $Serial shell rm -f '/data/local/tmp/turnloom-smoke.png' | Out-Null
    if ((Get-Item -LiteralPath $path).Length -lt 1024) { Fail "screenshot $path is suspiciously small" }
    Say "shot: $path"
    return $path
}

Start-EmulatorIfNeeded
Wait-Boot

Say ("installing " + (Split-Path -Leaf $apkFull.Path) + " (" + (Get-Item -LiteralPath $apkFull.Path).Length + " bytes)")
$install = Invoke-Adb @('install', '-r', $apkFull.Path)
if (($install -join ' ') -notmatch 'Success') { Fail ("install did not report Success: " + ($install -join ' ')) }

if ($PSBoundParameters.ContainsKey('ExpectVersionName')) {
    $dump = Invoke-Adb @('shell', 'dumpsys', 'package', $PackageName)
    $match = ($dump -join "`n") | Select-String -Pattern 'versionName=(\S+)' | Select-Object -First 1
    if (-not $match) { Fail "could not read versionName for $PackageName" }
    $installed = $match.Matches[0].Groups[1].Value
    if ($installed -ne $ExpectVersionName) { Fail "installed versionName '$installed' != expected '$ExpectVersionName'" }
    Say "versionName: $installed"
}

& $adb -s $Serial logcat -c | Out-Null
$launchArgs = @('shell', 'am', 'start', '-n', "$PackageName/.MainActivity")
if ($QaDebug) { $launchArgs += @('--ez', 'turnloom.qaDebug', 'true') }
Invoke-Adb $launchArgs | Out-Null
Start-Sleep -Seconds 6

foreach ($label in $ShotLabels) { $null = Save-Shot $label }

$log = (& $adb -s $Serial logcat -d -t $LogcatTail 2>&1) -join "`n"
$logPath = Join-Path $OutDir ('logcat-' + (Get-Date -Format 'HHmmss') + '.txt')
[IO.File]::WriteAllText($logPath, $log)
$bad = $log -split "`n" | Where-Object {
    $_ -match 'FATAL EXCEPTION|Uncaught (Type|Reference|Range)Error|\bTypeError:|\bReferenceError:' -and
    $_ -notmatch 'libc|debuggerd'
}
if ($bad) {
    Say ("logcat errors (" + $bad.Count + "):")
    $bad | ForEach-Object { Write-Host ("  " + $_.Trim()) }
} else {
    Say 'logcat: no fatal / uncaught errors'
}
Say ("logcat saved: " + $logPath)
Say 'done'
