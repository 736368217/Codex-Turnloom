#requires -Version 5.1
param(
  [string]$TaskName = "Codex-Turnloom Console"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $PSScriptRoot "console-launcher.vbs"
$electron = Join-Path $repoRoot "node_modules\electron\dist\electron.exe"

if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
  throw "Launcher not found: $launcher"
}
if (-not (Test-Path -LiteralPath $electron -PathType Leaf)) {
  throw "Electron runtime not found: $electron. Run 'npm ci' first."
}

$userId = "$env:USERDOMAIN\$env:USERNAME"
$wscript = Join-Path $env:WINDIR "System32\wscript.exe"
$action = New-ScheduledTaskAction -Execute $wscript -Argument "//B //Nologo `"$launcher`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$settings = New-ScheduledTaskSettingsSet `
  -RestartCount 3 `
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
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Output "Installed tray console logon task: $TaskName"
Write-Output "Source: $repoRoot"
Write-Output "First launch without a config will open the setup wizard."
Write-Output "To remove: npm run desktop:uninstall"
