# Start the visual fixture + `vite preview`, run the screenshot matrix, then stop both.
# Used by the visual audit so the two servers live exactly as long as one capture run.
param(
  [string]$Out = "docs/qa/visual/before",
  [string]$Views = "390x844:2",
  [string]$Only = "",
  [string]$Extra = "",
  [string]$Fail = "",
  [int]$FixturePort = 7812,
  [int]$PreviewPort = 4173
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$logDir = Join-Path $root "tmp"
New-Item -ItemType Directory -Force $logDir | Out-Null

function Wait-Port([int]$Port, [int]$TimeoutSec = 30) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $client = New-Object System.Net.Sockets.TcpClient
      $client.Connect("127.0.0.1", $Port)
      $client.Close()
      return $true
    } catch { Start-Sleep -Milliseconds 250 }
  }
  return $false
}

# Snapshot dist so a teammate rebuilding `app/` mid-run cannot swap the bundle
# under the page (half-written chunks show up as a blank screen).
$snapshot = Join-Path $logDir "dist-snapshot"
if (Test-Path -LiteralPath $snapshot) { Remove-Item -LiteralPath $snapshot -Recurse -Force }
Copy-Item (Join-Path $root "app\dist") $snapshot -Recurse

if ($Fail) { $env:QA_VISUAL_FAIL = $Fail } else { Remove-Item Env:QA_VISUAL_FAIL -ErrorAction SilentlyContinue }
$fixture = Start-Process -FilePath "node" -ArgumentList "tools/qa/visual-fixture.mjs" `
  -WorkingDirectory $root -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput (Join-Path $logDir "visual-fixture.out.log") `
  -RedirectStandardError (Join-Path $logDir "visual-fixture.err.log")
$preview = Start-Process -FilePath "C:\Program Files\nodejs\npx.cmd" `
  -ArgumentList "vite preview --port $PreviewPort --strictPort --host 127.0.0.1 --outDir `"$snapshot`"" `
  -WorkingDirectory (Join-Path $root "app") -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput (Join-Path $logDir "visual-preview.out.log") `
  -RedirectStandardError (Join-Path $logDir "visual-preview.err.log")

try {
  if (-not (Wait-Port $FixturePort)) { throw "visual fixture did not listen on $FixturePort" }
  if (-not (Wait-Port $PreviewPort)) { throw "vite preview did not listen on $PreviewPort" }
  $args = @("tools/qa/visual-capture.mjs", "--out", $Out, "--views", $Views,
    "--fixture", "http://127.0.0.1:$FixturePort", "--base", "http://127.0.0.1:$PreviewPort")
  if ($Only) { $args += @("--only", $Only) }
  if ($Extra) { $args += $Extra.Split(" ") }
  & node @args
  if ($LASTEXITCODE -ne 0) { Write-Host "capture exited $LASTEXITCODE" }
} finally {
  foreach ($proc in @($preview, $fixture)) {
    if ($proc -and -not $proc.HasExited) {
      & taskkill /PID $proc.Id /T /F 2>&1 | Out-Null
    }
  }
}
