# Option A UI 规格（机械提取）

> 本文件只从以下源码逐字提取，不新增颜色/尺寸/规则：
> - `app/src/theme/optionATokens.ts`
> - `app/src/theme/globals.css`
> - `app/src/theme/chatStyles.ts`
>
> 禁止项另摘自 `docs/option-a/SINGLE_APP_CONTRACT.md`。每个值后标注来源文件与行号；源码未定义的写“未在源码中定义”。

## 1. 色板表（token 名 / 值 / 用途）

| Token 名 | 值 | 用途 | 来源 |
|---|---|---|---|
| canvas | `#F2F2F7` | 画布底色 | `optionATokens.ts:9`、`globals.css:13` |
| surface | `#FFFFFF` | 卡片/表面 | `optionATokens.ts:10`、`globals.css:14` |
| fillSecondary | `#EFEFF4` | 次级填充 | `optionATokens.ts:11`、`globals.css:15` |
| separator | `#E5E5EA` | 分隔线 | `optionATokens.ts:12`、`globals.css:16` |
| labelPrimary | `#1C1C1E` | 主文字 | `optionATokens.ts:13`、`globals.css:17` |
| labelSecondary | `#636366` | 次级文字 | `optionATokens.ts:14`、`globals.css:18` |
| blue | `#007AFF` | 主强调色 | `optionATokens.ts:15`、`globals.css:19` |
| green | `#34C759` | 成功/正向 | `optionATokens.ts:16`、`globals.css:20` |
| red | `#FF3B30` | 危险/负向 | `optionATokens.ts:17`、`globals.css:21` |
| actionBlue | `#0062CC` | 蓝底白字按钮及小号状态文字 | `optionATokens.ts:18` |
| actionGreen | `#1F7A35` | 绿底白字按钮及小号状态文字 | `optionATokens.ts:19` |
| actionRed | `#B4231B` | 红底白字按钮及小号状态文字 | `optionATokens.ts:20` |
| diffAddBg | `#E8F8EE` | diff 新增背景 | `optionATokens.ts:21`、`globals.css:22` |
| diffAddFg | `#1E7E34` | diff 新增前景 | `optionATokens.ts:22`、`globals.css:23` |
| diffDelBg | `#FDECEC` | diff 删除背景 | `optionATokens.ts:23`、`globals.css:24` |
| diffDelFg | `#C82333` | diff 删除前景 | `optionATokens.ts:24`、`globals.css:25` |
| sheetHandle | `#C7C7CC` | 抽屉拖拽条 | `optionATokens.ts:25`、`globals.css:26` |
| glass nav | `rgba(255,255,255,.82)` / CSS `rgba(255, 255, 255, .82)` | 导航玻璃背景 | `optionATokens.ts:29`、`globals.css:27` |
| glass nav backdrop | `blur(20px) saturate(180%)` | 导航玻璃模糊 | `optionATokens.ts:30`、`globals.css:30` |
| glass thumb | `rgba(255,255,255,.85)` / CSS `rgba(255, 255, 255, .85)` | 拇指条玻璃背景 | `optionATokens.ts:31`、`globals.css:28` |
| glass thumb backdrop | `blur(24px) saturate(180%)` | 拇指条玻璃模糊 | `optionATokens.ts:32`、`globals.css:31` |
| glass sheet | `rgba(255,255,255,.95)` / CSS `rgba(255, 255, 255, .95)` | 抽屉玻璃背景 | `optionATokens.ts:33`、`globals.css:29` |
| glass sheet backdrop | `blur(40px) saturate(180%)` | 抽屉玻璃模糊 | `optionATokens.ts:34`、`globals.css:32` |

## 2. 字体与行高（字号、行高、字重、使用位置）

| 字号 | 行高 | 字重 | 使用位置 | 来源 |
|---|---|---|---|---|
| 未在源码中定义 | 未在源码中定义 | 未在源码中定义 | `body` 字体族：`-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", "Segoe UI", system-ui, sans-serif` | `globals.css:65-66` |
| 未在源码中定义 | 未在源码中定义 | 未在源码中定义 | `button, input, textarea, select`：`font: inherit; color: inherit` | `globals.css:79-82` |
| 10px | 13px | 500 | `.tl-tabbar-label`，`letter-spacing: .1px` | `globals.css:228-231` |
| 22px | 28px | 700 | `.tl-sheet-title`，`letter-spacing: -.4px` | `globals.css:305-308` |
| 13px | 18px | 未在源码中定义 | `.tl-sheet-subtitle` | `globals.css:314-316` |
| 12px | 20px | 未在源码中定义 | `.tl-diff-line`，等宽字体 `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` | `globals.css:333-335` |
| 34px | 41px | 700 | `.tl-large-title`，`letter-spacing: -.8px` | `globals.css:347-350` |
| 13px | 18px | 600 | `.tl-section-title`，`letter-spacing: .4px`，`text-transform: uppercase` | `globals.css:355-359` |
| 15px | 21px | 600 | `.tl-empty-card .tl-empty-title` | `globals.css:420` |
| 30px | 未在源码中定义 | 未在源码中定义 | `.tl-connect-header h1` | `globals.css:444` |
| 13px | 1.5 | 未在源码中定义 | `.tl-connect-header p, .tl-connect-hint`；颜色 `#63636a` | `globals.css:445` |
| 14px | 未在源码中定义 | 未在源码中定义 | `.tl-connect-manual` | `globals.css:447` |
| 13px | 未在源码中定义 | 600 | `.tl-connect-form label`；颜色 `#63636a` | `globals.css:449` |
| 16px | 未在源码中定义 | 未在源码中定义 | `.tl-connect-form input` | `globals.css:450` |
| 16px | 未在源码中定义 | 600 | `.tl-connect-submit` | `globals.css:454` |
| 13px | 1.5 | 未在源码中定义 | `.tl-connect-error`；颜色 `#a9231b`，背景 `#fff0ee` | `globals.css:456` |
| 12px | 1.8 | 未在源码中定义 | `.tl-connect-footer`；颜色 `#63636a` | `globals.css:459` |
| 14px | 21px | 400 | `.tl-chat-list` 及其后代；`letter-spacing: normal`，`text-align: left` | `globals.css:515-518`、`chatStyles.ts:56-58` |
| 14px | 21px | 未在源码中定义 | `.tl-chat-bubble`；chat bubble 字重 `400`（`chatStyles.ts:38`） | `globals.css:557-559`、`chatStyles.ts:12`、`chatStyles.ts:38-39` |
| 12px | 17px | 未在源码中定义 | `.tl-chat-attachment` | `globals.css:611-612`、`chatStyles.ts:146-147` |
| 16px | 22px | 未在源码中定义 | `.tl-composer-input` | `globals.css:679-680` |
| 13px | 16px | 未在源码中定义 | `.tl-model-trigger` | `globals.css:714-715` |
| 12px | 16px | 600 | `.tl-composer-button` | `globals.css:777-779` |
| 11.5px | 15px | 未在源码中定义 | `.tl-composer-attachment` | `globals.css:810-811` |
| 12px | 17px | 未在源码中定义 | `.tl-composer-error`；颜色 `#a9231b` | `globals.css:843-844` |
| 14px | 未在源码中定义 | 未在源码中定义 | `.tl-composer-sheet-option` | `globals.css:859` |
| 12px | 17px | 未在源码中定义 | `.tl-composer-sheet-subtitle` | `globals.css:863` |
| 13px | 未在源码中定义 | 未在源码中定义 | `.tl-mp-provider` | `globals.css:905` |
| 15px | 未在源码中定义 | 未在源码中定义 | `.tl-mp-search input` | `globals.css:931` |
| 15px | 20px | 500 | `.tl-mp-model-name` | `globals.css:970-972` |
| 12px | 16px | 未在源码中定义 | `.tl-mp-model-meta` | `globals.css:980-981` |
| 13px | 19px | 未在源码中定义 | `.tl-mp-note` | `globals.css:989-990` |
| 13px | 18px | 未在源码中定义 | `.tl-mp-effort-note` | `globals.css:995-996` |
| 12px | 16px | 600 | `.tl-mp-effort-label` | `globals.css:1009-1011` |
| 13px | 未在源码中定义 | 500 | `.tl-mp-segment button` | `globals.css:1029-1030` |
| 13px | 未在源码中定义 | 600 | `.tl-mp-segment button[aria-pressed="true"]` | `globals.css:1034-1035` |
| 14px | 未在源码中定义 | 未在源码中定义 | `.tl-newtask-project-head` | `globals.css:1061` |
| 13.5px | 未在源码中定义 | 未在源码中定义 | `.tl-newtask-project` | `globals.css:1086` |
| 12px | 未在源码中定义 | 600 | `.tl-newtask-project-check` | `globals.css:1101-1102` |
| 16px | 23px | 700 | `.tl-chat-bubble .tl-markdown :is(h1...h6)` | `globals.css:1120` |
| 12px | 19px | 未在源码中定义 | `.tl-chat-bubble .tl-markdown code`；等宽字体 | `globals.css:1130` |
| 12px | 18px | 未在源码中定义 | `.tl-page-note`；颜色 `#63636a` | `globals.css:1139` |
| 12px | 16px | 未在源码中定义 | `.tl-conn-banner`；颜色 `#8A5300`，背景 `#FFF4E5` | `globals.css:1148-1151` |
| 12px | 未在源码中定义 | 700 | `.tl-conn-banner button` | `globals.css:1158-1159` |
| 13px | 未在源码中定义 | 600 | `.tl-list-actions button` | `globals.css:1164` |
| 14px | 未在源码中定义 | 未在源码中定义 | `.tl-monitor-title` | `globals.css:1166` |
| 13px | 20px | 未在源码中定义 | `.tl-link-address` | `globals.css:1167` |
| 13px | 18px | 700 | `.tl-approval-title` | `globals.css:1171` |
| 11px | 未在源码中定义 | 600 | `.tl-approval-kind`；颜色 `#a9231b` | `globals.css:1172` |
| 13px | 19px | 未在源码中定义 | `.tl-approval-content` | `globals.css:1173` |
| 13px | 未在源码中定义 | 700 | `.tl-approval-actions button` | `globals.css:1177` |
| 12px | 17px | 未在源码中定义 | `.tl-approval-error`；颜色 `#b42318` | `globals.css:1181` |
| 13px | 未在源码中定义 | 600 | `.tl-approval-resolved`；颜色 `#1e7e34` | `globals.css:1182` |
| 11px | 16px | 未在源码中定义 | `.tl-approval-id`；等宽字体，颜色 `#636366` | `globals.css:1183` |
| 12px | 未在源码中定义 | 600 | `.tl-thought-head` | `globals.css:1203-1204` |
| 13px | 19px | 未在源码中定义 | `.tl-thought-body` | `globals.css:1213-1214` |
| 12px | 未在源码中定义 | 600 | `.tl-tool-head` | `globals.css:1231-1232` |
| 12px | 18px | 未在源码中定义 | `.tl-tool-body`；等宽字体 | `globals.css:1245-1246` |
| 13px | 19px | 未在源码中定义 | `.tl-chat-notice`；颜色 `#8A5A00`，背景 `#FFF4E5` | `globals.css:1257-1259` |
| 13px | 未在源码中定义 | 600 | `.tl-view-switch__item` | `globals.css:1279-1280` |
| 13px | 未在源码中定义 | 600 | `.tl-group-head` | `globals.css:1295-1296` |
| 12px | 未在源码中定义 | 未在源码中定义 | `.tl-archive-toggle` | `globals.css:1311` |
| 16px | 未在源码中定义 | 600 | `.tl-confirm-title` | `globals.css:1331` |
| 14px | 20px | 未在源码中定义 | `.tl-confirm-body` | `globals.css:1332` |
| 12px | 17px | 未在源码中定义 | `.tl-confirm-note` | `globals.css:1333` |
| 15px | 未在源码中定义 | 600 | `.tl-confirm-actions button` | `globals.css:1344-1345` |

## 3. 圆角、阴影、间距

| 类别 | 规则 | 来源 |
|---|---|---|
| 圆角 | card `16` / CSS `--tl-radius-card: 16px` | `optionATokens.ts:38`、`globals.css:33` |
| 圆角 | sheet `24` / CSS `--tl-radius-sheet: 24px` | `optionATokens.ts:39`、`globals.css:34` |
| 阴影 | CARD_SHADOW `0 1px 3px rgba(0,0,0,.04)` / CSS `0 1px 3px rgba(0, 0, 0, .04)` | `optionATokens.ts:42`、`globals.css:35` |
| 抽屉拖拽条 | width `36`、height `6`；CSS `width: 36px !important; height: 6px !important; min-height: 6px; border-radius: 3px; margin-top: 10px; margin-bottom: 2px` | `optionATokens.ts:45-46`、`globals.css:280-287` |
| 按压 | scale `0.98`、opacity `0.8`、durationMs `150`；CSS `scale(.98)`、`opacity: .8`、`transition ... 150ms` | `optionATokens.ts:50-52`、`globals.css:148-157` |
| 最小热区 | MIN_TAP_SIZE `44` / CSS `--tl-tap: 44px` | `optionATokens.ts:56`、`globals.css:36` |
| 屏幕底部留白 | `.tl-screen` `padding-bottom: calc(128px + env(safe-area-inset-bottom, 0px))`；`.tl-screen::after height: calc(48px + env(safe-area-inset-bottom, 0px))`；`.tl-screen--detail padding-bottom: calc(128px + env(safe-area-inset-bottom, 0px))` | `globals.css:117`、`globals.css:123`、`globals.css:128` |
| 分隔线 | `.tl-separator height: 1px`；`.tl-hairline-top/bottom border .5px solid var(--tl-separator)`；TabBar `border-top: .5px solid var(--tl-separator)` | `globals.css:133`、`globals.css:343-344`、`globals.css:206` |
| 抽屉主体 | `max-height: 92vh`；`padding: 4px 20px calc(24px + env(safe-area-inset-bottom, 0px))` | `globals.css:262`、`globals.css:301` |
| TabBar 项 | `min-height: 56px`、`gap: 2px`、`padding: 6px 2px` | `globals.css:213`、`globals.css:218`、`globals.css:222` |

## 4. 组件规则（卡片、导航、TabBar、抽屉、输入舱、按钮、状态胶囊）

### 卡片
- `.tl-card`：`display: block; background: var(--tl-surface); border-radius: var(--tl-radius-card); box-shadow: var(--tl-card-shadow)`（`globals.css:99-104`）。
- `.tl-chat-list`：`border-radius: 16px; background: var(--tl-surface); box-shadow: var(--tl-card-shadow); margin: 0 12px 10px; padding: 10px 10px 2px`（`globals.css:499-506`）。
- `.tl-empty-card`：`padding: 16px !important; margin: 0 16px !important`（`globals.css:410-411`）。

### 导航
- `.tl-glass-nav`：`background: var(--tl-glass-nav); backdrop-filter: var(--tl-blur-nav); -webkit-backdrop-filter: var(--tl-blur-nav); border-top: .5px solid var(--tl-separator)`（`globals.css:166-171`）。
- `.tl-glass-chip`：`background: var(--tl-glass-nav); backdrop-filter: var(--tl-blur-nav); -webkit-backdrop-filter: var(--tl-blur-nav)`（`globals.css:185-189`）。

### TabBar
- `.tl-tabbar`：`position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; display: flex; align-items: stretch; padding-bottom: env(safe-area-inset-bottom, 0px); background: rgba(255, 255, 255, .94); border-top: .5px solid var(--tl-separator); transform: translateZ(0)`（`globals.css:193-208`）。
- `.tl-tabbar-item`：`flex: 1 1 0; min-width: var(--tl-tap); min-height: 56px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; border: 0; background: transparent; color: var(--tl-label-secondary); padding: 6px 2px`（`globals.css:210-223`）。
- `.tl-tabbar-item--active { color: var(--tl-blue); }`（`globals.css:225`）。
- `.tl-tabbar [role="tab"] * { color: #8E8E93 !important; }`；激活态 `.tl-tabbar [role="tab"].k-tabbar-link-active * { color: #007AFF !important; }`（`globals.css:382-383`）。
- 后续覆盖：`.tl-tabbar [role="tab"] * { color: #636366 !important; }`；激活态 `.tl-tabbar [role="tab"].k-tabbar-link-active * { color: #0062CC !important; }`（`globals.css:469-470`）。
- 按压：`.tl-tabbar .tl-press:active { transform: none; opacity: 1; background-color: rgba(0, 122, 255, .07); }`（`globals.css:387-391`、`globals.css:431-436`）。

### 抽屉
- `[data-vaul-drawer-wrapper]`：`height: 100%; background: var(--tl-canvas)`（`globals.css:238-241`）。
- `[data-vaul-overlay]`：`position: fixed; inset: 0; z-index: 40; background: rgba(28, 28, 30, .22)`（`globals.css:247-252`）。
- `[data-vaul-drawer]`：`position: fixed !important; left: 0; right: 0; bottom: 0; z-index: 41; width: 100%; max-height: 92vh; border-radius: var(--tl-radius-sheet) var(--tl-radius-sheet) 0 0; background: #FFFFFF; box-shadow: 0 -8px 32px rgba(0, 0, 0, .10); border-top: .5px solid rgba(255, 255, 255, .95); overflow: hidden; touch-action: none`（`globals.css:255-274`）。
- `[data-vaul-handle]`：`width: 36px !important; height: 6px !important; min-height: 6px; background: var(--tl-sheet-handle) !important; opacity: 1 !important; border-radius: 3px; margin-top: 10px; margin-bottom: 2px; flex: 0 0 auto`（`globals.css:279-289`）。
- `[data-vaul-handle-hitarea]`：`min-width: var(--tl-tap); min-height: var(--tl-tap)`（`globals.css:291-294`）。

### 输入舱
- `.tl-composer`：`flex: 0 0 auto; position: relative; z-index: 30; box-sizing: border-box; width: 100%; max-height: 44vh; overflow-y: auto; background: #FFFFFF; border-top: .5px solid var(--tl-separator); padding: 8px 12px calc(8px + env(safe-area-inset-bottom, 0px))`（`globals.css:630-641`）。
- `.tl-composer-card`：`border: 1px solid var(--tl-separator); border-radius: 22px; background: #FFFFFF; box-shadow: 0 1px 2px rgba(0, 0, 0, .03); padding: 4px 6px 4px`（`globals.css:644-653`）。
- `.tl-composer-input`：`min-height: 40px; max-height: 96px; border-radius: 18px; background: transparent; color: var(--tl-label-primary); padding: 7px 8px; font-size: 16px; line-height: 22px; resize: none`（`globals.css:665-685`）。
- `.tl-composer-send`：`width: 40px; min-width: 40px; height: 40px; min-height: 40px; border-radius: 20px; background: var(--tl-blue); color: #FFFFFF`；禁用 `background: #C7C7CC; color: #FFFFFF`；停止态 `background: var(--tl-red)`（`globals.css:747-762`）。
- 窄屏：`@media (max-width: 393px)` composer padding `7px`、row gap `4px`、icon width `44px`；`@media (max-width: 320px)` composer padding `5px`、row gap `3px`、button min-width `44px`（`globals.css:865-881`）。
- 矮屏：`@media (max-height: 420px)` composer `max-height: 52vh`、input `min-height: 44px; max-height: 60px`（`globals.css:883-886`）。

### 按钮
- `.tl-press`：`transition: transform var(--tl-press-duration) ease, opacity var(--tl-press-duration) ease, background-color var(--tl-press-duration) ease; cursor: pointer; touch-action: manipulation`；`:active` 为 `transform: scale(.98); opacity: .8`（`globals.css:147-158`）。
- `.tl-tap`：`min-width: var(--tl-tap); min-height: var(--tl-tap)`（`globals.css:142-145`）。
- `.tl-composer-button`：`min-width: 44px; min-height: 44px; border-radius: 13px; padding: 0 8px; font-size: 12px; line-height: 16px; font-weight: 600`；icon variant `width: 44px; padding: 0`；primary `min-width: 48px`（`globals.css:765-784`）。
- `button:disabled { opacity: .48; cursor: default; }`（`globals.css:455`）。
- `button:focus-visible, a:focus-visible { outline: 2px solid var(--tl-blue); outline-offset: 2px; }`（`globals.css:461`）。

### 状态胶囊
- 源码中出现的是 glass chip 与状态色规则；独立的“状态胶囊”组件定义未在三个指定源码文件中定义。
- `.tl-glass-chip` 使用 nav 玻璃：`background: var(--tl-glass-nav); backdrop-filter: var(--tl-blur-nav); -webkit-backdrop-filter: var(--tl-blur-nav)`（`globals.css:185-189`）。
- 抽屉前置提示 `.tl-conn-banner`：`background: #FFF4E5; color: #8A5300; border-radius: 12px`（`globals.css:1141-1152`）。
- 审批状态：`.tl-approval-reject { background: #fff0ee; color: #b42318; }`；`.tl-approval-approve { background: #e8f8ee; color: #1e7e34; }`；`.tl-approval-resolved { color: #1e7e34; }`（`globals.css:1179-1182`）。

### 分段控件（2.2.6 起，取代 `.tl-filter-chip` 双药丸）

- 结构：**一条 track + 一个 thumb**。track `height: 44px; padding: 3px; border-radius: 999px; background: #E9E9EE` 或 `rgba(118,118,128,.12)`；cell `min-width: 88px`、绘制高 38px（命中带仍是整条 44，可用 `::before { inset: -4px 0 }` 在轨道内补，**不得**越出轨道）；控件**紧凑居中**，不强制满宽。thumb 绝对定位，`height: calc(100% - 6px); width: calc((100% - 6px) / 选项数); border-radius: 999px; background: #FFF`，附 `0 1px 2px rgba(0,0,0,.10)`、`0 3px 8px -4px rgba(0,0,0,.18)`、`0 0 0 .5px rgba(0,0,0,.03)`。
- 位移只用一个属性：`transform: translateX(index × 100%)`，`300ms cubic-bezier(.32,.72,0,1)`；文字透明度与字重 `200ms`。**禁止**用 `left`/`width` 做动画；**禁止**用两块各自填充的背景色表示选中（旧 `.tl-filter-chip.is-active` 的黑底药丸即为反例）。
- 位置：**必须在滚动容器之外**（与标题行同属固定区）。反例：2.2.5 的 `.tl-thread-filters` 在 `.tl-thread-scroll` 内，`scrollTop=600` 时 rail 从 `y=100` 掉到 `y=-500`，翻到列表中段无法切视图。判据：`scrollTop=600` 时分段仍在可视区。
- 命中：cell 宽 = 轨道一半、高 44；44 就是全部命中带，不外扩（2.2.5 实测 chip 外 3px 已回滚动容器，别指望伪元素补面积）。
- `prefers-reduced-motion: reduce` 下关闭上述 transition（不是缩短）。

### 设备层级（2.2.6 起）

- 三级隶属：**电脑 → 平台 → 入口（harness）**。切换电脑时才渲染该电脑的平台；切换平台时才渲染该平台的入口。禁止把三层平铺进同一个列表（旧「切换电脑上的服务」抽屉即为反例）。
- 平台不是实体，是 `harness.kind` + 显示名映射（`codex` → Codex Desktop，`pi` → PI-Desktop）。禁止按 `name` 字符串猜平台；新增平台前先确认 `deploy/machine.example.json` 中该行 `kind` 正确。
- 非当前电脑**不做实时探活**：不画在线/离线灯，只给「上次使用 N 分钟前」。入口行的在线状态是**发现时刻的快照**，文案不得写「实时」。
- 入口行不显示逐行地址（discovery 不外发端口）。
- 命中区：电脑卡 ≥ 64，平台卡 ≥ 56，入口行 ≥ 44。
- 设备卡常驻会话页头部（电脑名 + 平台 + 状态 + 模型 chip，点开层级面板）；底栏因此只保留 会话 / 设置 两项。

### 字号下限

- 正文最小 **11px**（2.2.5 现状即 11px、正文最低对比度 5.37:1）。新设计不得再往下压；新增 11px 文本须实测对比度 ≥ 4.5:1。

## 5. 禁止项（摘自 token 注释与 SINGLE_APP_CONTRACT.md）

- `Light mode is HARD LOCKED. No dark variant, no black canvas, no desktop centered preview shell.`（`globals.css:8-9`）
- `Light mode is hard-locked; there is no dark variant anywhere in the app.`（`optionATokens.ts:58`）
- `!important guards against Vaul's inline background assignment when shouldScaleBackground is on: the app must never show a black canvas.`（`globals.css:60-61`）
- `No full-screen backdrop-filter: a full-viewport blur is recomposited every frame during the drawer animation and was the main source of jank.`（`globals.css:243-245`）
- `Legacy .tl-thumbbar rules were removed: the chat composer owns its layout.`（`globals.css:234`）
- `Obsolete thumbbar grid/order rules removed; .tl-composer owns narrow layout.`（`globals.css:472`）
- `No equal-space distribution of paragraph or line boxes.`（`globals.css:564`）
- `Press feedback is an opacity/color change only: transform on a fixed tab button changes pointer geometry (the visual "shrink" defect).`（`globals.css:385-386`）
- `Neither is used on the fixed tab bar so pointer geometry and hit-test bounds are identical before, during and after a press.`（`globals.css:428-430`）
- `全局硬锁浅色，禁止 dark mode、黑底、桌面栅格、网页居中 max-w-[430px] mx-auto shadow-2xl 壳。`（`SINGLE_APP_CONTRACT.md:108`）
- `禁止 server.url / dev server / 远程 index.html / CDN 字体或脚本`（`SINGLE_APP_CONTRACT.md:57`）
- `删除正常用户页面中的 ROUTE、Bridge 计数、占位能力说明及无用标语，保持蓝色原始环形 logo 和浅色界面。`（`SINGLE_APP_CONTRACT.md:14`）
- `禁止再叫「纯原生 App / 非 WebView 原生」。`（`SINGLE_APP_CONTRACT.md:22`）
- `全局单例 CupertinoSheetHost，所有二级交互 100% 用 Vaul 底部抽屉，禁止居中 Modal。`（`SINGLE_APP_CONTRACT.md:115`）

## 6. 2.2.5 会话头部与模型面板（产品形态；不是机械提取）

Human 15:43 的原始要求，写成可执行条款，避免下次再按字面做成「居中两枚按钮」或「目录浏览器」。

### 会话头部
- 第一行：左返回 + 会话标题；标题过长用省略号，不被右侧控件挤成两行。
- 第二行：`项目：<name> · <状态>`；**没有项目时整段 `项目：…` 不出现**，只留状态（Codex 会话不硬塞「未归类」）。
- 右上角模型 chip（`.tl-header-model`）：`min-height: 44px`、`max-width: 44%`，内容 = 模型短名 + 思考强度 + 下拉箭头。模型名可省略号，**强度是短 token，必须 `flex: 0 0 auto; white-space: nowrap`，不许折成两行**（390 上真出现过「最/高」竖排）。
- chip 打开的就是模型面板，不存在第二个入口；输入框上方不再有模型行。

### 模型面板（`ModelEffortSheet`）
- 标题「模型」；副标「电脑端已加入的 N 个模型」（N 不含状态行）。语义是「切换我已加入的模型 + 强度」，不是「浏览目录」。
- 行集合 = **服务端给的集合，数组顺序即面板顺序**（宿主已把 pinned 置前并保持组内相对顺序）。渲染层不再过滤、不再重排；`provider/providerLabel/modelId/label/pinned` 由契约提供，UI 不 split `id`。
- 供应商筛选条只在 ≥2 个真实供应商时出现；搜索框只在 >8 行（或已有输入）时出现。3 个模型的常见形态下两者都不出现，面板只有标题 + 3 行 + 强度。
- 置顶行右侧显示 pin 图标（`aria-label`/`title` 为「已置顶」）。
- **唯一允许的集合外条目**：当前会话模型已不在服务端集合（电脑端移除/停用）时，列表最前加一条**状态行**——`aria-disabled="true"`、不可点、副标「电脑端未加入」，chip 同步显示红色「已移除」徽标。只许一条，不许把历史用过的模型累积成列表。
- 普通发送不因打开面板而带 `model`；只有用户显式改选才发 `model`/`effort`。

### 默认模型（单一真源）
- 回退顺序只写在 `resolveTurnPreference`：`thread.model`（按 suffix + provider 归一）→ `catalog.lastUsedModel`（**必须在集合内**）→ `catalog.defaultModel`。
- `runtimeStore`/`normalizeHealthCatalog` 只携带 `lastUsedModel`，取不到就是 `""`，不在别处补默认值。
- 断言：`chip ⊂ panel` —— 用同一份 `normalizeHealthCatalog` 产物与面板同一个 `panelRows()`，解析出的模型必须在面板里能找到（`test/app-model-panel.test.cjs`）。

