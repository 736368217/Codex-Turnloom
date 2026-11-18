#requires -Version 5.1

$ErrorActionPreference = "Stop"
$taskNames = @("Codex Pocket Supervisor", "Codex Pocket Server Watchdog", "Codex Pocket Tunnel Watchdog", "Codex Pocket Recovery Monitor")
foreach ($taskName in $taskNames) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output ("Removed task: " + $taskName)
}
Write-Output ("Local configuration was preserved: " + (Join-Path $env:LOCALAPPDATA "CodexPocket"))
