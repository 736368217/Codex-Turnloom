# 2.2.3 更新通道：三态 + 两段链路的确定性取证（Vera）
# 真实 bundle，只在 native 桥边界替换 R2 清单与电脑端 /api/app/update 的应答。
$ErrorActionPreference = "Stop"
$root = "D:\Turn-DSH\Codex-Turnloom"
Set-Location $root
$scenarios = @(
  @{ name = "A-public-ok";       pub = "ok";        srv = "404";     tap = "1" },
  @{ name = "B-fallback";        pub = "404";       srv = "ok";      tap = "" },
  @{ name = "C-both-dead";       pub = "timeout";   srv = "timeout"; tap = "" },
  @{ name = "D-current";         pub = "older";     srv = "404";     tap = "" },
  @{ name = "E-schema-fallback"; pub = "badschema"; srv = "timeout"; tap = "" }
)
foreach ($s in $scenarios) {
  $env:QA_UPDATE_PUBLIC = $s.pub
  $env:QA_UPDATE_SERVER = $s.srv
  if ($s.tap) { $env:QA_UPDATE_TAP_DOWNLOAD = "1" } else { Remove-Item Env:QA_UPDATE_TAP_DOWNLOAD -ErrorAction SilentlyContinue }
  $out = "tmp/qa-update/$($s.name)"
  Write-Host "==== $($s.name)  public=$($s.pub) server=$($s.srv)"
  & node tools/qa/capture.mjs --only settings --viewports 390x844 --out $out 2>&1 |
    Select-String -Pattern "update-panel|update-manual|update-download" | ForEach-Object { $_.Line }
  & node tools/qa/read-update-report.mjs "$out/report.json"
}
Remove-Item Env:QA_UPDATE_PUBLIC, Env:QA_UPDATE_SERVER, Env:QA_UPDATE_TAP_DOWNLOAD -ErrorAction SilentlyContinue
Write-Host "done"


