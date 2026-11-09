# 视觉审查与修复报告

本报告对应 `fix/visual-audit` 分支。目标是找出并修复用户指出的「图标缺失、字体排版错误、相互遮挡」问题，并用逐页截图与自动化守卫证明修复后的界面可复现、无回退。

## 发现的问题

| 严重度 | 页面 | 问题 | 根因 |
|---|---|---|---|
| 严重 | 全局原生 App | Tab、会话箭头、新建、附件、引用、发送/停止等图标显示为空白、圆点或方框 | `expo-symbols` 在 Android 用运行时 `expo-font.loadAsync({ uri: numericAssetId })` 加载 Material Symbols；加载失败时组件静默渲染空 View |
| 严重 | 模型、引用、消息操作、新建会话等底部抽屉 | 抽屉内容被压成窄带，文字/行相互挤压 | `SheetShell` 的 `ScrollView style={{ flexGrow: 0 }}`，且 Modal 根容器没有把抽屉固定到底部 |
| 一般 | 服务内置网页直接用 file:// 打开 | CSS/JS 绝对路径导致页面退化成无样式 HTML | 服务入口假定由 HTTP 静态服务提供；仅审查预览需要相对路径副本，非产品缺陷 |
| 一般 | 桌面控制台 SVG | 检查发现所有 `<use href="#...">` 图标 symbol 均有定义 | 未发现缺失，记录为通过 |

## 修复

- 新增 `mobile-app/src/components/ui/icon.tsx`：项目内维护 Material Symbols 码表，直接随应用打包 `assets/fonts/MaterialSymbols_400Regular.ttf`，并用 `expo-font` 本地加载；加载前也有 Unicode fallback，不再出现空白图标。
- 将 7 个使用 `SymbolView` 的页面/组件统一改为导入本地 `ui/icon`：首页、会话详情、AgentStepCard、GlassTabBar、OptionASheets、PairingSheet、ThumbPromptBar。
- 修正 `SheetShell`：Modal 根容器 `justifyContent: 'flex-end'`，ScrollView 改为 `flexShrink: 1, flexGrow: 0`，取消 `contentContainerStyle.flexGrow: 1`，保证列表有正常高度且抽屉始终在底部。
- 用修复后源码重建 Hermes bundle / 签名 APK，并在 MuMu `phone` 档位重拍所有 README 成品配图。
- 新增 `test/visual-regressions.test.js`：禁止重新引入 `expo-symbols` 直接依赖、`flexGrow: 0` 抽屉布局，要求本地字体资产与全部新配图存在。

## 逐页截图

每页截图均来自当前修复源码构建的真实 Android 设备，数据由隔离文档 fixture 提供，不含真实访问码、二维码、账户或私人会话。报告页中的图片按 `1080×1920` 展示，控件文字和图标以 uiautomator XML 交叉核对。

| 页面 | 截图 | 结构证据 | 修复后检查点 |
|---|---|---|---|
| 冷启动 / 连接电脑 | `shots/final-01-cold.png` | `xml/final-01-cold.xml` | 二维码图标可见，标题/说明/按钮不重叠 |
| 扫码配对折叠 | `shots/final-02-pairing-collapsed.png` | `xml/final-02-pairing-collapsed.xml` | 扫码框、展开箭头、说明文字完整 |
| 手动输入展开 | `shots/final-03-pairing-manual.png` | `xml/final-03-pairing-manual.xml` | 地址、访问码、显示、提交按钮均可达 |
| 首页 / 会话列表 | `shots/final-08-home.png` | `xml/final-08-home.xml` | 新建、状态筛选、卡片箭头、底部 Tab 图标全部可见 |
| 对话详情 | `shots/final-09-thread.png` | `xml/final-09-thread.xml` | 消息气泡、模型摘要、运行详情、排队、输入舱图标完整 |
| 长审批滚动到底 | `shots/final-10-approval-scrolled.png` | `xml/final-10-approval-scrolled.xml` | 第 20 个文件可见，批准/拒绝 footer 固定 |
| 模型与思考强度 | `shots/final-13-model-correct.png` | `xml/final-13-model-correct.xml` | 抽屉底部对齐，标题/说明/关闭/两行模型不挤压 |
| 插件 / 技能引用 | `shots/final-14-mentions-correct.png` | `xml/final-14-mentions-correct.xml` | Tab、搜索、技能列表完整；插件接口失败不掩盖技能 |
| 终端管理 | `docs/screenshots/app-terminals.png` | 既有真实设备截图 | 当前连接、测试连接、编辑、解除配对完整 |
| README 主视觉 | `docs/assets/hero.png` | 三张修复后真机截图合成 | 标题不遮挡、截图不越界、底部信息完整 |
| 服务内置网页 | `shots/web-index.png` | 浏览器预览 | CSS/JS 由相对路径副本加载；无裸 HTML |
| 桌面控制台 | `shots/desktop-index.png` | SVG symbol 定义检查 | 所有 `<use>` 引用均有对应 symbol |

## 验证结果

- `npm run verify:ci`：本地 Node 与 CI Node 22 均为 **206/206**，0 fail、0 cancelled（含新增 4 个视觉守卫与原有 4 个 README 守卫）。
- `npm run check`：通过。
- `npm run desktop:check`：通过。
- `mobile-app` TypeScript `tsc --noEmit`：通过。
- `mobile-app` native tests：**15/15**。
- 新 `test/visual-regressions.test.js`：**4/4**。
- 原 `test/readme-assets.test.js`：**4/4**。
- `git diff --check`：通过。
- 修复 APK：v2/v3 签名通过，zipalign 通过，冷启动无 "No routes found"。
- MuMu `phone` 档位：`1080×1920 / 440dpi`，`font_scale` 结束恢复 `1.0`，租约已释放。

## 说明

- 完整 `mobile-app` Gradle release 仍受 Windows 长路径 / CMake / Ninja 限制；本次设备验收使用当前源码重新编译的 Hermes bundle 热替换到已验证原生壳中，并重新签名。
- 服务内置网页是兼容入口；为了在浏览器静态预览中复现视觉样式，报告使用相对路径副本和只读 fixture，不修改产品源码的 HTTP 路由。
- 所有临时 APK、bundle、明文 JS、XML dump 和 fixture 进程文件不提交到仓库。
