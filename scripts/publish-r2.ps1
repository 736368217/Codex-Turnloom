<#
    publish-r2.ps1 — 把 Turnloom 的 APK 与更新清单发布到 Cloudflare R2（经 Worker 上传端点）。

    为什么走 Worker 而不是 R2 S3 端点：本机到 <account>.r2.cloudflarestorage.com
    的 TLS 会被中间层打断，而自定义域名 dl.736.de5.net 正常。Worker 用 R2 binding
    读写，本机只需 PUT（协议沿用 car-browser 的 publish_r2.ps1）。

    产物（对象 key）：
        turnloom/Codex-Turnloom-<version>.apk   安装包
        turnloom/latest.json                    客户端检查更新用的清单（唯一公网源）
        turnloom/history/<version>.json         每个版本的清单副本（便于回滚）

    客户端契约（2.2.3 起）：`{version, versionCode, apk, size, sha256, publishedAt, notes}`，
    `apk` 是对象 key，App 侧拼成 `https://dl.736.de5.net/<apk>`。

    用法：
        # 只验参数与清单，不碰网络（token 不在也能跑）
        powershell -NoProfile -File scripts\publish-r2.ps1 -Version 2.2.3 -VersionCode 92 `
                   -Apk dist-app\Codex-Turnloom-2.2.3-app-signed.apk -Notes "公网更新通道" -DryRun

        # 真发（token 默认读 Desktop\认证\r2-upload-token.txt）
        powershell -NoProfile -File scripts\publish-r2.ps1 -Version 2.2.3 -VersionCode 92 `
                   -Apk dist-app\Codex-Turnloom-2.2.3-app-signed.apk -Notes "公网更新通道"

    免费额度守卫：R2 免费存储 10 GB/月。默认占到 5 GB 就拒绝上传并打印清理提示；
    删掉旧对象后再跑即恢复，不需要改开关。
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$Apk,
    [int]$VersionCode = 0,
    [string]$Notes = '',
    [string]$Project = 'turnloom',
    [string]$BaseUrl = 'https://dl.736.de5.net',
    [string]$TokenFile = '',
    [int64]$MaxBytes = 5368709120,
    # 项目签名（turnloom-debug.keystore，可覆盖 2.1.3–2.2.x）。发错 key 的 APK 装不上手机，
    # 所以这一条是失败关闭的：找不到 apksigner 或指纹不符都不发布。
    [string]$ExpectedCertSha256 = '2feb63c511cd725795cadc8fa890f9cbc754fe59c0bbfe0787ac33f94f44fa9c',
    [string]$AndroidHome = '',
    [switch]$SkipSignatureCheck,
    [switch]$DryRun,
    [switch]$SkipReadback
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if (-not $TokenFile) {
    $TokenFile = Join-Path ([Environment]::GetFolderPath('Desktop')) '认证\r2-upload-token.txt'
}

function Fail($msg) { Write-Host "FAIL: $msg" -ForegroundColor Red; exit 1 }
function Ok($msg) { Write-Host "OK:   $msg" -ForegroundColor Green }

function Get-Sha256Hex([string]$path) {
    $alg = [System.Security.Cryptography.SHA256]::Create()
    $fs = [System.IO.File]::OpenRead($path)
    try { $bytes = $alg.ComputeHash($fs) } finally { $fs.Dispose(); $alg.Dispose() }
    return (-join ($bytes | ForEach-Object { $_.ToString('x2') }))
}

if (-not (Test-Path -LiteralPath $Apk)) { Fail "APK not found: $Apk" }
if ($Version -notmatch '^[A-Za-z0-9][A-Za-z0-9._+-]*$') { Fail "version must look like 2.2.3" }
if ($VersionCode -le 0) { Fail "VersionCode is required (integer > 0)" }

$apkItem = Get-Item -LiteralPath $Apk

# ------------------------------------------------------- 签名/身份预检（失败关闭）--
function Find-BuildTool([string]$name) {
    $roots = @()
    if ($AndroidHome) { $roots += $AndroidHome }
    if ($env:ANDROID_HOME) { $roots += $env:ANDROID_HOME }
    if ($env:ANDROID_SDK_ROOT) { $roots += $env:ANDROID_SDK_ROOT }
    $roots += (Join-Path $env:USERPROFILE 'tools\android-sdk')
    foreach ($root in $roots) {
        $bt = Join-Path $root 'build-tools'
        if (-not (Test-Path -LiteralPath $bt)) { continue }
        $dir = Get-ChildItem -LiteralPath $bt -Directory | Sort-Object Name -Descending | Select-Object -First 1
        if (-not $dir) { continue }
        $candidate = Join-Path $dir.FullName $name
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    return ''
}

if (-not $SkipSignatureCheck) {
    # Fail closed on the VALUE, not on the parameter existing: under Windows
    # PowerShell 5.1 a UTF-8 file without BOM is decoded as CP936, and a mangled
    # line can silently drop this parameter (a $null expected value made
    # `-notmatch ''` always true — the guard "passed" every APK).
    if ($ExpectedCertSha256 -notmatch '^[0-9a-f]{64}$') {
        Fail "expected cert sha256 is missing or malformed; refusing to publish (check the script encoding: it must be UTF-8 with BOM)"
    }
    $apkSigner = Find-BuildTool 'apksigner.bat'
    if (-not $apkSigner) { $apkSigner = Find-BuildTool 'apksigner' }
    if (-not $apkSigner) { Fail "apksigner not found (set -AndroidHome). Publishing an unverified APK is refused; pass -SkipSignatureCheck to override." }
    $certs = (& $apkSigner verify --print-certs $apkItem.FullName 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) { Fail "apksigner verify failed: $certs" }
    if ($certs -notmatch [regex]::Escape($ExpectedCertSha256)) {
        Fail "APK is not signed with the project key. Expected $ExpectedCertSha256. Cert output: $certs"
    }
    Ok "signature matches the project key (2feb63c5…)"

    $aapt2 = Find-BuildTool 'aapt2.exe'
    if (-not $aapt2) { $aapt2 = Find-BuildTool 'aapt2' }
    if ($aapt2) {
        $badging = (& $aapt2 dump badging $apkItem.FullName 2>&1 | Out-String)
        if ($badging -match "versionCode='(\d+)'") {
            if ([int]$Matches[1] -ne $VersionCode) { Fail "APK versionCode is $($Matches[1]), but -VersionCode is $VersionCode" }
        } else { Fail "could not read versionCode from the APK" }
        if ($badging -match "versionName='([^']+)'") {
            if ($Matches[1] -ne $Version) { Fail "APK versionName is $($Matches[1]), but -Version is $Version" }
        } else { Fail "could not read versionName from the APK" }
        if ($badging -match "package: name='([^']+)'") {
            if ($Matches[1] -ne 'com.codex.turnloom.app') { Fail "APK package is $($Matches[1]), expected com.codex.turnloom.app" }
        }
        Ok "identity matches $Version ($VersionCode)"
    } else {
        Write-Host "warning : aapt2 not found, version identity not checked" -ForegroundColor Yellow
    }
} else {
    Write-Host "warning : signature check skipped by request" -ForegroundColor Yellow
}

$sha = Get-Sha256Hex $apkItem.FullName
$size = $apkItem.Length
$apkKey = "$Project/Codex-Turnloom-$Version.apk"

$manifest = [ordered]@{
    version     = $Version
    versionCode = $VersionCode
    apk         = $apkKey
    size        = $size
    sha256      = $sha
    publishedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    notes       = $Notes
}
$manifestJson = ($manifest | ConvertTo-Json -Depth 4)

Write-Host "project : $Project"
Write-Host "version : $Version (code $VersionCode)"
Write-Host "source  : $($apkItem.FullName)"
Write-Host "apk     : $apkKey  $size bytes"
Write-Host "sha256  : $sha"
Write-Host "base    : $BaseUrl"

if ($DryRun) {
    Write-Host "--- latest.json (dry run) ---"
    Write-Host $manifestJson
    Write-Host "dry run: nothing uploaded"
    exit 0
}

if (-not (Test-Path -LiteralPath $TokenFile)) { Fail "upload token missing: $TokenFile" }
$token = (Get-Content -LiteralPath $TokenFile -Raw -Encoding UTF8).Trim()
if (-not $token) { Fail "upload token is empty: $TokenFile" }

# ---------------------------------------------------------------- 配额守卫 --
$usageRaw = & curl.exe -sS --max-time 60 -H "X-Upload-Token: $token" "$BaseUrl/_ls" 2>&1 | Out-String
try { $usage = $usageRaw | ConvertFrom-Json } catch { Fail "usage query failed: $usageRaw" }
$used = [int64]0
foreach ($o in $usage.objects) { $used += [int64]$o.size }
$after = $used + $size
$limitMb = [math]::Round($MaxBytes / 1MB, 0)
$usedMb = [math]::Round($used / 1MB, 2)
$afterMb = [math]::Round($after / 1MB, 2)
$pct = [math]::Round(100.0 * $after / $MaxBytes, 1)
Write-Host "storage : used $usedMb MB, after upload $afterMb MB / $limitMb MB ($pct%)"
if ($usage.truncated) { Write-Host "warning : object list truncated at 1000 entries, usage is a lower bound" -ForegroundColor Yellow }
if ($after -gt $MaxBytes) {
    Fail "free-quota guard: $afterMb MB > $limitMb MB. Delete old objects (e.g. $Project/history/* and retired APKs) and rerun. Nothing was uploaded."
}

function UploadFile([string]$key, [string]$path, [string]$contentType) {
    $url = "$BaseUrl/$key"
    $curlArgs = @('-sS', '--max-time', '300', '-X', 'PUT',
        '-H', "X-Upload-Token: $token",
        '-H', "Content-Type: $contentType",
        '--data-binary', "@$path",
        '-w', "`n%{http_code}",
        $url)
    $out = & curl.exe @curlArgs 2>&1 | Out-String
    $code = ($out.Trim() -split "`n")[-1].Trim()
    if ($code -ne '200') { Fail "upload $key -> HTTP $code : $out" }
    Ok "uploaded $key"
}

UploadFile -key $apkKey -path $apkItem.FullName -contentType 'application/vnd.android.package-archive'

$tmp = Join-Path $env:TEMP ("turnloom-latest-$Version.json")
[System.IO.File]::WriteAllText($tmp, $manifestJson, (New-Object System.Text.UTF8Encoding($false)))
try {
    UploadFile -key "$Project/latest.json" -path $tmp -contentType 'application/json; charset=utf-8'
    UploadFile -key "$Project/history/$Version.json" -path $tmp -contentType 'application/json; charset=utf-8'
} finally {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
}

if ($SkipReadback) { Write-Host "published (readback skipped): $BaseUrl/$Project/latest.json"; exit 0 }

$check = & curl.exe -sS --max-time 60 "$BaseUrl/$Project/latest.json" 2>&1 | Out-String
if ($check -notmatch [regex]::Escape($sha)) { Fail "readback: latest.json does not carry this sha256 : $check" }
Ok "readback latest.json"

$head = & curl.exe -sS -I --max-time 60 "$BaseUrl/$apkKey" 2>&1 | Out-String
if ($head -notmatch '200') { Fail "readback: APK not reachable : $head" }
Ok "readback $apkKey"

Write-Host ""
Write-Host "published: $BaseUrl/$Project/latest.json"
