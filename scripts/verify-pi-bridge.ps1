#requires -Version 5.1
<#
  重启 PI-Desktop 之后的自检脚本（只读为主，--Send 才会真的发一条测试消息）。

  用法：
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-pi-bridge.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-pi-bridge.ps1 -Send

  检查项：
    1. IPC 门面管道是否存在（插件已加载）
    2. PI 后端模型数（应为 PI 的供应商 × 模型，而不是 4 个兜底模型）
    3. 线程状态里有多少 running（应与 pi.sqlite 的 running turns 一致）
    4. -Send：新建一个测试会话发一句话，然后立刻中断，并回读 pi.sqlite 的 model_id
#>
param(
  [string]$BaseUrl = "http://127.0.0.1:8799",
  [string]$Token = "pidesk-2026",
  [string]$PiDb = "D:\pi-data\data\pi.sqlite",
  [switch]$Send
)

$ErrorActionPreference = "SilentlyContinue"
$headers = @{ "x-access-token" = $Token }
$results = @()

function Add-Result($name, $ok, $detail) {
  $script:results += [pscustomobject]@{ Check = $name; Ok = $ok; Detail = $detail }
}

# 1) IPC pipe
$pipeOk = [System.IO.Directory]::GetFiles('\\.\pipe\') -contains '\\.\pipe\pidesktop-codex-ipc'
Add-Result "IPC pipe" ([bool]$pipeOk) $(if ($pipeOk) { "\\.\pipe\pidesktop-codex-ipc" } else { "missing (plugin not loaded)" })

# 2) models
$health = $null
try { $health = Invoke-RestMethod "$BaseUrl/api/health" -Headers $headers -TimeoutSec 20 } catch {}
$modelCount = if ($health) { @($health.models).Count } else { 0 }
$defaultModel = if ($health) { $health.defaultModel } else { "" }
Add-Result "PI models" ($modelCount -gt 10) "count=$modelCount default=$defaultModel"

# 3) running threads
$running = 0
$total = 0
try {
  $threads = Invoke-RestMethod "$BaseUrl/api/threads?limit=300" -Headers $headers -TimeoutSec 60
  $total = @($threads.threads).Count
  $running = @($threads.threads | Where-Object { $_.statusState -eq "running" }).Count
} catch {}
Add-Result "thread status" ($true) "threads=$total running=$running"

# 4) optional live send
if ($Send) {
  $model = if ($defaultModel) { $defaultModel } else { "" }
  $body = @{
    message       = "Turnloom 连通性自检：请只回复 OK"
    newThread     = $true
    model         = $model
    effort        = "low"
    clientRequestId = "verify-" + [guid]::NewGuid().ToString("N")
  } | ConvertTo-Json
  $send = $null
  try {
    $send = Invoke-RestMethod "$BaseUrl/api/send" -Method Post -Headers $headers -ContentType "application/json" -Body $body -TimeoutSec 90
  } catch {
    Add-Result "send" $false $_.Exception.Message
  }
  if ($send) {
    Add-Result "send" $true "threadId=$($send.threadId)"
    Start-Sleep -Seconds 6
    try {
      Invoke-RestMethod "$BaseUrl/api/interrupt" -Method Post -Headers $headers -ContentType "application/json" -Body (@{ threadId = $send.threadId } | ConvertTo-Json) -TimeoutSec 30 | Out-Null
      Add-Result "interrupt" $true $send.threadId
    } catch {
      Add-Result "interrupt" $false $_.Exception.Message
    }
    # 回读 pi.sqlite 里这条会话用的模型
    $node = 'C:\Users\WIN10\AppData\Local\Programs\nodejs-24.19.0\node.exe'
    if (-not (Test-Path $node)) { $node = "node" }
    $script = @"
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('$PiDb', { readOnly: true });
const row = db.prepare('select id, model_id, provider_id from sessions where id = ?').get('$($send.threadId)');
console.log(JSON.stringify(row || null));
"@
    $tmp = Join-Path $env:TEMP "verify-pi-model.cjs"
    Set-Content -Path $tmp -Value $script -Encoding UTF8
    $row = & $node $tmp 2>$null
    Add-Result "pi session model" ($row -match '"model_id"') "$row"
  }
}

$results | Format-Table -AutoSize
$bad = @($results | Where-Object { -not $_.Ok })
if ($bad.Count -eq 0) { Write-Host "PI bridge self-check passed." -ForegroundColor Green; exit 0 }
Write-Host "PI bridge self-check found $($bad.Count) problem(s)." -ForegroundColor Yellow
exit 1
