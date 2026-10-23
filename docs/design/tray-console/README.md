# 托盘控制台设计稿源文件

这些 HTML 只用于生成视觉稿，不是最终应用代码。

- `base.css`：设计 token 与全部页面样式
- `mock.js`：内联图标、品牌 logo、示意二维码
- `overview.html` / `logs.html` / `settings.html` / `tray.html` / `pairing.html` / `exit.html` / `onboarding.html` / `states.html`
- `board.html`：九张界面的总览板
- `overview.html?dark=1`：深色模式

重新生成截图（Chrome headless，2x）：

```powershell
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$dir = (Resolve-Path "docs\design\tray-console").Path
$out = (Resolve-Path "docs\assets\tray-console").Path
& $chrome --headless=new --hide-scrollbars --force-device-scale-factor=2 `
  --window-size=1120,760 --virtual-time-budget=3500 `
  --screenshot="$out\01-overview.png" "file:///$($dir -replace '\\','/')/overview.html"
```

> 设计稿中的二维码与访问码均为示意数据，不可用于真实配对。
