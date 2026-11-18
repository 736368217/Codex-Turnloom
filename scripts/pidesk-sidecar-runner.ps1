param([string]$SidecarPath = '')
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $SidecarPath) { $SidecarPath = Join-Path (Split-Path -Parent $repoRoot) 'turnloom-pidesktop\pidesk-sidecar.mjs' }
$sidecarFile = (Resolve-Path -LiteralPath $SidecarPath).Path
$running = Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^node(?:w)?\.exe$' -and $_.CommandLine -and $_.CommandLine.Contains($sidecarFile) }
if ($running) { exit 0 }
$nodeFile = @(Get-Command node.exe -CommandType Application)[0].Source
$logRoot = Join-Path $env:LOCALAPPDATA 'CodexPocket\logs'
[IO.Directory]::CreateDirectory($logRoot) | Out-Null
$child = Start-Process -FilePath $nodeFile -ArgumentList @('"' + $sidecarFile + '"') -WorkingDirectory (Split-Path -Parent $sidecarFile) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot 'pidesk-sidecar-out.log') -RedirectStandardError (Join-Path $logRoot 'pidesk-sidecar-err.log') -PassThru
[IO.File]::WriteAllText((Join-Path $logRoot 'pidesk-sidecar-process.json'), (@{ pid=$child.Id; script=$sidecarFile; startedAt=(Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
