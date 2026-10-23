#requires -Version 5.1
param(
  [string]$TaskName = "Codex-Turnloom Console"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$escapedRoot = [regex]::Escape($repoRoot)
Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
  $commandLine = [string]$_.CommandLine
  if ($commandLine -match $escapedRoot -and $commandLine -match "--hidden") {
    & taskkill.exe /PID ([int]$_.ProcessId) /T /F 2>$null | Out-Null
    Write-Output ("Stopped console process tree: " + $_.ProcessId)
  }
}

Write-Output "Removed tray console logon task: $TaskName"
Write-Output "Configuration and logs are kept in %LOCALAPPDATA%\CodexPocket."
