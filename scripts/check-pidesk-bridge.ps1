#requires -Version 5.1
<#
  Read-only check for the PI-Desktop bridge:
    - facade directory and state_5.sqlite
    - Codex IPC facade pipe
    - 8799 service reachability
  Does not start or stop anything.
#>
$ErrorActionPreference = "SilentlyContinue"

$facade = Join-Path $env:USERPROFILE ".pidesktop-turnloom"
$stateDb = Join-Path $facade "state_5.sqlite"
$pipePath = '\\.\pipe\pidesktop-codex-ipc'
$port = 8799

$rows = @()

$facadeOk = Test-Path $stateDb
$rows += [pscustomobject]@{
  Check = "Facade"
  Ok = $facadeOk
  Detail = if ($facadeOk) { $facade } else { "missing $stateDb" }
}

$pipeOk = $false
try {
  $pipeOk = [System.IO.Directory]::GetFiles('\\.\pipe\') -contains $pipePath
} catch {}
$rows += [pscustomobject]@{
  Check = "IPC pipe"
  Ok = $pipeOk
  Detail = if ($pipeOk) { $pipePath } else { "not running (PI-Desktop plugin not loaded)" }
}

$listening = Test-NetConnection -ComputerName 127.0.0.1 -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue
$rows += [pscustomobject]@{
  Check = "Port 8799"
  Ok = [bool]$listening
  Detail = if ($listening) { "http://127.0.0.1:$port" } else { "not listening" }
}

$rows | Format-Table -AutoSize
$ready = ($rows | Where-Object { -not $_.Ok } | Measure-Object).Count -eq 0
if ($ready) {
  Write-Host "PI-Desktop bridge is ready." -ForegroundColor Green
  exit 0
}
Write-Host "PI-Desktop bridge is incomplete. If the IPC pipe is missing, restart PI-Desktop once so the plugin loads." -ForegroundColor Yellow
exit 1
