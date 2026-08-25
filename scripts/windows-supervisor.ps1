#requires -Version 5.1

param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("server", "tunnel")]
  [string]$Mode,

  [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA "CodexPocket\config.json")
)

$ErrorActionPreference = "Stop"

function Read-Config {
  if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    throw "Codex Pocket config not found: $ConfigPath"
  }
  return Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
}

$config = Read-Config
$logDir = [string]$config.logDir
if (-not $logDir) {
  $logDir = Join-Path $env:LOCALAPPDATA "CodexPocket\logs"
}
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$supervisorLog = Join-Path $logDir ("supervisor-{0}.log" -f $Mode)

function Write-SupervisorLog([string]$Message) {
  $line = "{0} [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Mode, $Message
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
  & ([string]$config.nodePath) @arguments 1>> $stdout 2>> $stderr
  Write-SupervisorLog ("Server exited with code {0}." -f $LASTEXITCODE)
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
  & $sshPath @arguments 1>> $stdout 2>> $stderr
  Write-SupervisorLog ("Tunnel exited with code {0}." -f $LASTEXITCODE)
}

Write-SupervisorLog ("Supervisor started. Config: {0}" -f $ConfigPath)
while ($true) {
  try {
    $config = Read-Config
    $ready = if ($Mode -eq "server") { Test-ServerReady } else { Test-TunnelReady }
    if ($ready) {
      Start-Sleep -Seconds 5
      continue
    }
    if ($Mode -eq "server") { Start-Server } else { Start-Tunnel }
  } catch {
    Write-SupervisorLog ("Failure: " + $_.Exception.Message)
  }
  Start-Sleep -Seconds 5
}
