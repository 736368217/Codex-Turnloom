#requires -Version 5.1

param(
  [string]$MachineName = $env:COMPUTERNAME,
  [int]$Port = 8787,
  [string]$AccessCode,
  [string]$CodexHome,
  [string]$PublicUrl,
  [switch]$Readonly,
  [string]$TunnelHost,
  [string]$TunnelUser = "codextunnel",
  [int]$RemotePort,
  [string]$SshKeyPath = (Join-Path $env:USERPROFILE ".ssh\codex_pocket_ed25519"),
  [string]$KnownHostsPath = (Join-Path $env:USERPROFILE ".ssh\known_hosts")
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptRoot
$supervisor = Join-Path $scriptRoot "windows-supervisor.ps1"
$launcher = Join-Path $scriptRoot "windows-supervisor-launcher.vbs"
$configDir = Join-Path $env:LOCALAPPDATA "CodexPocket"
$configPath = Join-Path $configDir "config.json"
$logDir = Join-Path $configDir "logs"
$powershell = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
$wscript = Join-Path $env:WINDIR "System32\wscript.exe"
$node = Get-Command node.exe -ErrorAction Stop | Select-Object -First 1
$npm = Get-Command npm.cmd -ErrorAction Stop | Select-Object -First 1

$configAlreadyExists = Test-Path -LiteralPath $configPath -PathType Leaf
$previousRepoRoot = $null
$previousPort = 0
if ($configAlreadyExists) {
  $existing = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  $previousRepoRoot = [string]$existing.repoRoot
  $previousPort = [int]$existing.port
  if (-not $PSBoundParameters.ContainsKey("MachineName")) { $MachineName = [string]$existing.machineName }
  if (-not $PSBoundParameters.ContainsKey("Port")) { $Port = [int]$existing.port }
  if (-not $PSBoundParameters.ContainsKey("AccessCode")) { $AccessCode = [string]$existing.accessCode }
  if (-not $PSBoundParameters.ContainsKey("CodexHome")) { $CodexHome = [string]$existing.codexHome }
  if (-not $PSBoundParameters.ContainsKey("PublicUrl")) { $PublicUrl = [string]$existing.publicUrl }
  if (-not $PSBoundParameters.ContainsKey("Readonly")) { $Readonly = [bool]$existing.readonly }
  if (-not $PSBoundParameters.ContainsKey("TunnelHost")) { $TunnelHost = [string]$existing.tunnel.host }
  if (-not $PSBoundParameters.ContainsKey("TunnelUser")) { $TunnelUser = [string]$existing.tunnel.user }
  if (-not $PSBoundParameters.ContainsKey("RemotePort")) { $RemotePort = [int]$existing.tunnel.remotePort }
  if (-not $PSBoundParameters.ContainsKey("SshKeyPath")) { $SshKeyPath = [string]$existing.tunnel.keyPath }
  if (-not $PSBoundParameters.ContainsKey("KnownHostsPath")) { $KnownHostsPath = [string]$existing.tunnel.knownHostsPath }
}

function New-AccessCode {
  $bytes = New-Object byte[] 4
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $value = [BitConverter]::ToUInt32($bytes, 0)
  return (100000 + ($value % 900000)).ToString()
}

function Find-CodexHome {
  $candidates = @()
  if ($env:CODEX_HOME) { $candidates += $env:CODEX_HOME }
  $candidates += (Join-Path $env:USERPROFILE ".codex")
  foreach ($drive in (Get-PSDrive -PSProvider FileSystem)) {
    $candidate = Join-Path $drive.Root "codex\.codex"
    if (Test-Path -LiteralPath $candidate -PathType Container) { $candidates += $candidate }
  }
  $valid = foreach ($candidate in ($candidates | Select-Object -Unique)) {
    $db = Join-Path $candidate "state_5.sqlite"
    if (Test-Path -LiteralPath $db -PathType Leaf) {
      $item = Get-Item -LiteralPath $db
      [pscustomobject]@{ Path = $candidate; Modified = $item.LastWriteTimeUtc }
    }
  }
  return ($valid | Sort-Object Modified -Descending | Select-Object -First 1).Path
}

if (-not $AccessCode) { $AccessCode = New-AccessCode }
if (-not $CodexHome) { $CodexHome = Find-CodexHome }
if (-not $CodexHome -or -not (Test-Path -LiteralPath $CodexHome -PathType Container)) {
  throw "Cannot find Codex data directory. Pass -CodexHome explicitly."
}
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot "server.js") -PathType Leaf)) {
  throw "server.js not found under repository root: $repoRoot"
}

function Stop-ManagedServerProcess([string]$ManagedRepoRoot, [int]$ManagedPort) {
  if (-not $ManagedRepoRoot -or $ManagedPort -le 0) { return }
  $managedServer = Join-Path $ManagedRepoRoot "server.js"
  $serverPattern = [regex]::Escape($managedServer)
  $portPattern = "--port\s+{0}(?:\s|$)" -f $ManagedPort
  $processes = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue
  foreach ($process in $processes) {
    $commandLine = [string]$process.CommandLine
    if ($commandLine -match $serverPattern -and $commandLine -match $portPattern) {
      Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction SilentlyContinue
      Write-Output ("Stopped previous Codex Pocket server process: " + $process.ProcessId)
    }
  }
}
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
  throw "Windowless supervisor launcher not found: $launcher"
}
if ($TunnelHost) {
  if ($RemotePort -le 0) { throw "-RemotePort is required when -TunnelHost is set." }
  if (-not (Test-Path -LiteralPath $SshKeyPath -PathType Leaf)) { throw "SSH key not found: $SshKeyPath" }
  if (-not (Test-Path -LiteralPath $KnownHostsPath -PathType Leaf)) { throw "known_hosts not found: $KnownHostsPath" }
}

if (-not (Test-Path -LiteralPath (Join-Path $repoRoot "node_modules\qrcode-terminal") -PathType Container)) {
  Write-Output "Installing Node dependencies..."
  & $npm.Source ci --omit=dev --prefix $repoRoot
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE" }
}

New-Item -ItemType Directory -Path $configDir -Force | Out-Null
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$config = [ordered]@{
  schemaVersion = 1
  machineName = $MachineName
  repoRoot = $repoRoot
  nodePath = $node.Source
  codexHome = (Resolve-Path -LiteralPath $CodexHome).Path
  host = "0.0.0.0"
  port = $Port
  accessCode = $AccessCode
  readonly = [bool]$Readonly
  publicUrl = ([string]$PublicUrl).TrimEnd("/")
  logDir = $logDir
  tunnel = [ordered]@{
    enabled = [bool]$TunnelHost
    host = $TunnelHost
    user = $TunnelUser
    remotePort = $RemotePort
    keyPath = $SshKeyPath
    knownHostsPath = $KnownHostsPath
  }
}
$config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configPath -Encoding UTF8
if (-not $configAlreadyExists) {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl = Get-Acl -LiteralPath $configPath
  $acl.SetAccessRuleProtection($true, $false)
  $acl.SetAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity, "FullControl", "Allow")))
  Set-Acl -LiteralPath $configPath -AclObject $acl
}

$settings = New-ScheduledTaskSettingsSet `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew `
  -Hidden `
  -StartWhenAvailable
$userId = $env:USERDOMAIN + "\" + $env:USERNAME
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$recoveryTrigger = New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 1) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$triggers = @($logonTrigger, $recoveryTrigger)
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited

$taskName = "Codex Pocket Supervisor"
$argument = "//B //Nologo `"$launcher`" `"$powershell`" `"$supervisor`" `"$configPath`""
$action = New-ScheduledTaskAction -Execute $wscript -Argument $argument
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Stop-ManagedServerProcess -ManagedRepoRoot $previousRepoRoot -ManagedPort $previousPort
if ($repoRoot -ne $previousRepoRoot -or $Port -ne $previousPort) {
  Stop-ManagedServerProcess -ManagedRepoRoot $repoRoot -ManagedPort $Port
}
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output ("Installed and started: " + $taskName)

foreach ($legacyTaskName in @("Codex Pocket Server Watchdog", "Codex Pocket Tunnel Watchdog", "Codex Pocket Recovery Monitor")) {
  Stop-ScheduledTask -TaskName $legacyTaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $legacyTaskName -Confirm:$false -ErrorAction SilentlyContinue
}

Write-Output "Configuration: $configPath"
Write-Output "Logs:          $logDir"
Write-Output "Codex home:    $CodexHome"
Write-Output "Access code:   $AccessCode"
if ($PublicUrl) {
  Write-Output "Public URL:    $PublicUrl"
  & $node.Source (Join-Path $scriptRoot "print-device-qr.js") --config $configPath
} else {
  Write-Output "No public URL configured. Add publicUrl to the local config before printing the device QR."
}
