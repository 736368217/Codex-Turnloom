#requires -Version 5.1

param(
  [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA "CodexPocket\config.json")
)

$ErrorActionPreference = "Stop"

function Read-Config {
  if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    throw "codex-Turnloom config not found: $ConfigPath"
  }
  return Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
}

$config = Read-Config
$logDir = [string]$config.logDir
if (-not $logDir) {
  $logDir = Join-Path $env:LOCALAPPDATA "CodexPocket\logs"
}
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$supervisorLog = Join-Path $logDir "supervisor.log"

function Write-SupervisorLog([string]$Message) {
  $line = "{0} [supervisor] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -LiteralPath $supervisorLog -Value $line -Encoding UTF8
}

function Test-ServerReady {
  try {
    return [bool](Get-NetTCPConnection -LocalPort ([int]$config.port) -State Listen -ErrorAction Stop | Select-Object -First 1)
  } catch {
    return $false
  }
}

function Test-TunnelReady {
  if (-not $config.tunnel.enabled) { return $true }
  $marker = "127.0.0.1:{0}:127.0.0.1:{1}" -f $config.tunnel.remotePort, $config.port
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

function Start-Server {
  $serverPath = Join-Path ([string]$config.repoRoot) "server.js"
  $arguments = @(
    $serverPath,
    "--host", [string]$config.host,
    "--port", [string]$config.port,
    "--password", [string]$config.accessCode,
    "--codex-home", [string]$config.codexHome
  )
  if ($config.readonly) { $arguments += "--readonly" }
  $stdout = Join-Path $logDir "server-out.log"
  $stderr = Join-Path $logDir "server-error.log"
  Write-SupervisorLog ("Starting server on port {0}." -f $config.port)
  Start-Process `
    -FilePath ([string]$config.nodePath) `
    -ArgumentList $arguments `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr | Out-Null
}

function Start-Tunnel {
  $sshPath = Join-Path $env:WINDIR "System32\OpenSSH\ssh.exe"
  if (-not (Test-Path -LiteralPath $sshPath -PathType Leaf)) {
    throw "Windows OpenSSH client not found: $sshPath"
  }
  $remote = "{0}@{1}" -f $config.tunnel.user, $config.tunnel.host
  $forward = "127.0.0.1:{0}:127.0.0.1:{1}" -f $config.tunnel.remotePort, $config.port
  $arguments = @(
    "-i", [string]$config.tunnel.keyPath,
    "-o", "IdentitiesOnly=yes",
    "-o", "BatchMode=yes",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=3",
    "-o", "StrictHostKeyChecking=yes",
    "-o", ("UserKnownHostsFile=" + [string]$config.tunnel.knownHostsPath),
    "-N", "-R", $forward, $remote
  )
  $stdout = Join-Path $logDir "tunnel-out.log"
  $stderr = Join-Path $logDir "tunnel-error.log"
  Write-SupervisorLog ("Starting tunnel to {0}; remote port {1}." -f $config.tunnel.host, $config.tunnel.remotePort)
  Start-Process `
    -FilePath $sshPath `
    -ArgumentList $arguments `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr | Out-Null
}

Write-SupervisorLog ("Supervisor started. Config: {0}" -f $ConfigPath)
while ($true) {
  try {
    $config = Read-Config
    if (-not (Test-ServerReady)) { Start-Server }
    if ($config.tunnel.enabled -and -not (Test-TunnelReady)) { Start-Tunnel }
  } catch {
    Write-SupervisorLog ("Failure: " + $_.Exception.Message)
  }
  Start-Sleep -Seconds 5
}
