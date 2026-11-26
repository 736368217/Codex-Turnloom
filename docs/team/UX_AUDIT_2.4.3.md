# 2.4.3 设计门禁（NB3）

> 判据先立、实现后签。每条只有「证据」栏填满才算过；没证据的写「未验」，不写「应该可以」。
> 本文件只记录**怎么算过**，不重复范围说明。签字对代码与实测，不对截图。

**证据产物（模拟器侧）**：`40a6a0b` debug 构建 —— APK **2,278,910 B** /
`90765eda7eb6b4323f2ee9e2b3c1f1d1473cc0ec9a272008a0ad9cc85ecf18db`，`emulator-5554`
（780×1688 / density 320；`wm size` 临时改 `640x1040` 与 `640x1290` 两档，即 **320×520 / 320×597** css、dpr 2），
真 Gboard + `adb shell input tap` / `input swipe` 真触摸。量完已复原：`wm size reset`、
`adb forward --remove tcp:9222`、`reverse` 仍是 `tcp:8787` 与 `tcp:8788→8787`、`3492047a` 仍 `unauthorized`。

**发版产物**：`dist-app\Codex-Turnloom-2.4.3-app.apk` —— **1,833,961 B** /
`194d35b3e5ac467ef8f3346e23a8ae02b32616a030fabc4a3b6dac7b5e305784`（与同目录 `.sha256` 一致），
`com.codex.turnloom.app` / `versionName=2.4.3` / `versionCode=102` / 无 `application-debuggable`，
冻结提交 `0f50308`（只动 4 处版本字面量，`git diff --stat 40a6a0b 0f50308 -- app native-shell/app`
= `app/package.json`、`app/src/theme/optionATokens.ts`、`native-shell/app/build.gradle.kts`，无其他改动）。
与测量件的同一性判据见文末「第 2 步」。

**标注句（发布说明与本文共用，不改写）**

`输入法遮挡、320 三页几何、底栏按压曲线：模拟器证据（emulator-5554，320×520 与 320×597，2.4.3 debug 构建 40a6a0b，APK sha256 90765eda…ecf18db，真软键盘）；真机未测`

| # | 条目 | 判据（缺一条不签） | 证据 | 状态 |
|---|---|---|---|---|
| 1 | 连接页「验证并连接」不被软键盘挡 | 真软键盘弹起后：按钮四边都在视口内、`elementFromPoint(中心)` 命中按钮或其子元素、按钮底边距键盘顶 **≥ 12 px**、焦点仍在密码框；Back 收键盘后 `.is-editing` 撤掉、`padding-bottom` 回到 24 px、按钮仍在视口内、焦点不丢 | 320×520（`wm 640x1040`）视口 **213**、容器 `.tl-connect-scroll.is-editing` + `padding-bottom:120px`、`scrollTop 331`、密码框 83–131、按钮 **147–197**（余量 16 px）、命中按钮；320×597（`wm 640x1290`）视口 338、`scrollTop 268`、密码框 145–193、按钮 **209–259**（余量 79 px）、命中；Back 后视口回 472、`padding 24px`、`scrollTop 191`、按钮 287–337、焦点保留。截图
`docs/reports/2.4.3/shot-320-520-ime.png`（128,373→75,015 B，sha256 `073f892b…0fc4f`：520 档、Gboard 起、
按钮整颗在键盘之上） | **模拟器已验 / 真机未测** |
| 2 | 320 三页横向不越界 + tabbar 几何 | 会话/设备/设置三页 `innerWidth = clientWidth = scrollWidth = 320`；tabbar 高 ≥ 56、每项宽 ≥ 44、贴底、不压系统手势区 | 三页三者均 **320**、overflow **0 px**；tabbar **3 × 107×56**、`top 541`（= 597 − 56），视口外另有 24 css 系统导航条 | **模拟器已验 / 真机未测** |
| 3 | 底栏按压反馈：渐隐、不缩放 | 按下 `1 → 0.5` 在 120 ms 量级（102 ± 20）；按住期间稳定在 0.5；松手 **≤ 120 ms** 回 1.0（不是当帧）；`svg` 与 `.tl-tabbar-label` 同步；几何零位移（`transform` 恒 1）；无单帧回弹 | 真 `input swipe` 长按 500 ms、rAF 逐帧采 `opacity`：376 ms 起降、492 ms 到 0.5（**≈116 ms**），759 ms 前恒 0.5，774 → 891 ms 回到 1（**≈117 ms**）；`svg` 与 label 逐帧同值；`transform` 全程 1 | **模拟器已验 / 真机未测** |

代码落点：键盘留白 `app/src/lib/keyboardReveal.ts`（`REVEAL_MARGIN = 12`、`revealOffset`、`visibleBottomOf` 优先
`visualViewport`）+ `app/src/screens/ConnectScreen.tsx` 的 `revealSubmit`；按压过渡在
`app/src/theme/globals.css:303-311` 的基态声明、`:active` 只给 `opacity:.5`；tabbar 尺寸 `:273-288`、`--tl-tap: 44px`。

## 第 2 步：发版件与测量件必须是同一份 web 资产

测量在 debug 构建上做，发版是 release 构建；「同一份」要比出来，不是假设。
`native-shell/app/build.gradle.kts:20` 是 `isMinifyEnabled = false`，release 没开 R8，
所以两边差别只有 manifest 的 `debuggable` 与签名块，Java/Kotlin 也不该被改写。

判据（内容为准；尺寸只是期望，不是判据——构建路径不同可能整体移位）：

1. `assets/public` 的文件集合不变：`index.html` + 一个 `index-*.js` + `connect-hero-*.png`，共 3 个；
2. `connect-hero-mc0wg5zO.png` 字节相同（15,687 B）；
3. `index.html` 把 8 字符脚本指针归一化后**逐字节相同**；
4. bundle 里 `versionName:"…",versionCode:…` 字面量各只出现 **1 次**；把 release 那份归一化成
   `versionName:"2.4.2",versionCode:101` 后与基线 bundle **逐字节相同**——即差异只可能是版本字面量；
5. 尺寸相等（基线 **864,703 B**）是常见形态，打印出来备案；尺寸不等时看第 4 条是否仍成立，
   并把差异条数与字节差写进本文；
6. 任一条不成立 ⇒ `app/` 在测量后动过 ⇒ 三格按条件重测（不是默认重测）。

基线 bundle 的定位锚点：`versionName:"` 从 byte **536,749** 起，值 `2.4.2` 的三个数字在
536,762 / 536,764 / 536,766；bump 只改两个字节——**536,766**（`2→3`）与 **536,783**（`1→2`）。

**已复核**：NB agent 2026-11-26 12:42 独立比对（工作区刷新后的 `index-BFIPvlH6.js` 864,703 B 对基线
`index-DDKc8_DC.js`）——只有 536,766 与 536,783 两个字节不同；`index.html` 756 B，仅脚本名 8 个字符
（670–677）不同；hero png 未变。我的判据脚本两向自验：合成件 PASS、篡改一个字节 FAIL（报出
偏移 100,000 与上下文）。

对**发行件本身**（`Codex-Turnloom-2.4.3-app.apk`）再跑一遍：`assets/public` 三件齐全，
`index-BFIPvlH6.js` 864,703 B 归一化后与基线逐字节相同，`index.html` 756 B 仅指针不同，
hero png sha 相同 → **PASS**。

脚本：`D:\Turn-DSH\.scratch\nb3-audit243\check-243-release.ps1`（不进仓库，避免与
`tools/qa/compare-apk-assets.mjs` 重复）。

任何一条不成立 → 说明 `40a6a0b` 之后 `app/` 又动过，三格按条件重测（owner 已定：条件触发，不是默认）。
注意 `--rewrite` 类归一化只能替换自定界的整段：`102` 在 bundle 里作裸子串出现 25 次、作独立数字 token 也有 1 次
（`--k-color-ios-primary-shade: 0 102 214`），全局替换会伪造一致。

## 第 3 步：发行件装机（模拟器）

1. `adb -s emulator-5554 install -r dist-app\Codex-Turnloom-2.4.3-app.apk` → `Success`；
   `dumpsys package` 变成 `versionName=2.4.3` / `versionCode=102`，`firstInstallTime` 仍是
   2026-11-26 01:05:19（**数据保留**），`lastUpdateTime` 04:43:08。
2. 冷启动：`logcat -c` → `am force-stop` → `am start`；`ActivityTaskManager` 记
   `Displayed com.codex.turnloom.app/.MainActivity: +560ms`，WebView 109.0.5414.123 正常加载；
   全量日志 205 行里 **无 FATAL / AndroidRuntime 异常 / NoClassDefFound / ClassNotFound /
   UnsatisfiedLink**。
3. 设置页版本行：**`版本 2.4.3 (102)`**，副行 `已是最新 · 04:43`；同一页 `当前电脑 Turnloom-QA` /
   `http://127.0.0.1:8787` / `已连接`。截图 `20-243-release-settings.png`（780×1688）。

结论：发行件在模拟器上首启干净、版本行与 `badging` 一致。**这三步只证明包装与自报版本，不替代任何
320 档读数**——那些仍按上表标注「模拟器证据 / 真机未测」。

## 真机挂账

`3492047a` 至今 `unauthorized`（手机侧未点「允许 USB 调试」）。授权后按 `realphone-upgrade.ps1` 在真机上补：
320 三页 overflow 与 tabbar 几何、底栏按压曲线（真触摸）、连接页键盘遮挡（真中文输入法）。
补测后改本文三条状态与标注句，并在主线留一句；owner 给的窗口是 20 分钟。

## 未纳入本次标注

- 归档开关 44 px 触达复量：小A2 自量 320 档 **280×44**、`insideTop` / `insideBottom` 均命中；我尚未独立复量。
- 设置页标题/副行（`57440cd`）的 320 复量：记在 `UX_AUDIT_2.4.2.md` 残项里，本文不重复。
- 会话页 72 处省略号：设计口径未定（两行标题 + 日期另起），2.5.0 候选。
