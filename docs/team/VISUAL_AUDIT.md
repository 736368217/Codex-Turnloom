# 视觉系统与美观检定（App / Option A）

- 范围：`app/`（React + Konsta UI + Vaul，唯一交付线），390×844 为主，补 360×800、320×568、768×1024。
- 方法：真实生产 bundle（`npm run app:build` → `vite preview`）+ 真实 Chromium（Edge headless，CDP），只注入 Android WebView 本应提供的 `window.TurnloomNative`（安全存储 + 原生 HTTP 桥），数据来自 `tools/qa/visual-fixture.mjs` 的合成 `/api/*`。
- 时间：2026-11-18。截图是本机证据，`docs/qa/visual/` 已被 `.gitignore` 排除，不进 git；本文件进 git。
- 截图路径：`docs/qa/visual/<before|after>/<viewport>@<dpr>-<screen>.png`。

复现：

```powershell
npm run app:build
powershell -NoProfile -ExecutionPolicy Bypass -File tools/qa/visual-run.ps1 `
  -Out docs/qa/visual/after -Views "390x844:3,360x800:3,320x568:2,768x1024:2"
```

`tools/qa/visual-run.ps1` 会先把 `app/dist` 快照到 `tmp/dist-snapshot` 再起静态服务，理由是同一工作树里有人并行 rebuild 时，`dist` 的 chunk 会被换掉，页面会白屏——这不是 App 的缺陷，是取证工具的隔离。

---

## 一、问题清单（按严重度）

### P0-1 TabBar 占位算错，内容压在栏下

- 触发：任意列表页滚到底（首页、会话、监控、设置）。
- 现状（改前）：`globals.css` 的 `.tl-screen { padding-bottom: calc(128px + safe) }`、`.tl-screen::after { height: calc(48px + safe) }`，而栏本身是 56px + 安全区（390×844 下实测 57px）。
- 证据：`before/390x844@3-home.png`（「仅显示正在运行的任务…」贴着栏）、`before/390x844@3-threads.png`（最后一行会话被栏压住半行）。
- 期望：留白 = 栏高 + 一行的呼吸量；栏高只定义一次。
- 修法（已落地）：`--tl-tabbar-h: calc(56px + safe)`，`.tl-screen` padding-bottom 96px、`::after` 64px，二者都引用同一变量。
- 验证：`after` 测量 `screenPaddingBottom = 96px`、`tabbar = 390×57`，`overflow = []`。

### P0-2 毛玻璃被关掉，列表从栏里穿出来

- 触发：任何长列表在栏下滚动。
- 现状（改前）：`.tl-tabbar` 用 `rgba(255,255,255,.94)` 纯色，且 `.tl-tabbar > div > div:first-child { backdrop-filter: none !important }` 明确关掉模糊。结果是同一块像素上同时能读到「填充会话 15/18」和「首页 会话 监控 设置」两套文字。
- 证据：`before/390x844@3-threads.png` 底部（灰色会话字与栏内标签叠字）。
- 期望：Option A 的 glass thumb = `rgba(255,255,255,.85)` + `blur(24px) saturate(180%)`。
- 修法（已落地）：栏用 `--tl-glass-thumb` + `--tl-blur-thumb`；Konsta Tabbar 的内部覆盖层整套移除（见 P1-4）。
- 验证：`render` 后 `getComputedStyle` → `blur(24px) saturate(1.8)` / `rgba(255,255,255,.85)`（`after` 测量）。

### P0-3 居中确认弹窗违反 Option A（禁止居中 Modal）

- 触发：会话长按归档、发现新版本提示。
- 现状（改前）：`.tl-confirm-backdrop { align-items:center; justify-content:center }` + 320px 居中卡片 + `0 12px 40px` 阴影，是桌面 Alert 的形态。
- 证据：`before/390x844@3-threads (长按后)` 与 `after/390x844@3-threads-archive-confirm.png` 对照。
- 期望：底部手势抽屉（24px 上圆角 + 36×6 拖拽条 + 底部安全区）。
- 修法（已落地）：backdrop 改为 `align-items:flex-end`，卡片成为全宽底部面板，`::before` 画 36×6 `#C7C7CC` 拖拽条，加 160/200ms 入场（`prefers-reduced-motion` 置零）。
- 验证：`after/390x844@3-threads-archive-confirm.png`（底部面板 + 拖拽条，遮罩 0.22 不压暗文字）。

### P1-4 Tab 语义错误：`role="link"` 挂在 `role="tablist"` 里

- 触发：读屏/键盘用户导航到 TabBar。
- 现状（改前）：`GlassTabBar` 传了 `linkProps.role='tab'`，Konsta 的 `TabbarLink` 仍渲染 `role="link"`（DOM 实测 `BUTTON:link:首页`），外层却是 `role="tablist"`。
- 修法（已落地）：`GlassTabBar` 改为手写 `<nav role="tablist">` + 4 个 `<button role="tab" aria-selected>`（同时去掉 Konsta 注入的不透明白底层）。按压反馈只改背景色，不做 `transform`（栏内 `scale(.98)` 会改变指针几何，是旧「栏突然缩小」缺陷的根因）。
- 验证：`tabItemRole = "tab"`、`tabbarRole = "tablist"`（`after` 测量）。

### P1-5 同一个机器名出现四次，信息量为零

- 触发：首页（尤其 harness 名与机器名相同，如 `736-WIN`）。
- 现状（改前）：`MachineHubHeader` 主行 `harnessName` + 副行 `machineName`；`StatusCard` 标题 `machineName` + 副标题 `harnessName` + 指标「当前服务 `harnessName`」。
- 修法（已落地）：机器名只出现一次（`StatusCard` 标题）；`MachineHubHeader` 主行=服务名（与服务同名时回落到类型 `Codex Desktop`/`PI-Desktop`），副行=`机器名 · host:port`；`StatusCard` 副行=`服务 · host:port`，第三个指标从「当前服务」改为「服务数」。
- 验证：`after/390x844@3-home.png`（「Codex Desktop / QA 工作站 · 127.0.0.1:7812 · 2 个服务」，「QA 工作站 / Codex Desktop · 127.0.0.1:7812」）。

### P1-6 「按项目 / 按时间」触控目标 38px

- 触发：会话页顶部视图切换。
- 现状（改前）：`.tl-view-switch__item { min-height:38px }`（170×38）。
- 修法（已落地）：44px。
- 验证：`viewSwitchItem = 170×44`（`after` 测量）。

### P1-7 三个审批决定时，第三个按钮孤零零占半行

- 触发：host 返回 `decline / approve / approveForSession` 三个决定（常见）。
- 现状（改前）：`.tl-approval-actions` 固定两列，第三个按钮落在第二行左半边，右侧留空，像布局坏了。
- 修法（已落地）：第三个（且是最后一个）跨满整行；只有一个决定时也跨行。
- 验证：`after/390x844@3-chat-approval.png`（拒绝 / 批准 并排，允许本次会话整行）。

### P1-8 正文 14/21，比所有参考产品小一号

- 触发：对话详情任何长文本。
- 现状（改前）：`.tl-chat-bubble` 14px/21px（iMessage、ChatGPT 均为 16–17px）。
- 修法（已落地）：15px/22px、内边距 9/12；`theme/chatStyles.ts` 的常量同步为 `CHAT_BUBBLE_FONT_SIZE=15`、`CHAT_BUBBLE_LINE_HEIGHT=22`，避免「CSS 22 / 常量 21」两个真源。
- 验证：`bubble = { font: "15px", line: "22px", maxWidth: "90%" }`（`after` 测量，≤393px 断点）。

### P1-9 `StatusCard` 用字符 `◉` 冒充图标

- 触发：首页机器状态卡三个指标。
- 现状（改前）：`ActivityPulse()` 返回 `<span>◉</span>`，与两侧 15px Lucide 图标不同字号、不同光学中心。
- 修法（已落地）：改为 15×15 的 SVG（外环 1.6 描边 + 实心点），与 Lucide 同视觉重量。

### P1-10 禁用态主按钮只是「48% 透明的蓝」，与可点态难分

- 触发：未配对连接页（无相机 → 扫码按钮 disabled；地址/访问码为空 → 验证按钮 disabled）。
- 现状（改前）：全局 `button:disabled { opacity:.48 }` 让主按钮变成浅蓝，第一眼仍像可点。
- 修法（已落地）：`ActionButton` 增加 `.tl-action`；`.tl-action:disabled` 改为中性填充 `#C7C7CC` + 白字、`opacity:1`——禁用是状态，不是变淡的副本。
- 验证：`after/390x844@3-connect.png`。

### 未修、需要下一轮（结构性问题，不在 `theme/**` 内能解决）

| 问题 | 证据 | 为什么不在本轮 | 建议 |
|---|---|---|---|
| 整个消息流被套在一张白卡里（`.tl-chat-list` 白底 16px 圆角 + 内边距），长对话像一张设置表单 | `after/390x844@3-chat-markdown.png` | 卡片容器跨 `ChatDetailScreen` 与 CSS，需和 @Vera 一起改 | 画布直铺气泡（`#F2F2F7` 底），只给「思考/工具/变更」保留白卡 |
| 首页没有「继续上次」入口，0 运行任务时整页是状态 + 空态 + 快捷操作 | `after/390x844@3-home.png` | `HomeScreen` 属 @Vera | 最近 3 条会话或默认 Tab 改为「会话」 |
| 监控页「运行中的会话」行内标签写「查看 / 停止」，但点击只进详情 | `after/390x844@3-monitors.png` | @Vera 已改成真停止，需回归确认 | 保持真停止或改文案 |
| 连接页「应用更新」卡片与首页「检查应用更新」重复，且未配对时也占首屏 | `after/390x844@3-connect.png` | 属 `ConnectScreen` | 折叠为一行次要入口 |
| 消息流里的代码块横向滚动、工具输出却自动换行，同一类等宽内容两种行为 | `after/390x844@3-chat-markdown-code.png` | 需要统一取舍（可复制性 vs 不溢出） | 统一为横向滚动 + 复制按钮 |

---

## 二、一页设计规范（Option A / Cupertino Daylight Glass）

### 色板（唯一真源 `docs/option-a/SINGLE_APP_CONTRACT.md` §4）

| 用途 | 值 | 备注 |
|---|---|---|
| 画布 | `#F2F2F7` | 全局，硬锁浅色 |
| 卡片/面板 | `#FFFFFF` | 分组卡、抽屉 |
| 填充次级 | `#EFEFF4` | 搜索框、次级胶囊、助手气泡 |
| 分隔线 | `#E5E5EA` | 0.5–1px，缩进 16px |
| 主文字 | `#1C1C1E` | |
| 次文字 | `#636366` | 13px 及以上可用（≥4.5:1 on `#F2F2F7`） |
| 系统蓝/绿/红 | `#007AFF` / `#34C759` / `#FF3B30` | 图标、装饰 |
| 动作蓝/绿/红 | `#0062CC` / `#1F7A35` / `#B4231B` | 小字白底、按钮文字 |
| 玻璃 | `rgba(255,255,255,.85)` + `blur(24px) saturate(180%)` | 底部栏；抽屉 `blur(40px)` |
| 遮罩 | `rgba(28,28,30,.22)` | 抽屉/确认层 |
| 禁用 | `#C7C7CC` 白字 | 不再用透明蓝 |

### 字号 / 行高（移动端，DPR≥2）

| 角色 | 字号/行高 | 字重 |
|---|---|---|
| 大标题（页面） | 34/41，字距 -0.8 | 700 |
| 抽屉标题 | 22/28，字距 -0.4 | 700 |
| 卡片标题/列表主行 | 16/22、15/20 | 600 |
| 正文（消息） | 15/22 | 400 |
| 次行/说明 | 12/17 | 400 |
| 分组标题（全大写区） | 13/18，字距 +0.4 | 600 |
| Tab 标签 | 10/13 | 500（激活 600） |
| 代码/等宽 | 12/18–19 | 400 |

### 圆角 / 阴影 / 间距

- 圆角：卡片 16、按钮 12–16、输入舱 22、抽屉 24（仅上两角）、胶囊 999。
- 阴影：卡片 `0 1px 3px rgba(0,0,0,.04)`；抽屉 `0 -8px 32px rgba(0,0,0,.10)`；不叠加第二层阴影。
- 间距：屏幕左右 16（抽屉 20），卡片内 12–16，区块间距 18，列表行最小 44、会话行 64。
- 安全区：`--tl-tabbar-h = 56 + safe-bottom`；屏幕尾部留白 96 + safe，`::after` 64 + safe。

### 动效

- 按压：`scale(.98)` + `opacity .8`，150ms（**固定栏内的按压缩放会改变指针几何，栏内只允许背景色 tint**）。
- 页面切换：160–200ms `ease-out`，位移 ≤24px，透明度 0→1。
- 抽屉：180–220ms `cubic-bezier(.32,.72,0,1)`；遮罩同步淡入。
- 一律尊重 `prefers-reduced-motion`（`animation/transition` 置 0）。

### 抽屉 / 卡片规则

- 所有二级交互 = 底部 `VaulSheet`：36×6 拖拽条（`#C7C7CC`，命中区 44）、标题 22/28、说明 13/18、内容区 `padding 4 20 (24 + safe)`。
- **禁止居中 Modal**、禁止暗色面板、禁止桌面栅格（`max-w-[430px] mx-auto shadow-2xl`）。
- 分组卡里放「同质行 + 缩进分隔线」，行高 ≥44；一行只做一件事，行尾只放一个 chevron。
- 危险动作只用红色文字/红色填充按钮，且必须再次确认（底部面板形态）。

---

## 三、验证与剩余风险

已验证（命令可复现）：

- `npm run app:typecheck`、`npm run app:build` 通过（2026-11-18 17:26）。
- 390×844 全 15 屏 + 360×800 / 320×568 / 768×1024 关键 4 屏截图产出；`after` 实测 `smallTargets = []`、`overflow = []`（会话页与对话页）。
- 测量值：TabBar 390×57 `role=tablist`（子项 `role=tab`）、`backdrop-filter: blur(24px) saturate(1.8)`、`.tl-screen` padding-bottom 96px、视图切换 170×44、气泡 15/22。

未验证 / 剩余风险：

1. **真机 WebView 复核（@Rhea，Android `paopao_api33`，780×1688@2x = CSS 390×844）已给结论**：底部手势条落在标签下方白带、TabBar 四格与手势条不重叠；键盘弹出时输入舱与连接页表单整体在键盘上方（`docs/qa/android/13-composer-keyboard.png`）；返回键先收键盘 → 详情回列表 → 抽屉先关（`14`/`15`/`21`）。**未测**：`env(safe-area-inset-*)` 的实际像素值——原生壳要开 `turnloom.qaDebug` 才有 WebView 调试端口。
2. **安全区的结构性疑点（未测，勿据此改样式）**：`styles.xml` 有 `android:windowOptOutEdgeToEdgeEnforcement=true`，窗口非 edge-to-edge，Android 端 `safe-area-inset-bottom` 可能恒为 0。本文件的实现对此是安全的：所有安全区用法都写了 `env(..., 0px)` 兜底，insets=0 时 `--tl-tabbar-h` 退化为 56px、屏幕尾部留白 96/64，仍大于栏高；**不加任何没有实测依据的补偿值**。等 @Rhea 回读 `getComputedStyle` 的真值再决定是否写死。
3. 毛玻璃 `backdrop-filter` 在低端 WebView 上仍有掉帧风险；模拟器 `hw.gpu.enabled=no` 的软件渲染数据没有参考价值，需真机。若真掉帧，退化方案是 `@supports not (backdrop-filter: blur(1px))` 的纯色兜底，而不是关掉模糊。
4. 截图数据是合成 fixture（`tools/qa/visual-fixture.mjs`），证明的是**布局与样式**，不证明真实 Codex/PI 数据的极端字段；真实数据取证见 @NB agent 的 49 会话截图与 @Vera 的 e2e。
5. 本文档的 P1-8 与 `theme/chatStyles.ts` 常量已一致；`test/app-chat-contract.test.cjs` 断言为「CSS 值 == 常量 + 行高 20–24px + 字号 14–16px」，由 @Atlas 维护。
