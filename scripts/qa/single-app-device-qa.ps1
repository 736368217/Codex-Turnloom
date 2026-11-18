#requires -Version 5.1
<#
.SYNOPSIS
  MuMu phone device QA skeleton for the single-line App (ROUTE=dom-shell).
  ONLY legal emulator entry point: mumu-lease.ps1
    acquire -Owner <owner> -Profile phone -> QA -> release -Owner <owner> -Index N
.DESCRIPTION
  PLACEHOLDER PARAMETERS FOR THE MAIN SESSION:
    -Owner : this session's unique id (session id / task name), unchanged for
             the whole lease.
    -Index : instance number returned by mumu-lease acquire (phone pool 1 or 6).
             If empty, the acquire result is reused automatically.
  This is a SKELETON: captures screenshots + UI XML, runs static text assertions
  for the Anti-Web criteria. It does not fake a device, does not run forever,
  does not spawn visible windows, and does not start long-lived processes.
  UTF-8 WITHOUT BOM, source pure ASCII (PS5.1 decodes BOM-less scripts via ANSI
  cp936); ALL Chinese (messages + regex patterns) is base64(UTF-8) decoded at
  runtime. The main session executes this script; this sub-session only writes it.
#>
[CmdletBinding()]
param(
    [string]$Owner       = '',
    [string]$Index       = '',
    [string]$Profile     = 'phone',
    [string]$LeaseScript = 'D:\Program Files\Netease\MuMu\mumu-patch-kit\mumu-lease.ps1',
    [string]$Adb         = 'C:\Users\WIN10\AppData\Local\Android\Sdk\platform-tools\adb.exe',
    [string]$ApkPath     = 'D:\pi11\11\Codex-Turnloom\dist-app\Codex-Turnloom-2.1.1-app.apk',
    [string]$OutDir      = 'D:\pi11\11\Codex-Turnloom\dist-app\qa-device',
    [string]$PackageName = 'com.codex.turnloom.app',
    [string]$Activity    = 'com.codex.turnloom.app.MainActivity',
    [int]$TtlMinutes     = 30
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$script:Zh = @{
        'qa_owner_hint' = '5o+Q56S677yaLU93bmVyIOivt+Whq+acrOS8muivneWUr+S4gOagh+ivhu+8iOWFqOeoi+S4jeWPmO+8ie+8my1JbmRleCDor7floasgbXVtdS1sZWFzZSBhY3F1aXJlIOi/lOWbnueahOWunuS+i+WPt++8iHBob25lIOaho+mAmuW4uCAxIOaIliA277yJ77yM55WZ56m65YiZ6Ieq5Yqo5aSN55SoIGFjcXVpcmUg6L+U5Zue5YC844CC6aqo5p626buY6K6k5LiN5omn6KGM77yM5YWI55Sx5Li75Lya6K+d5aGr5aW95Y+C5pWw44CC'
        'qa_err_owner' = '6ZSZ6K+v77yaLU93bmVyIOS4jeiDveS4uuepuu+8jOW/hemhu+eUseS4u+S8muivneWhq+WGmeOAgg=='
        'qa_err_lease' = '6ZSZ6K+v77yaTXVNdSDllK/kuIDnp5/lgJ/lhaXlj6PkuI3lrZjlnKjvvIh7MH3vvInjgII='
        'qa_err_adb' = '6ZSZ6K+v77yaYWRiLmV4ZSDkuI3lrZjlnKjvvIh7MH3vvInjgII='
        'qa_err_apk' = '6ZSZ6K+v77ya5b6F5a6J6KOFIEFQSyDkuI3lrZjlnKjvvIh7MH3vvInjgII='
        'qa_err_outdir' = '6ZSZ6K+v77ya5peg5rOV5Yib5bu6IFFBIOS6p+eJqeebruW9le+8iHswfe+8ieOAgg=='
        'qa_err_acquire' = '6ZSZ6K+v77yabXVtdS1sZWFzZSBhY3F1aXJlIOWksei0pe+8iOmAgOWHuueggSB7MH3vvInvvJp7MX0='
        'qa_err_verify' = '6ZSZ6K+v77yabXVtdS1sZWFzZSB2ZXJpZnkg5qGj5L2N5qCh6aqM5pyq6YCa6L+H77yIezB977yJ44CC'
        'qa_err_devices' = '6ZSZ6K+v77yaYWRiIGRldmljZXMg5peg5Zyo57q/6K6+5aSH44CC5LiN6KaB5Zyo5bel5YW35Lya6K+d6YeMIGFkYiBzdGFydC1zZXJ2ZXLvvJvlj6/nlLHkuLvkvJror53op6blj5HorqHliJLku7vliqEgTXVNdUFkYlN5bmMg5ZCO5YaN6K+V44CC'
        'qa_err_install' = '6ZSZ6K+v77yaYWRiIGluc3RhbGwg5aSx6LSl77yI6YCA5Ye656CBIHswfe+8ieOAgg=='
        'qa_err_cmd' = '6ZSZ6K+v77yaYWRiIOWRveS7pOWksei0pe+8iOmAgOWHuueggSB7MH3vvInvvJp7MX0='
        'qa_err_xml' = '6ZSZ6K+v77ya6YeH6ZuGIFVJIFhNTCDlpLHotKXvvIh7MH3vvInjgII='
        'qa_err_shot' = '6ZSZ6K+v77ya6YeH6ZuG5oiq5Zu+5aSx6LSl77yIezB977yJ44CC'
        'qa_chk_tabs' = 'NCDkuKrlupXpg6ggVGFi77ya6aaW6aG1IC8g5Lya6K+dIC8g55uR5o6nIC8g6K6+572u'
        'qa_chk_status' = '6aaW6aG15py65Zmo54q25oCB5Y2h'
        'qa_chk_drawer' = 'VmF1bCDmir3lsYnvvIjmi5bmi73mnaEgLyDog4zmma/nvKnmlL7vvIk='
        'qa_chk_thumb' = '6IGK5aSp6K+m5oOFIFRodW1iR2xhc3NCYXI='
        'qa_chk_nochrome' = '5peg5Zyw5Z2A5qCPIC8g5YmN6L+b5ZCO6YCAIC8g5Yi35pawIC8gZm9vdGVyIC8gaGFtYnVyZ2Vy'
        'qa_chk_airplane' = '6aOe6KGM5qih5byP5Ya35ZCv5Yqo5Y+v5riy5p+T77yI5peg5rWP6KeI5Zmo6ZSZ6K+v6aG177yJ'
        'qa_chk_back' = '57O757uf6L+U5Zue6ZSu5o6l566h77yI5pegIFdlYlZpZXcuZ29CYWNrKCnvvIk='
        'qa_note_release' = '6K+05piO77yaUUEg57uT5p2f5b+F6aG7IHJlbGVhc2UgLU93bmVyIDxvd25lcj4gLUluZGV4IE7vvJvmnKzohJrmnKzlnKggZmluYWxseSDkuK3lvLrliLblvZLov5jjgII='
        'qa_note_hidden' = '6K+05piO77ya5LiNIFN0YXJ0LVByb2Nlc3Mg5paw56qX5Y+j44CB5LiNIHdoaWxlKHRydWUpIOW4uOmpu+OAgeS4jeWGmeeZu+W9leiHquWQr++8m+WtkOi/m+eoi+e7p+aJv+W3sumakOiXj+eahOWuv+S4u+aOp+WItuWPsOOAgg=='
        'qa_note_out' = '6K+05piO77ya5oiq5Zu+5LiOIFVJIFhNTCDlhpnlhaUgezB9IOS+m+S6uuW3pS/op4bop4nlpI3moLjvvJvohJrmnKzlj6rlgZrpnZnmgIHmlofmnKzmlq3oqIDjgII='
        'qa_done_ok' = '5a6M5oiQ77yaTXVNdSBwaG9uZSDlrp7mnLogUUEg5YWo6YOo6YCa6L+H77yM5oql5ZGKIHswfeOAgg=='
        'qa_done_fail' = '5a6M5oiQ77yaTXVNdSBwaG9uZSDlrp7mnLogUUEg5a2Y5Zyo5aSx6LSl6aG577yM5oql5ZGKIHswfeOAgg=='
        'note_route' = '6K+05piO77yaUk9VVEU9ZG9tLXNoZWxs77yM6K+a5a6e56ew44CMQXBwIOWMliBET00g5a655Zmo77yI5ZCrIFdlYlZpZXfvvInjgI3jgII='
        'rx_tabs' = '6aaW6aG1fOS8muivnXznm5Hmjqd86K6+572ufEhvbWV8VGhyZWFkc3xNb25pdG9yc3xTZXR0aW5ncw=='
        'rx_status' = '54q25oCBfHN0YXR1c3xtYWNoaW5lfOW8leaTjnxlbmdpbmV85rS76LeDfGFjdGl2ZQ=='
        'rx_chrome' = 'YWRkcmVzc3x1cmxfYmFyfEVkaXRUZXh0fOWIt+aWsHzliY3ov5t85ZCO6YCAfHJlbG9hZHxoYW1idXJnZXJ8YnJlYWRjcnVtYnxmb290ZXI='
        'rx_drawer' = 'c2hlZXR8ZHJhd2VyfOaLluaLvXxoYW5kbGV8QXBwcm92ZXxSZWplY3R86YWN5a+5fOaWsOW7unxWYXVs'
        'rx_thumb' = 'VGh1bWJ8dGh1bWJ8SW50ZXJydXB0fOa2iOaBr3xtZXNzYWdlfFRoaW5raW5nfFRlcm1pbmFs'
        'rx_backbad' = 'RVJSX3xuZXQ6OnxXZWJwYWdlIG5vdCBhdmFpbGFibGV85peg5rOV6K6/6ZeufOaJvuS4jeWIsOe9kemhtQ=='
        'rx_offline' = 'T0ZGTElORXznprvnur9857yT5a2YfGNhY2hlfOmmlumhtXxIb21lfOeKtuaAgXxzdGF0dXM='
        'rx_offbad' = 'RVJSX3xXZWJwYWdlIG5vdCBhdmFpbGFibGV8bmV0Ojo='
}
function M {
    param([string]$Key, [object[]]$Fmt = @())
    $raw = $script:Zh[$Key]
    if (-not $raw) { return $Key }
    $text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($raw))
    if ($Fmt.Count -gt 0) { $text = [string]::Format($text, $Fmt) }
    return $text
}
function Rx { param([string]$Key) return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($script:Zh[$Key])) }
function Say { param([string]$Msg) Write-Host ('[qa-device] ' + $Msg) }
function Fail { param([string]$Msg) throw $Msg }
function WriteUtf8NoBom {
    param([string]$Path, [string]$Text)
    [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false)))
}
function Invoke-Lease {
    # & on mumu-lease.ps1 returns its single-line JSON. It ends with "exit $code";
    # called with & this sets $LASTEXITCODE but does NOT terminate the caller
    # (verified on PS5.1). NEVER Start-Process / new window here.
    param([string]$Action, [string]$Extra = '')
    $a = @('-Action', $Action, '-Owner', $Owner)
    if ($Action -eq 'acquire') { $a += @('-Profile', $Profile, '-TtlMinutes', "$TtlMinutes") }
    if ($Action -eq 'verify' -or $Action -eq 'release' -or $Action -eq 'heartbeat') { $a += @('-Index', $Extra) }
    if ($Action -eq 'heartbeat') { $a += @('-TtlMinutes', "$TtlMinutes") }
    $out = & $LeaseScript @a 2>&1 | Out-String
    $code = $LASTEXITCODE
    $json = $null
    try { $json = $out.Trim() | ConvertFrom-Json } catch { }
    return [pscustomobject]@{ code = $code; text = $out.Trim(); json = $json }
}
function Invoke-Adb {
    # All adb calls go through & with $LASTEXITCODE checked. No PS '>' redirect
    # of PNG (it corrupts binaries); screenshots use screencap + pull.
    param([string[]]$ToolArgs, [string]$FailKey, [switch]$Capture)
    $text = ''
    Push-Location (Split-Path $Adb -Parent)
    try {
        if ($Capture) { $text = (& $Adb @ToolArgs 2>&1 | Out-String) }
        else { & $Adb @ToolArgs }
        $code = $LASTEXITCODE
    }
    finally { Pop-Location }
    if ($code -ne 0) { Fail (M $FailKey @($code, $text.Trim())) }
    return $text
}
function Assert-File { param([string]$Path, [string]$Key) if (-not (Test-Path -LiteralPath $Path)) { Fail (M $Key @($Path)) } }

$checks = New-Object System.Collections.ArrayList
function Add-Check {
    param([string]$Name, [bool]$Ok, [string]$Detail = '')
    $null = $checks.Add([ordered]@{ name = $Name; ok = $Ok; detail = $Detail })
    $tag = if ($Ok) { 'PASS' } else { 'FAIL' }
    Say ($tag + '  ' + $Name + $(if ($Detail) { '  -- ' + $Detail } else { '' }))
}

Say (M 'note_route')
Say (M 'note_hidden')
Say (M 'note_release')
Say (M 'qa_owner_hint')

$acquired = $false
$leaseIndex = $Index
$serial = ''
$startedAt = Get-Date

try {
    # --- 0. Preconditions ----------------------------------------------------
    if ([string]::IsNullOrWhiteSpace($Owner)) { Fail (M 'qa_err_owner') }
    if ($Profile -ne 'phone') { Fail 'Profile must be phone for this App QA' }
    Assert-File -Path $LeaseScript -Key 'qa_err_lease'
    Assert-File -Path $Adb -Key 'qa_err_adb'
    Assert-File -Path $ApkPath -Key 'qa_err_apk'
    try { if (-not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null } }
    catch { Fail (M 'qa_err_outdir' @($_.Exception.Message)) }
    Say (M 'qa_note_out' @($OutDir))

    # --- 1. ACQUIRE (only legal MuMu entry point) ----------------------------
    $acq = Invoke-Lease -Action 'acquire'
    if ($acq.code -ne 0 -or -not $acq.json -or -not $acq.json.ok) {
        Fail (M 'qa_err_acquire' @($acq.code, $acq.text))
    }
    $acquired = $true
    if ([string]::IsNullOrWhiteSpace($leaseIndex)) { $leaseIndex = [string]$acq.json.index }
    $adbPort = [string]$acq.json.adbPort
    Say ('acquire ok: owner=' + $Owner + ' index=' + $leaseIndex + ' adbPort=' + $adbPort)

    # --- 2. VERIFY profile / resolution --------------------------------------
    $ver = Invoke-Lease -Action 'verify' -Extra $leaseIndex
    if ($ver.code -ne 0 -or -not $ver.json -or -not $ver.json.ok) { Fail (M 'qa_err_verify' @($ver.text)) }

    # --- 3. adb devices -> online serial (never hardcode) --------------------
    $devText = Invoke-Adb -ToolArgs @('devices') -FailKey 'qa_err_cmd' -Capture
    $online = @()
    foreach ($ln in ($devText -split "`r?`n")) {
        if ($ln -match '^\s*([^\s]+)\s+device\s*$') { $online += $matches[1] }
    }
    if ($online.Count -eq 0) { Fail (M 'qa_err_devices') }
    $serial = $online | Where-Object { $_ -like "*:$adbPort" } | Select-Object -First 1
    if (-not $serial) { $serial = $online[0] }
    Say ('adb serial=' + $serial)

    # --- 4. Install APK ------------------------------------------------------
    Invoke-Adb -ToolArgs @('-s', $serial, 'install', '-r', $ApkPath) -FailKey 'qa_err_install'

    # --- helpers: screenshot + UI XML ----------------------------------------
    function Save-Shot {
        param([string]$Tag)
        $remote = '/sdcard/turnloom-qa-' + $Tag + '.png'
        $local = Join-Path $OutDir ($Tag + '.png')
        Invoke-Adb -ToolArgs @('-s', $serial, 'shell', 'screencap', '-p', $remote) -FailKey 'qa_err_shot'
        Invoke-Adb -ToolArgs @('-s', $serial, 'pull', $remote, $local) -FailKey 'qa_err_shot'
        return $local
    }
    function Save-Xml {
        param([string]$Tag)
        $remote = '/sdcard/turnloom-qa-' + $Tag + '.xml'
        $local = Join-Path $OutDir ($Tag + '.xml')
        Invoke-Adb -ToolArgs @('-s', $serial, 'shell', 'uiautomator', 'dump', $remote) -FailKey 'qa_err_xml'
        Invoke-Adb -ToolArgs @('-s', $serial, 'pull', $remote, $local) -FailKey 'qa_err_xml'
        if (-not (Test-Path -LiteralPath $local)) { Fail (M 'qa_err_xml' @($local)) }
        return $local
    }

    # --- 5. Cold start (home) ------------------------------------------------
    Invoke-Adb -ToolArgs @('-s', $serial, 'shell', 'am', 'force-stop', $PackageName) -FailKey 'qa_err_cmd'
    Invoke-Adb -ToolArgs @('-s', $serial, 'shell', 'am', 'start', '-n', ($PackageName + '/' + $Activity)) -FailKey 'qa_err_cmd'
    Start-Sleep -Seconds 3
    $homeShot = Save-Shot -Tag '01-home'
    $homeXmlPath = Save-Xml -Tag '01-home'
    $homeXml = [IO.File]::ReadAllText($homeXmlPath, [Text.Encoding]::UTF8)

    # --- 6. Static UI XML assertions (Anti-Web) ------------------------------
    # CN tab labels come from base64 table; fall back to EN labels.
    $tabNames = @((Rx 'rx_tabs') -split '\|')[0..3]
    $tabOk = $true
    foreach ($t in $tabNames) { if ($homeXml -notmatch [regex]::Escape($t)) { $tabOk = $false } }
    if (-not $tabOk) {
        $tabOk = ($homeXml -match 'Home') -and ($homeXml -match 'Threads') -and ($homeXml -match 'Monitors') -and ($homeXml -match 'Settings')
    }
    Add-Check -Name (M 'qa_chk_tabs') -Ok $tabOk -Detail $homeXmlPath
    Add-Check -Name (M 'qa_chk_status') -Ok ($homeXml -match (Rx 'rx_status')) -Detail $homeShot
    # No browser chrome: address bar / forward-back / refresh / footer / hamburger.
    $chromeBad = [regex]::Matches($homeXml, (Rx 'rx_chrome'))
    Add-Check -Name (M 'qa_chk_nochrome') -Ok ($chromeBad.Count -eq 0) -Detail ('matches=' + $chromeBad.Count)

    # --- 7. Vaul drawer ------------------------------------------------------
    # NOTE: coordinates are PLACEHOLDERS; main session must replace with taps
    # driven by real UI XML resource-id / text. 1080x1920 phone reference.
    Invoke-Adb -ToolArgs @('-s', $serial, 'shell', 'input', 'tap', '540', '700') -FailKey 'qa_err_cmd'
    Start-Sleep -Seconds 1
    $drawerShot = Save-Shot -Tag '02-drawer'
    $drawerXmlPath = Save-Xml -Tag '02-drawer'
    $drawerXml = [IO.File]::ReadAllText($drawerXmlPath, [Text.Encoding]::UTF8)
    Add-Check -Name (M 'qa_chk_drawer') -Ok ($drawerXml -match (Rx 'rx_drawer')) -Detail $drawerShot

    # --- 8. Thread detail ThumbGlassBar --------------------------------------
    Invoke-Adb -ToolArgs @('-s', $serial, 'shell', 'input', 'tap', '300', '1850') -FailKey 'qa_err_cmd'
    Start-Sleep -Seconds 1
    Invoke-Adb -ToolArgs @('-s', $serial, 'shell', 'input', 'tap', '540', '600') -FailKey 'qa_err_cmd'
    Start-Sleep -Seconds 1
    $detailShot = Save-Shot -Tag '03-detail'
    $detailXmlPath = Save-Xml -Tag '03-detail'
    $detailXml = [IO.File]::ReadAllText($detailXmlPath, [Text.Encoding]::UTF8)
    Add-Check -Name (M 'qa_chk_thumb') -Ok ($detailXml -match (Rx 'rx_thumb')) -Detail $detailShot

    # --- 9. Back key takeover (no WebView.goBack) ----------------------------
    Invoke-Adb -ToolArgs @('-s', $serial, 'shell', 'input', 'keyevent', '4') -FailKey 'qa_err_cmd'
    Start-Sleep -Seconds 1
    $backXmlPath = Save-Xml -Tag '04-back'
    $backXml = [IO.File]::ReadAllText($backXmlPath, [Text.Encoding]::UTF8)
    Add-Check -Name (M 'qa_chk_back') -Ok ($backXml -notmatch (Rx 'rx_backbad')) -Detail $backXmlPath

    # --- 10. Airplane-mode cold start ----------------------------------------
    Invoke-Adb -ToolArgs @('-s', $serial, 'shell', 'settings', 'put', 'global', 'airplane_mode_on', '1') -FailKey 'qa_err_cmd'
    Invoke-Adb -ToolArgs @('-s', $serial, 'shell', 'am', 'broadcast', '-a', 'android.intent.action.AIRPLANE_MODE', '--ez', 'state', 'true') -FailKey 'qa_err_cmd'
    Invoke-Adb -ToolArgs @('-s', $serial, 'shell', 'am', 'force-stop', $PackageName) -FailKey 'qa_err_cmd'
    Invoke-Adb -ToolArgs @('-s', $serial, 'shell', 'am', 'start', '-n', ($PackageName + '/' + $Activity)) -FailKey 'qa_err_cmd'
    Start-Sleep -Seconds 3
    $offShot = Save-Shot -Tag '05-airplane'
    $offXmlPath = Save-Xml -Tag '05-airplane'
    $offXml = [IO.File]::ReadAllText($offXmlPath, [Text.Encoding]::UTF8)
    $offOk = ($offXml -match (Rx 'rx_offline')) -and ($offXml -notmatch (Rx 'rx_offbad'))
    Add-Check -Name (M 'qa_chk_airplane') -Ok $offOk -Detail $offShot
    Invoke-Adb -ToolArgs @('-s', $serial, 'shell', 'settings', 'put', 'global', 'airplane_mode_on', '0') -FailKey 'qa_err_cmd'
    Invoke-Adb -ToolArgs @('-s', $serial, 'shell', 'am', 'broadcast', '-a', 'android.intent.action.AIRPLANE_MODE', '--ez', 'state', 'false') -FailKey 'qa_err_cmd'

    # --- 11. Report ----------------------------------------------------------
    $failed = @($checks | Where-Object { -not $_.ok })
    $report = [ordered]@{
        generatedAt = (Get-Date).ToString('o'); startedAt = $startedAt.ToString('o')
        route = 'dom-shell'; owner = $Owner; index = $leaseIndex; profile = $Profile
        serial = $serial; apk = $ApkPath; outDir = $OutDir
        checks = @($checks.ToArray())
        result = if ($failed.Count -eq 0) { 'PASS' } else { 'FAIL' }
        notes = @(
            'screenshots and UI XML captured for human/visual review',
            'static text assertions only; coordinate taps are placeholders',
            'release is mandatory and executed in finally'
        )
    }
    $reportPath = Join-Path $OutDir 'qa-report.json'
    WriteUtf8NoBom -Path $reportPath -Text (($report | ConvertTo-Json -Depth 8) + "`n")
    if ($failed.Count -eq 0) { Say (M 'qa_done_ok' @($reportPath)) }
    else { Say (M 'qa_done_fail' @($reportPath)) }
    if ($failed.Count -gt 0) { throw ('qa checks failed: ' + $failed.Count) }
}
catch {
    Say ('ERROR ' + $_.Exception.Message)
    try {
        if (-not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }
        $fr = [ordered]@{ generatedAt = (Get-Date).ToString('o'); route = 'dom-shell'; owner = $Owner; index = $leaseIndex; result = 'ERROR'; error = $_.Exception.Message; checks = @($checks.ToArray()) }
        WriteUtf8NoBom -Path (Join-Path $OutDir 'qa-report.json') -Text (($fr | ConvertTo-Json -Depth 8) + "`n")
    } catch { }
    throw
}
finally {
    # MUST release: release -Owner <owner> -Index N (graceful shutdown).
    if ($acquired -and -not [string]::IsNullOrWhiteSpace($leaseIndex)) {
        try {
            $rel = Invoke-Lease -Action 'release' -Extra $leaseIndex
            Say ('release done: owner=' + $Owner + ' index=' + $leaseIndex + ' code=' + $rel.code + ' ' + $rel.text)
        }
        catch { Say ('release FAILED: ' + $_.Exception.Message) }
    }
}