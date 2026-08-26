#requires -Version 5.1

param(
  [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA "CodexPocket\config.json")
)

$ErrorActionPreference = "Stop"

function Read-Config {
  if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    throw "Codex Pocket config not found: $ConfigPath"
  }
  return Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
}

function Write-RecoveryLog([string]$LogPath, [string]$Message) {
  $line = "{0} [recovery] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function Test-ServerReady([int]$Port) {
  try {
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1)
  } catch {
    return $false
  }
}

function Test-TunnelReady($Config) {
  if (-not $Config.tunnel.enabled) { return $true }
  $marker = "127.0.0.1:{0}:127.0.0.1:{1}" -f $Config.tunnel.remotePort, $Config.port
  try {
    $processes = Get-CimInstance Win32_Process -Filter "Name = 'ssh.exe'" -ErrorAction Stop
    foreach ($process in $processes) {
      if ([string]$process.CommandLine -match [regex]::Escape($marker)) { return $true }
    }
  } catch {
    return $false
  }
  return $false
}

function Ensure-Watchdog([string]$TaskName, [bool]$Healthy, [string]$LogPath) {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  if ($Healthy -and $task.State -eq "Running") { return }
  if (-not $Healthy -and $task.State -eq "Running") {
    Write-RecoveryLog $LogPath ("{0} is running while its child is recovering; leaving it in place." -f $TaskName)
    return
  }
  Start-ScheduledTask -TaskName $TaskName
  $reason = if ($Healthy) { "its watchdog was stopped while the child was still healthy" } else { "its service check failed" }
  Write-RecoveryLog $LogPath ("Started {0} because {1}." -f $TaskName, $reason)
}

while ($true) {
  try {
    $config = Read-Config
    $logDir = [string]$config.logDir
    if (-not $logDir) { $logDir = Join-Path $env:LOCALAPPDATA "CodexPocket\logs" }
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    $logPath = Join-Path $logDir "recovery-monitor.log"

    Ensure-Watchdog "Codex Pocket Server Watchdog" (Test-ServerReady ([int]$config.port)) $logPath
    if ($config.tunnel.enabled) {
      Ensure-Watchdog "Codex Pocket Tunnel Watchdog" (Test-TunnelReady $config) $logPath
    }
  } catch {
    $fallbackLog = Join-Path $env:LOCALAPPDATA "CodexPocket\logs\recovery-monitor.log"
    New-Item -ItemType Directory -Path (Split-Path -Parent $fallbackLog) -Force | Out-Null
    Write-RecoveryLog $fallbackLog ("Monitor failure: " + $_.Exception.Message)
  }
  Start-Sleep -Seconds 30
}
