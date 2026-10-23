#requires -Version 5.1
# Starts the tray console without a console window. Used by the logon task.

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $repoRoot "node_modules\electron\dist\electron.exe"
if (-not (Test-Path -LiteralPath $electron -PathType Leaf)) {
  throw "Electron runtime not found: $electron. Run 'npm ci' first."
}
$arguments = @($repoRoot, "--hidden")
Start-Process -FilePath $electron -ArgumentList $arguments -WorkingDirectory $repoRoot -WindowStyle Hidden
