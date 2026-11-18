#requires -Version 5.1
<#
.SYNOPSIS
  Register the Codex-Turnloom machine gateway as a logon-time, windowless
  scheduled task (NOT a Windows SCM service).
.DESCRIPTION
  Installer template: nothing runs until YOU invoke it. ASCII-only on purpose:
  Windows PowerShell 5.1 decodes BOM-less files with the ANSI codepage, which
  would corrupt non-ASCII text. This file is valid UTF-8 without BOM.

  It validates Node >= 22.5 and server\machine-gateway.cjs, prepares
  %LOCALAPPDATA%\CodexPocket\machine.json from deploy\machine.example.json
  (with a random machineToken), writes UTF-8 without BOM, and registers one
  -AtLogOn / -RunLevel Limited task named "Codex-Turnloom Machine Gateway".

  Windowless launch chain (the proven pattern of
  scripts\link-watchdog-launcher.vbs):
    Task Scheduler -> wscript.exe //B //Nologo -> generated .vbs
                   -> WScript.Shell.Run(cmd, 0, False)
                   -> cmd.exe /d /s /c "node.exe ... >> out.log 2>> err.log"
  Reason: node.exe is a console program. Even with a Hidden task or
  powershell.exe -WindowStyle Hidden as the task action, it can still create a
  visible console/conhost window. The VBS chain keeps the whole tree invisible.
  There is NO ready-made VBS in this repo that starts the gateway (the existing
  link-watchdog-launcher.vbs hard-codes link-watchdog.mjs, and
  windows-supervisor-launcher.vbs hard-codes windows-supervisor.ps1), so this
  installer GENERATES a same-style launcher into the config directory at
  install time. No repository file is created or modified.

  Fallback: if wscript.exe / WSH is unavailable, or -UsePowerShellHidden is
  passed, the task action becomes
    powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File <generated .ps1>
  which wraps node.exe in Start-Process -WindowStyle Hidden -Wait. This is less
  reliable than the VBS chain (console/conhost may still flash) and is only a
  compatibility fallback; prefer the wscript.exe path.

  All credentials stay in the user-only config. The QR payload hint printed at
  the end calls node -e with shared/machine-pairing.cjs's
  machinePairingPayload; run it from the repository root. The payload contains
  the machine token, so treat it as a secret and never paste it into logs.
.PARAMETER ConfigPath
  Machine config path. Default: %LOCALAPPDATA%\CodexPocket\machine.json.
.PARAMETER Port
  Gateway public port. Default 8787 (backends stay on 127.0.0.1).
.PARAMETER NodePath
  Full path to node.exe. Default: resolve from PATH.
.PARAMETER TaskName
  Scheduled task name. Default: "Codex-Turnloom Machine Gateway".
.PARAMETER ImportLegacyConfig
  READ-ONLY path to an existing legacy dual-dispatcher config.json. Its real
  devices[].key/label/port/entry/codexHome/token/spawn/extraArgs are imported
  into machine.json. Never written back. Prefer the reversible
  scripts\configure-machine-gateway.cjs helper for production migrations.
.PARAMETER Force
  Regenerate an existing config (NEW random machineToken -> phones must
  re-scan the QR), rewrite the generated launcher, and re-register the task.
.PARAMETER UsePowerShellHidden
  Force the powershell.exe -WindowStyle Hidden fallback action.
.EXAMPLE
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File installer\install-machine-service.ps1 -Port 8787
.EXAMPLE
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File installer\install-machine-service.ps1 -Force
#>
[CmdletBinding()]
param(
  [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'CodexPocket\machine.json'),
  [ValidateRange(1, 65535)]
  [int]$Port = 8787,
  [string]$NodePath = '',
  [string]$TaskName = 'Codex-Turnloom Machine Gateway',
  [string]$ImportLegacyConfig = '',
  [switch]$NoSpawn,
  [switch]$Force,
  [switch]$UsePowerShellHidden
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$gatewayPath = Join-Path $repoRoot 'server\machine-gateway.cjs'
$pairingPath = Join-Path $repoRoot 'shared\machine-pairing.cjs'
$templatePath = Join-Path $repoRoot 'deploy\machine.example.json'
$configDir = Split-Path -Parent $ConfigPath
$logDir = Join-Path $configDir 'logs'
$launcherPath = Join-Path $configDir 'machine-gateway-launcher.vbs'
$hiddenWrapperPath = Join-Path $configDir 'machine-gateway-hidden.ps1'
# Set-Content -Encoding UTF8 adds a BOM on Windows PowerShell 5.1; use an
# explicit BOM-less encoding for every generated file (UTF-8, no BOM).
$utf8NoBom = New-Object System.Text.UTF8Encoding -ArgumentList $false
$userId = "$env:USERDOMAIN\$env:USERNAME"
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
$powershell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function New-RandomToken {
  # 32 random bytes -> base64url. RandomNumberGenerator::Create() is the
  # modern, non-obsolete equivalent of the PS 5.1 RNGCryptoServiceProvider.
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $base64 = [Convert]::ToBase64String($bytes)
  return ($base64 -replace '\+', '-' -replace '/', '_' -replace '=', '')
}

function Resolve-Node([string]$Requested) {
  if ($Requested) {
    if (-not (Test-Path -LiteralPath $Requested -PathType Leaf)) {
      throw "node.exe not found: $Requested (check -NodePath)"
    }
    return (Resolve-Path -LiteralPath $Requested).Path
  }
  $command = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $command) { throw 'node.exe not found. Install Node.js >= 22.5 or pass -NodePath.' }
  return $command.Source
}

function Assert-NodeVersion([string]$Node) {
  $raw = & $Node --version 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Cannot read node version: $raw" }
  $text = ([string]$raw).Trim()
  if ($text -notmatch '^v?(\d+)\.(\d+)\.(\d+)') { throw "Cannot parse node version: $text" }
  $version = [version]("$($Matches[1]).$($Matches[2]).$($Matches[3])")
  $minimum = [version]'22.5.0'
  if ($version -lt $minimum) {
    throw "Node.js too old: $text (need >= 22.5, see package.json engines)"
  }
  Write-Output "Node: $text ($Node)"
}

function Assert-GatewayFiles {
  if (-not (Test-Path -LiteralPath $gatewayPath -PathType Leaf)) {
    throw "Gateway entry not found: $gatewayPath`nserver/machine-gateway.cjs is provided by a parallel implementation; deploy it before running this installer."
  }
  if (-not (Test-Path -LiteralPath $pairingPath -PathType Leaf)) {
    throw "Protocol module not found: $pairingPath (shared/machine-pairing.cjs must ship with the repo)"
  }
  if (-not (Test-Path -LiteralPath $templatePath -PathType Leaf)) {
    throw "Config template not found: $templatePath"
  }
  Write-Output "Gateway: $gatewayPath"
}

function Protect-Config([string]$Path) {
  try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = Get-Acl -LiteralPath $Path
    $acl.SetAccessRuleProtection($true, $false)
    $rule = New-Object Security.AccessControl.FileSystemAccessRule -ArgumentList $identity, 'FullControl', 'Allow'
    $acl.SetAccessRule($rule)
    Set-Acl -LiteralPath $Path -AclObject $acl
  } catch {
    Write-Warning "Could not tighten ACL; verify $Path is readable only by the current user: $($_.Exception.Message)"
  }
}

function New-MachineConfig {
  param([string]$LegacyPath = '')
  $json = Get-Content -LiteralPath $templatePath -Raw -Encoding UTF8 | ConvertFrom-Json
  $json.machineToken = New-RandomToken
  if ($LegacyPath) {
    # Explicitly requested import: READ-ONLY sibling dual/config.json. Copy the
    # REAL harness endpoints / tokens / codex homes / extra args. Never invent
    # tokens or ports, and never write back to the sibling repository.
    if (-not (Test-Path -LiteralPath $LegacyPath -PathType Leaf)) {
      throw "Legacy config not found: $LegacyPath (read-only import source)"
    }
    $legacy = Get-Content -LiteralPath $LegacyPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $legacy.devices -or @($legacy.devices).Count -eq 0) {
      throw "Legacy config has no devices[] to import: $LegacyPath"
    }
    $imported = @()
    foreach ($device in $legacy.devices) {
      if (-not $device.token) { throw "Legacy device $($device.key) has no token; refusing to fabricate one." }
      if (-not $device.port) { throw "Legacy device $($device.key) has no port; refusing to fabricate one." }
      $extra = @()
      if ($device.extraArgs) { $extra = @($device.extraArgs | ForEach-Object { [string]$_ }) }
      $imported += [pscustomobject]@{
        id        = [string]$device.key
        name      = [string]$device.label
        token     = [string]$device.token
        kind      = 'codex'
        port      = [int]$device.port
        entry     = [string]$device.entry
        codexHome = [string]$device.codexHome
        spawn     = if ($NoSpawn) { $false } else { [bool]$device.spawn }
        extraArgs = $extra
      }
    }
    $json.harnesses = $imported
    $json.defaultHarness = [string]($legacy.defaultDevice)
    Write-Output "Imported $(@($imported).Count) real harnesses from (read-only): $LegacyPath"
  } else {
    # Template path: all tokens are placeholders; generate distinct random ones.
    foreach ($harness in $json.harnesses) { $harness.token = New-RandomToken }
  }
  return $json
}

function ConvertTo-VbsString([string]$Value) {
  # Escape VBScript double quotes. A single quote inside a VBScript string
  # literal is not a comment, so paths are safe here.
  return $Value.Replace('"', '""')
}

function New-VbsLauncher([string]$Node, [string]$Gateway, [string]$Config, [string]$NoSpawnFlag = '') {
  $noSpawnFlag = $NoSpawnFlag
  $content = @"
' Generated by installer\install-machine-service.ps1. Same windowless pattern
' as scripts\link-watchdog-launcher.vbs: wscript //B -> WScript.Shell.Run(...,0,False)
' -> cmd /d /s /c with output redirected to logs. Do not edit by hand.
Option Explicit
Dim shell, fso, comSpec, nodePath, scriptPath, configPath, outLog, errLog
Dim inner, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

nodePath = "$(ConvertTo-VbsString $Node)"
scriptPath = "$(ConvertTo-VbsString $Gateway)"
configPath = "$(ConvertTo-VbsString $Config)"
comSpec = shell.ExpandEnvironmentStrings("%ComSpec%")
If Len(comSpec) = 0 Then comSpec = "cmd.exe"

outLog = "$(ConvertTo-VbsString (Join-Path $logDir 'machine-gateway-out.log'))"
errLog = "$(ConvertTo-VbsString (Join-Path $logDir 'machine-gateway-err.log'))"
EnsureFolder "$(ConvertTo-VbsString $logDir)"

If Not fso.FileExists(scriptPath) Then
  AppendLog errLog, Now & " [gateway-launcher] missing " & scriptPath
  WScript.Quit 1
End If

inner = Q(nodePath) & " " & Q(scriptPath) & " --host 0.0.0.0 --port $Port --config " & Q(configPath) & "$noSpawnFlag >> " & Q(outLog) & " 2>> " & Q(errLog)
command = Q(comSpec) & " /d /s /c " & Q(inner)
AppendLog outLog, Now & " [gateway-launcher] starting hidden gateway on port $Port"
On Error Resume Next
shell.Run command, 0, False
If Err.Number <> 0 Then
  AppendLog errLog, Now & " [gateway-launcher] shell.Run failed: " & Err.Description
  WScript.Quit 1
End If
On Error Goto 0
WScript.Quit 0

Function Q(value)
  Q = Chr(34) & CStr(value) & Chr(34)
End Function

Sub EnsureFolder(folderPath)
  Dim parentPath
  If fso.FolderExists(folderPath) Then Exit Sub
  parentPath = fso.GetParentFolderName(folderPath)
  If Len(parentPath) > 0 Then EnsureFolder parentPath
  fso.CreateFolder folderPath
End Sub

Sub AppendLog(filePath, message)
  On Error Resume Next
  Dim stream
  Set stream = fso.OpenTextFile(filePath, 8, True)
  If Not stream Is Nothing Then
    stream.WriteLine message
    stream.Close
  End If
  On Error Goto 0
End Sub
"@
  Write-Utf8NoBom $launcherPath ($content + "`r`n")
  return $launcherPath
}

function New-HiddenPowerShellWrapper([string]$Node, [string]$Gateway, [string]$Config, [string]$NoSpawnArg = '') {
  # Fallback only: powershell.exe -WindowStyle Hidden + Start-Process -WindowStyle Hidden.
  $content = @"
# Generated by installer\install-machine-service.ps1 (compatibility fallback).
`$ErrorActionPreference = 'Stop'
`$argList = @('$(ConvertTo-VbsString $Gateway)', '--host', '0.0.0.0', '--port', '$Port', '--config', '$(ConvertTo-VbsString $Config)')
if ('$NoSpawnArg') { `$argList += '$NoSpawnArg' }
Start-Process -FilePath '$(ConvertTo-VbsString $Node)' -ArgumentList `$argList -WindowStyle Hidden -Wait
"@
  Write-Utf8NoBom $hiddenWrapperPath ($content + "`r`n")
  return $hiddenWrapperPath
}

function Register-GatewayTask([string]$ActionExe, [string]$ActionArgs) {
  $hasCmdlets = [bool](Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue)
  if ($hasCmdlets) {
    try {
      $action = New-ScheduledTaskAction -Execute $ActionExe -Argument $ActionArgs
      $trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
      $settings = New-ScheduledTaskSettingsSet `
        -RestartCount 999 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -MultipleInstances IgnoreNew `
        -Hidden `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -DontStopOnIdleEnd `
        -StartWhenAvailable
      $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
      Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
      Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
        -Settings $settings -Principal $principal -Force | Out-Null
      Write-Output "Registered logon task (Register-ScheduledTask): $TaskName"
      return
    } catch {
      Write-Warning "Register-ScheduledTask failed; falling back to schtasks.exe: $($_.Exception.Message)"
    }
  }

  # schtasks.exe fallback: /SC ONLOGON + /RL LIMITED + /IT (interactive only).
  $taskRun = '"' + $ActionExe + '" ' + $ActionArgs
  & schtasks.exe /Create /TN $TaskName /TR $taskRun /SC ONLOGON /RL LIMITED /IT /F
  if ($LASTEXITCODE -ne 0) { throw "schtasks.exe /Create failed (exit $LASTEXITCODE): $TaskName" }
  Write-Output "Registered logon task (schtasks.exe): $TaskName"
}

# ---------------------------------------------------------------- main ----
$nodeExe = Resolve-Node $NodePath
Assert-NodeVersion $nodeExe
Assert-GatewayFiles

New-Item -ItemType Directory -Path $configDir -Force | Out-Null
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$legacyImportPath = ''
if ($ImportLegacyConfig) {
  $legacyImportPath = (Resolve-Path -LiteralPath $ImportLegacyConfig -ErrorAction Stop).Path
  Write-Output "Legacy import is READ-ONLY: $legacyImportPath"
}
$noSpawnFlag = if ($NoSpawn) { ' --no-spawn' } else { '' }
$noSpawnArg = if ($NoSpawn) { '--no-spawn' } else { '' }
$configExisted = Test-Path -LiteralPath $ConfigPath -PathType Leaf
if ($configExisted -and -not $Force) {
  Write-Output "Config exists, kept as-is: $ConfigPath (use -Force to regenerate; phones must re-scan)"
} elseif ($configExisted -and $Force) {
  Write-Utf8NoBom $ConfigPath ((New-MachineConfig $legacyImportPath | ConvertTo-Json -Depth 8) + "`r`n")
  Write-Warning "Regenerated config with -Force: machineToken changed, all phones must re-scan the QR."
} else {
  Write-Utf8NoBom $ConfigPath ((New-MachineConfig $legacyImportPath | ConvertTo-Json -Depth 8) + "`r`n")
  Write-Output "Created config from $templatePath : $ConfigPath"
}
Protect-Config $ConfigPath

$configText = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8
$config = $configText | ConvertFrom-Json
$tokens = @($config.machineToken) + @($config.harnesses | ForEach-Object { $_.token })
if (($tokens | Select-Object -Unique).Count -ne $tokens.Count) {
  throw "Config check failed: machineToken and all harness tokens must be distinct (see deploy/machine.example.json _comment)."
}
if ($config.machineToken -like 'REPLACE_WITH_*') {
  throw "Config check failed: machineToken is still a placeholder."
}
$hasPlaceholders = $configText -match 'REPLACE_WITH_'
if ($hasPlaceholders) {
  Write-Warning "Config still has REPLACE_WITH_* placeholders (usually entry / codexHome). Task will be registered but NOT started; edit them, then Start-ScheduledTask."
}

# Prefer the VBS windowless chain; fall back to hidden PowerShell if WSH is absent.
$useVbs = (-not $UsePowerShellHidden) -and (Test-Path -LiteralPath $wscript -PathType Leaf)
if ($useVbs) {
  $launcher = New-VbsLauncher $nodeExe $gatewayPath $ConfigPath $noSpawnFlag
  $actionExe = $wscript
  $actionArgs = '//B //Nologo "' + $launcher + '"'
  Write-Output "Windowless launcher (VBS chain): $launcher"
} else {
  if (-not (Test-Path -LiteralPath $powershell -PathType Leaf)) {
    throw "Neither wscript.exe nor powershell.exe found; cannot register a windowless task."
  }
  $wrapper = New-HiddenPowerShellWrapper $nodeExe $gatewayPath $ConfigPath $noSpawnArg
  $actionExe = $powershell
  $actionArgs = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $wrapper + '"'
  Write-Warning "Using powershell.exe -WindowStyle Hidden fallback: Hidden alone on node.exe may still flash conhost; the VBS chain is more reliable ($wrapper)."
}

Register-GatewayTask $actionExe $actionArgs

if (-not $hasPlaceholders) {
  Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Write-Output "Task started: $TaskName (port $Port, RunLevel Limited, AtLogOn)"
} else {
  Write-Output "Task registered but NOT started. After editing placeholders: Start-ScheduledTask -TaskName '$TaskName'"
}

Write-Output "Config: $ConfigPath (UTF-8 without BOM, user-only ACL)"
Write-Output "Logs:   $logDir"
Write-Output ''
Write-Output 'Machine QR: use the tray console pairing page (the QR is a secret bearer token, never printed here).'
Write-Output "For CLI validation without printing tokens: node scripts\\configure-machine-gateway.cjs --dry-run --config <console-config.json> --machine-config `"$ConfigPath`""
Write-Output 'The QR machineId / machineName / machineToken / origin are read from machine.json and match /api/harnesses.'
Write-Output 'shared/machine-pairing.cjs is the ONE protocol codec; do not duplicate parsing logic anywhere.'
Write-Output 'Windows needs only ONE machine QR; adding a harness needs re-discovery, not a re-scan.'
Write-Output "Uninstall: powershell.exe -NoProfile -ExecutionPolicy Bypass -File installer\\uninstall-machine-service.ps1"
