#requires -Version 5.1
<#
.SYNOPSIS
  Unregister the "Codex-Turnloom Machine Gateway" logon task.
.DESCRIPTION
  Companion to installer\install-machine-service.ps1. Stops and unregisters the
  scheduled task, but KEEPS %LOCALAPPDATA%\CodexPocket (config.json,
  machine.json, logs\) and the generated launcher/wrapper. Credentials and
  logs are never deleted automatically; remove them by hand once you are sure
  they are no longer needed.

  Installer template: nothing runs until YOU invoke it. ASCII-only on purpose:
  Windows PowerShell 5.1 decodes BOM-less files with the ANSI codepage, which
  would corrupt non-ASCII text. This file is valid UTF-8 without BOM.

  Requires no administrator rights (the task is per-user, RunLevel Limited)
  and is idempotent.
.PARAMETER TaskName
  Scheduled task name. Default: "Codex-Turnloom Machine Gateway".
.EXAMPLE
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File installer\uninstall-machine-service.ps1
#>
[CmdletBinding()]
param(
  [string]$TaskName = 'Codex-Turnloom Machine Gateway'
)

$ErrorActionPreference = 'Stop'
$configDir = Join-Path $env:LOCALAPPDATA 'CodexPocket'
$configPath = Join-Path $configDir 'machine.json'
$logDir = Join-Path $configDir 'logs'
$generatedLauncher = Join-Path $configDir 'machine-gateway-launcher.vbs'
$generatedWrapper = Join-Path $configDir 'machine-gateway-hidden.ps1'

function Remove-GatewayTask([string]$Name) {
  $hasCmdlets = [bool](Get-Command Unregister-ScheduledTask -ErrorAction SilentlyContinue)
  if ($hasCmdlets) {
    $task = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    if ($task) {
      Stop-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
      Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction Stop
      Write-Output "Stopped and unregistered scheduled task: $Name"
      return
    }
    Write-Output "Task not found, nothing to unregister: $Name"
    return
  }

  # schtasks.exe fallback (same task name used by the installer's fallback).
  & schtasks.exe /Query /TN $Name 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Output "Task not found, nothing to unregister: $Name"
    return
  }
  & schtasks.exe /End /TN $Name 2>$null | Out-Null
  & schtasks.exe /Delete /TN $Name /F
  if ($LASTEXITCODE -ne 0) {
    throw "schtasks.exe /Delete failed (exit $LASTEXITCODE): $Name"
  }
  Write-Output "Stopped and unregistered scheduled task (schtasks.exe): $Name"
}

Remove-GatewayTask $TaskName

Write-Output ''
Write-Output 'Config and logs are KEPT (nothing is deleted automatically):'
Write-Output "  $configDir"
Write-Output "  $configPath"
Write-Output "  $logDir"
Write-Output "  $generatedLauncher"
Write-Output "  $generatedWrapper"
Write-Output ''
Write-Output 'If you are sure they are no longer needed, remove them manually, e.g.:'
Write-Output "  Remove-Item -LiteralPath '$configPath' -Force"
Write-Output "  Remove-Item -LiteralPath '$logDir' -Recurse -Force"
Write-Output ''
Write-Output 'The tray-console logon task is removed separately by scripts\uninstall-console.ps1.'
Write-Output 'This script only handles the machine gateway task; other watchdog tasks (Link Watchdog, etc.) are separate.'
Write-Output 'If the machine QR was shared with phones, also clear the saved connections and QR screenshots on the phones.'
