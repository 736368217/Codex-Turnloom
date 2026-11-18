#requires -Version 5.1
<#
.SYNOPSIS
  Apply a Codex-Turnloom server upgrade package on this machine.

.DESCRIPTION
  ASCII-only source for Windows PowerShell 5.1. Safe by construction:

    1. read the install from %LOCALAPPDATA%\CodexPocket\config.json
    2. verify the package (VERSION.json, required files, manifest digest)
    3. zip the current install to <root>.backup-<timestamp>.zip
    4. stop this install's server + gateway processes
    5. overlay the package files on the existing install
    6. restart through the supervisor (or start it), then read
       /api/health.version and /api/app/update-public.versionName back
    7. on any failure: restore the backup, restart, re-verify, exit 1

  It never touches node_modules, Codex Desktop data, config.json, machine.json
  or any file outside -TargetRoot.

.PARAMETER PackageZip
  turnloom-<version>-server.zip produced by scripts/package-server-upgrade.ps1.

.PARAMETER TargetRoot
  Install root to upgrade. Defaults to config.json repoRoot, then to the
  current directory when it holds server.js + server\machine-gateway.cjs.

.PARAMETER ConfigPath
  Defaults to %LOCALAPPDATA%\CodexPocket\config.json.

.PARAMETER SkipRestart
  Copy files only; do not stop, restart or verify a running server.

.PARAMETER SkipDependencies
  Do not check node_modules for package.json dependencies.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\update-turnloom.ps1 -PackageZip .\turnloom-2.2.1-server.zip
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PackageZip,
    [string]$TargetRoot = '',
    [string]$ConfigPath = '',
    [string]$UpdateSource = '',
    [string]$DesktopRelease = '',
    [switch]$SkipRestart,
    [switch]$SkipDependencies
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$script:steps = New-Object System.Collections.Generic.List[object]
function Say([string]$Message) { Write-Host "[turnloom-update] $Message" }
function Step([string]$Name, [string]$Status, [string]$Detail = '') {
    $script:steps.Add([ordered]@{ name = $Name; status = $Status; detail = $Detail })
    Say ("  {0,-18} {1} {2}" -f $Name, $Status, $Detail)
}

if (-not $ConfigPath) {
    $ConfigPath = Join-Path $env:LOCALAPPDATA 'CodexPocket\config.json'
}

function Read-Config {
    if (Test-Path -LiteralPath $ConfigPath -PathType Leaf) {
        try { return Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { throw "config.json is not readable: $ConfigPath" }
    }
    return $null
}

function Get-ProcessTable {
    return @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'electron.exe' OR Name = 'powershell.exe' OR Name = 'pwsh.exe'" -ErrorAction SilentlyContinue)
}

function Stop-ManagedProcesses([string]$Root) {
    $killed = 0
    foreach ($process in (Get-ProcessTable)) {
        # Only node can be the server/gateway; never the shell that runs this script.
        if ($process.ProcessId -eq $PID -or $process.Name -ne 'node.exe') { continue }
        $commandLine = [string]$process.CommandLine
        if (-not $commandLine) { continue }
        if ($commandLine.IndexOf($Root, [StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
        if ($commandLine -notmatch 'server\.js|machine-gateway\.cjs') { continue }
        try { Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop; $killed += 1 } catch { }
    }
    return $killed
}

function Stop-Supervisor([string]$Root, [string]$Config) {
    $stopped = 0
    foreach ($process in (Get-ProcessTable)) {
        if ($process.ProcessId -eq $PID) { continue }
        $commandLine = [string]$process.CommandLine
        if (-not $commandLine) { continue }
        if ($commandLine -notmatch 'windows-supervisor\.ps1') { continue }
        $ownsRoot = $commandLine.IndexOf($Root, [StringComparison]::OrdinalIgnoreCase) -ge 0
        $ownsConfig = $Config -and $commandLine.IndexOf($Config, [StringComparison]::OrdinalIgnoreCase) -ge 0
        if (-not ($ownsRoot -or $ownsConfig)) { continue }
        try { Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop; $stopped += 1 } catch { }
    }
    return $stopped
}

function Test-Supervisor([string]$Root) {
    foreach ($process in (Get-ProcessTable)) {
        $commandLine = [string]$process.CommandLine
        if ($commandLine -and $commandLine -match 'windows-supervisor\.ps1' -and $commandLine.IndexOf($Root, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
    }
    return $false
}

function Start-Supervisor([string]$Root) {
    $supervisor = Join-Path $Root 'scripts\windows-supervisor.ps1'
    if (-not (Test-Path -LiteralPath $supervisor -PathType Leaf)) { throw "supervisor missing: $supervisor" }
    Start-Process -FilePath 'powershell.exe' `
        -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', $supervisor, '-ConfigPath', $ConfigPath) `
        -WindowStyle Hidden | Out-Null
}

function Get-Health([int]$Port, [string]$AccessCode) {
    $uri = "http://127.0.0.1:$Port/api/health"
    $headers = @{}
    if ($AccessCode) { $headers['x-access-token'] = $AccessCode }
    try { return Invoke-RestMethod -Uri $uri -Headers $headers -TimeoutSec 3 -ErrorAction Stop } catch { return $null }
}

function Wait-Health([int]$Port, [string]$AccessCode, [int]$Seconds = 45) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        $health = Get-Health -Port $Port -AccessCode $AccessCode
        if ($health) { return $health }
        Start-Sleep -Milliseconds 1500
    }
    return $null
}

function Get-InstalledVersion([string]$Root) {
    $versionFile = Join-Path $Root 'VERSION.json'
    if (Test-Path -LiteralPath $versionFile -PathType Leaf) {
        try { return [string](Get-Content -LiteralPath $versionFile -Raw -Encoding UTF8 | ConvertFrom-Json).version } catch { }
    }
    $packageFile = Join-Path $Root 'package.json'
    if (Test-Path -LiteralPath $packageFile -PathType Leaf) {
        try { return [string](Get-Content -LiteralPath $packageFile -Raw -Encoding UTF8 | ConvertFrom-Json).version } catch { }
    }
    return ''
}

function Backup-Install([string]$Root) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backup = "$Root.backup-$stamp.zip"
    $skip = @('node_modules', '.git', '.scratch', 'logs')
    $items = @(Get-ChildItem -LiteralPath $Root -Force | Where-Object { $skip -notcontains $_.Name })
    if ($items.Count -eq 0) { throw "nothing to back up under $Root" }
    if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::Open($backup, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($item in $items) {
            foreach ($file in (Get-ChildItem -LiteralPath $item.FullName -Recurse -File -Force -ErrorAction SilentlyContinue)) {
                $relative = $file.FullName.Substring($Root.Length).TrimStart('\', '/')
                if ($relative -match '^(\.scratch|\.git|node_modules)\\') { continue }
                $null = [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, ($relative -replace '\\', '/'), [System.IO.Compression.CompressionLevel]::Fastest)
            }
        }
    } finally { $zip.Dispose() }
    $size = (Get-Item -LiteralPath $backup).Length
    if ($size -lt 1024) { throw "backup looks empty: $backup" }
    return [pscustomobject]@{ Path = $backup; Bytes = $size }
}

function Restore-Install([string]$BackupZip, [string]$Root) {
    # Windows PowerShell 5.1 runs on .NET Framework, where
    # ZipFile.ExtractToDirectory(zip, dir, overwrite) does not exist yet; extract
    # entry by entry so a rollback works on the same OS the package targets.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($BackupZip)
    try {
        foreach ($entry in $zip.Entries) {
            if ($entry.FullName.EndsWith('/')) { continue }
            $destination = Join-Path $Root ($entry.FullName -replace '/', '\')
            $directory = Split-Path -Parent $destination
            if (-not (Test-Path -LiteralPath $directory)) { $null = New-Item -ItemType Directory -Path $directory -Force }
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $true)
        }
    } finally { $zip.Dispose() }
}

function Copy-Overlay([string]$Source, [string]$Root, [string[]]$Exclude) {
    $copied = 0
    foreach ($file in (Get-ChildItem -LiteralPath $Source -Recurse -File -Force)) {
        $relative = $file.FullName.Substring($Source.Length).TrimStart('\', '/')
        $skip = $false
        foreach ($pattern in $Exclude) { if ($relative -like $pattern) { $skip = $true; break } }
        if ($skip) { continue }
        $destination = Join-Path $Root $relative
        $directory = Split-Path -Parent $destination
        if (-not (Test-Path -LiteralPath $directory)) { $null = New-Item -ItemType Directory -Path $directory -Force }
        Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
        $copied += 1
    }
    return $copied
}

function Assert-Dependencies([string]$Root) {
    $packageFile = Join-Path $Root 'package.json'
    if (-not (Test-Path -LiteralPath $packageFile -PathType Leaf)) { return 'no package.json' }
    $package = Get-Content -LiteralPath $packageFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $missing = @()
    if ($package.PSObject.Properties.Name -contains 'dependencies') {
        foreach ($name in $package.dependencies.PSObject.Properties.Name) {
            if (-not (Test-Path -LiteralPath (Join-Path $Root ('node_modules\' + $name)) -PathType Container)) { $missing += $name }
        }
    }
    if ($missing.Count -eq 0) { return 'complete' }
    $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue)
    if (-not $npm) { throw ("node_modules is missing {0} and npm is not on PATH" -f ($missing -join ', ')) }
    Say ("installing missing dependencies: {0}" -f ($missing -join ', '))
    & $npm.Source ci --omit=dev --prefix $Root
    if ($LASTEXITCODE -ne 0) { throw 'npm ci --omit=dev failed' }
    return 'installed'
}

# ------------------------------------------------------------------ preflight
$zipPath = [IO.Path]::GetFullPath($PackageZip)
if (-not (Test-Path -LiteralPath $zipPath -PathType Leaf)) { throw "package not found: $zipPath" }
$packageHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
Say ("package {0}" -f $zipPath)
Say ("sha256  {0}" -f $packageHash)

$config = Read-Config
if (-not $TargetRoot) {
    if ($config -and $config.repoRoot) { $TargetRoot = [string]$config.repoRoot }
    elseif (Test-Path -LiteralPath (Join-Path $PWD 'server.js') -PathType Leaf) { $TargetRoot = $PWD.Path }
    else { throw 'no -TargetRoot, config.json has no repoRoot, and the current directory is not an install' }
}
$TargetRoot = [IO.Path]::GetFullPath($TargetRoot).TrimEnd('\', '/')
if (-not (Test-Path -LiteralPath (Join-Path $TargetRoot 'server.js') -PathType Leaf)) {
    throw "$TargetRoot does not look like an install (server.js missing)"
}

$port = 0
$accessCode = ''
if ($config) {
    if ($config.port) { $port = [int]$config.port }
    if ($config.accessCode) { $accessCode = [string]$config.accessCode }
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('turnloom-update-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $work -Force
$backup = $null
$oldVersion = Get-InstalledVersion -Root $TargetRoot

try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $work)
    $versionFile = Join-Path $work 'VERSION.json'
    if (-not (Test-Path -LiteralPath $versionFile -PathType Leaf)) { throw 'package has no VERSION.json' }
    $versionData = Get-Content -LiteralPath $versionFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $newVersion = [string]$versionData.version
    if (-not $newVersion) { throw 'VERSION.json has no version' }
    foreach ($required in @('server.js', 'package.json', 'update-turnloom.ps1', 'server\request-log.cjs', 'server\machine-gateway.cjs')) {
        if (-not (Test-Path -LiteralPath (Join-Path $work $required))) { throw "package is missing $required" }
    }
    Step 'package' 'ok' ("version {0} -> {1}" -f $oldVersion, $newVersion)
    if ($oldVersion -eq $newVersion) { Say 'the target already reports this version; files will still be refreshed' }

    $backup = Backup-Install -Root $TargetRoot
    Step 'backup' 'ok' ("{0} ({1} bytes)" -f $backup.Path, $backup.Bytes)

    if (-not $SkipRestart) {
        # The supervisor restarts a dead server within its poll interval, so it must
        # stop before the overlay; otherwise it can relaunch half-copied code.
        $stoppedSupervisors = Stop-Supervisor -Root $TargetRoot -Config $ConfigPath
        $killed = Stop-ManagedProcesses -Root $TargetRoot
        Step 'stop' 'ok' ("$killed process(es), $stoppedSupervisors supervisor(s)")
    }

    # A package that carries the phone APK replaces the one this host serves at
    # /api/apk; keep the previous bytes so a bad APK is one rename away from gone.
    $packageApk = Join-Path $work 'public\downloads\Codex-Turnloom.apk'
    $packageSidecar = "$packageApk.release.json"
    $stagedAppVersion = $null
    if ((Test-Path -LiteralPath $packageApk -PathType Leaf) -and (Test-Path -LiteralPath $packageSidecar -PathType Leaf)) {
        $sidecar = Get-Content -LiteralPath $packageSidecar -Raw -Encoding UTF8 | ConvertFrom-Json
        $stagedAppVersion = [string]$sidecar.versionName
        $downloads = Join-Path $TargetRoot 'public\downloads'
        if (-not (Test-Path -LiteralPath $downloads)) { $null = New-Item -ItemType Directory -Path $downloads -Force }
        $stamp2 = Get-Date -Format 'yyyyMMdd-HHmmss'
        foreach ($name in @('Codex-Turnloom.apk', 'Codex-Turnloom.apk.release.json')) {
            $existing = Join-Path $downloads $name
            if (Test-Path -LiteralPath $existing -PathType Leaf) {
                Copy-Item -LiteralPath $existing -Destination ("$existing.bak-$stamp2") -Force
            }
        }
        Step 'apk-bundle' 'ok' ("staged {0} {1}" -f $stagedAppVersion, ([string]$sidecar.versionCode))
    }

    $copied = Copy-Overlay -Source $work -Root $TargetRoot -Exclude @()
    Step 'copy' 'ok' ("$copied file(s)")

    if (-not $SkipDependencies) {
        $dependencyState = Assert-Dependencies -Root $TargetRoot
        Step 'dependencies' 'ok' $dependencyState
    }

    if ($DesktopRelease) {
        $releaseFile = [IO.Path]::GetFullPath($DesktopRelease)
        if (-not (Test-Path -LiteralPath $releaseFile -PathType Leaf)) { throw "release manifest not found: $releaseFile" }
        $manifestText = Get-Content -LiteralPath $releaseFile -Raw -Encoding UTF8
        $null = $manifestText | ConvertFrom-Json
        $releaseDir = Join-Path $TargetRoot 'public\downloads'
        if (-not (Test-Path -LiteralPath $releaseDir)) { $null = New-Item -ItemType Directory -Path $releaseDir -Force }
        [IO.File]::WriteAllText((Join-Path $releaseDir 'desktop-release.json'), $manifestText, (New-Object Text.UTF8Encoding($false)))
        Step 'release-manifest' 'ok' 'public\downloads\desktop-release.json'
    }

    if ($UpdateSource) {
        if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) { throw "-UpdateSource needs an existing config.json: $ConfigPath" }
        $configText = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8
        $configObject = $configText | ConvertFrom-Json
        $existing = $null
        if ($configObject.PSObject.Properties.Name -contains 'updateSource') { $existing = $configObject.updateSource }
        if ($existing -and $existing.PSObject) {
            $existing | Add-Member -NotePropertyName desktop -NotePropertyValue $UpdateSource -Force
        } else {
            $configObject | Add-Member -NotePropertyName updateSource -NotePropertyValue ([pscustomobject]@{ desktop = $UpdateSource }) -Force
        }
        $configBackup = "$ConfigPath.bak-" + (Get-Date -Format 'yyyyMMdd-HHmmss')
        Copy-Item -LiteralPath $ConfigPath -Destination $configBackup -Force
        [IO.File]::WriteAllText($ConfigPath, ($configObject | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
        Step 'update-source' 'ok' ("desktop -> {0}" -f $UpdateSource)
    }

    if ($SkipRestart) {
        Step 'restart' 'skipped' '-SkipRestart'
        Step 'verify' 'skipped' '-SkipRestart'
        Say 'files replaced; start the console/supervisor yourself when ready'
        exit 0
    }

    $supervising = Test-Supervisor -Root $TargetRoot
    if ($supervising) {
        Step 'restart' 'ok' 'existing supervisor restarts the server'
    } elseif ($config) {
        Start-Supervisor -Root $TargetRoot
        Step 'restart' 'ok' 'supervisor started from the upgraded install'
    } else {
        Step 'restart' 'manual' 'no config.json: open the Codex-Turnloom console to start the server'
    }

    if (-not $port) {
        Step 'verify' 'skipped' 'no port in config.json'
        exit 0
    }

    $health = Wait-Health -Port $port -AccessCode $accessCode
    if (-not $health) { throw "the server did not answer on port $port after the upgrade" }
    $served = ''
    if ($health.PSObject.Properties.Name -contains 'version') { $served = [string]$health.version }
    if (-not $served) {
        if ($health.PSObject.Properties.Name -contains 'appVersionName') { $served = [string]$health.appVersionName }
    }
    if (-not $served) { throw 'the running server does not report /api/health.version' }
    if ($served -ne $newVersion) { throw "the running server reports version '$served', expected '$newVersion'" }
    Step 'health' 'ok' ("version {0}" -f $served)

    try {
        $update = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/app/update" -Headers @{ 'x-access-token' = $accessCode } -TimeoutSec 5 -ErrorAction Stop
        $staged = [string]$update.versionName
        if ($stagedAppVersion) {
            if (-not $update.available -or $staged -ne $stagedAppVersion) {
                throw ("the host advertises APK '{0}' (available={1}), expected '{2}'" -f $staged, $update.available, $stagedAppVersion)
            }
            Step 'apk-update' 'ok' ("/api/app/update {0} / {1}" -f $staged, ([string]$update.versionCode))
        } elseif ($staged) {
            Step 'apk-update' 'ok' ("/api/app/update {0}" -f $staged)
        }
    } catch {
        if ($stagedAppVersion) { throw }
        Step 'apk-update' 'skipped' 'update-public not readable'
    }

    Say ("done: {0} now runs {1}" -f $TargetRoot, $newVersion)
    Say ("backup kept at {0}" -f $backup.Path)
    exit 0
} catch {
    $message = $_.Exception.Message
    Step 'failed' 'error' $message
    if ($backup -and (Test-Path -LiteralPath $backup.Path -PathType Leaf)) {
        try {
            if (-not $SkipRestart) {
                $null = Stop-Supervisor -Root $TargetRoot -Config $ConfigPath
                $null = Stop-ManagedProcesses -Root $TargetRoot
            }
            Restore-Install -BackupZip $backup.Path -Root $TargetRoot
            Step 'rollback' 'ok' $backup.Path
            if (-not $SkipRestart -and $config) {
                if (-not (Test-Supervisor -Root $TargetRoot)) { Start-Supervisor -Root $TargetRoot }
                if ($port) {
                    $health = Wait-Health -Port $port -AccessCode $accessCode
                    if ($health) { Step 'rollback-health' 'ok' ("version {0}" -f ([string]$health.version)) }
                    else { Step 'rollback-health' 'error' 'the restored install did not answer' }
                }
            }
        } catch {
            Step 'rollback' 'error' $_.Exception.Message
        }
    }
    throw
} finally {
    try { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue } catch { }
}
