# 发布漂移哨兵：公网更新清单（latest.json）与 GitHub Release 必须指向同一份包。
# 跑完没有任何输出 = 两边一致；每个事件一行 JSON，id 稳定，Host 按 id 去重。
# 自包含脚本（Host 用管道执行，没有 $PSScriptRoot）。
$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

$channel = if ($env:TURNLOOM_CHANNEL_URL) { $env:TURNLOOM_CHANNEL_URL } else { 'https://dl.736.de5.net/turnloom/latest.json' }
$repo = if ($env:TURNLOOM_REPO) { $env:TURNLOOM_REPO } else { '736368217/Codex-Turnloom' }
$releasePage = "https://github.com/$repo/releases"
$headers = @{ 'user-agent' = 'turnloom-release-drift'; 'accept' = 'application/json' }

function Emit([string]$id, [string]$title, [string]$url, [string]$detail) {
    $payload = [ordered]@{ id = $id; title = $title; url = $url; detail = $detail }
    [Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress -Depth 4))
}

try {
    $manifest = Invoke-RestMethod -Uri $channel -TimeoutSec 20 -Headers $headers
} catch {
    Emit 'channel-unreachable' '更新通道不可达' $channel ("手机检查更新走的是公网清单，这一份拉不到：" + $_.Exception.Message + "。此时所有设备都会退回电脑端，公网更新等于停摆。")
    exit 0
}

try {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -TimeoutSec 20 -Headers $headers
} catch {
    Emit 'release-unreachable' 'GitHub Release 读不到' $releasePage ("latest release 接口失败：" + $_.Exception.Message + "。可能是仓库改名、API 限流，或 release 被删。")
    exit 0
}

$version = [string]$manifest.version
$tag = [string]$release.tag_name
$assets = @($release.assets)
$apk = $assets | Where-Object { [string]$_.name -like '*.apk' } | Select-Object -First 1

if ($tag -ne "v$version") {
    Emit "version:$tag`:$version" '更新通道与 Release 版本不一致' $releasePage "公网 latest.json 是 $version，GitHub 最新 Release 是 $tag。用户从 Releases 页面下到的，和手机自动更新到的是两个版本。"
}

if ($apk) {
    $digest = ([string]$apk.digest) -replace '^sha256:', ''
    $manifestSha = ([string]$manifest.sha256).ToLowerInvariant()
    if ($digest -and $manifestSha -and ($digest.ToLowerInvariant() -ne $manifestSha)) {
        Emit "digest:$tag`:$version" '安装包哈希与清单不一致' $releasePage ("最新 Release 的 APK sha256 是 " + $digest.Substring(0, [Math]::Min(12, $digest.Length)) + "…，latest.json 声明 " + $manifestSha.Substring(0, [Math]::Min(12, $manifestSha.Length)) + "…。手机下到的包与清单不是同一份。")
    }
} else {
    Emit "release-no-apk:$tag" '最新 Release 没有 APK' $releasePage "$tag 的附件里没有 .apk；从 Releases 页面下载不到安装包。"
}

if ($manifest.apk) {
    $raw = [string]$manifest.apk
    $apkUrl = if ($raw -match '^https?://') { $raw } else { 'https://dl.736.de5.net/' + ($raw -replace '^/+', '') }
    try {
        $head = Invoke-WebRequest -Uri $apkUrl -Method Head -TimeoutSec 20 -UseBasicParsing
        $remote = 0
        try { $remote = [int64]$head.Headers['Content-Length'] } catch { }
        $size = [int64]($manifest.size)
        if ($size -gt 0 -and $remote -gt 0 -and $size -ne $remote) {
            Emit "size:$version`:$size`:$remote" '清单大小与实际文件不符' $apkUrl "latest.json 写 $size B，CDN 上是 $remote B。"
        }
    } catch {
        Emit "apk-unreachable:$version" '清单里的安装包下载不到' $apkUrl ("latest.json 指向的 APK 拉不到（" + $_.Exception.Message + "）。已安装的设备检查更新会一直失败。")
    }
}
