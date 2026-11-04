# 手机端易用性走查记录（2026-11-05）

按用户视角逐项实测，不再只改一个网页。证据来自 390×844 手机视口、真实接口与安卓源码。

## A. 为什么"还是网页的感觉"（根因不在 CSS）

| # | 现象 | 真实根因 | 位置 |
|---|---|---|---|
| A1 | 长按文字能选中、弹出系统复制把手 | WebView 没关闭长按选词；CSS 只对 `.bubble` 做了 `user-select:none`，覆盖不全，且原生 ActionMode 仍会触发 | `MainActivity.buildWebView()` |
| A2 | 能看出 CSS 边缘 / overscroll 发光 | 只设了 `OVER_SCROLL_NEVER`，但没做原生边缘效果、没关 `setLongClickable`、没拦 ActionMode | 同上 |
| A3 | `alert/confirm` 是安卓系统原生弹窗 | `WebChromeClient` 没有覆写 `onJsAlert/onJsConfirm/onJsPrompt`，WebView 走默认实现 | `MainActivity.java:571` + `app.js:3536` 的 `confirm()` |
| A4 | 页面看着像浏览器 | 外壳布局里有原生顶栏/进度条 + WebView；内容再怎么改 CSS 也仍是"壳里套网页" | 架构层面，见文末框架评估 |

## B. 功能缺陷

| # | 现象 | 真实根因 |
|---|---|---|
| B1 | 模型选择里一大堆没导入 PI 的模型 | `/api/health` 的 `models` 来自 `model-catalogs` 全量目录，**240 个**，13 个供应商前缀；`renderModelSettings()` 原样平铺。筛选是 `<select>` 上方的输入框，且会把当前模型硬塞回列表，输入后难判断 |
| B2 | 会话搜索不好用 | 只匹配 `title/preview`，不匹配项目名；输入后仍保留折叠分组；无"无结果"提示与一键清除 |
| B3 | 打断（停止）不好用 | `stopButton` 的显示条件是 `allowWrite && thinking && !uncertainSend && 非草稿`，接口只发 `threadId` 不带 `turnId`；点完立刻把本地 thinking 改成 false，若宿主没停成功，界面会先"假装停了"再弹回来 |

## C. 关于"成熟框架"

用户问：有什么成熟框架直接用，为什么不做。诚实答复：

1. **现状**：`android/app` 是 Java WebView 壳（`loadUrl` 远程地址），Web 层是原生 JS + 三层 CSS。它确实是"浏览器里跑网页"，不是原生 App。加 CSS 只能改善观感，不能改变交互模型。
2. **可选路线**：
   - **React Native / Flutter 全量重写**：原生感最彻底，但要重写会话列表、消息流、模型面板、附件、长轮询、DeepLink、提醒、下载等全部功能；现有 Web 端与桌面端共用同一套 `server.js`，重写后要长期维护两套 UI。工作量大且风险高，不适合在"先把当前问题修掉"的这一轮里草率开工。
   - **保留 WebView，但把它做成真正的混合 App**（本轮采用）：用原生接管长按/选词/弹窗/滚动/状态栏，Web 层只负责内容与应用内弹层；同时把笨重的原生 `<select>` 换成应用内自定义面板。这样今天就可用，且不动服务端协议。
   - **中期**：把 UI 层迁到已有成熟 Web 框架（如 Vue/React + 组件库）只解决代码组织，不解决"WebView 感"；若用户要彻底原生，应另立一个明确的重写项目，按页面逐步迁移，而不是在当前会话里偷偷换框架。
3. **本轮交付**：把 A1–A3、B1–B3 真修掉；框架路线作为决策项交给用户，不假装"已经用上框架"。

## D. 验证口径

- 真机视口逐屏看；长按压 700ms 后确认**没有**系统选词把手、只有应用内操作单；
- 点会触发 `confirm` 的操作，确认是应用内弹层而非系统对话框；
- 模型面板只列用户导入 PI 的模型（或明确分组）；搜索命中项目名；打断后核对宿主状态而非只看本地文案；
- 跑 `node --test`、`npm run android:test`、桥四套；门面与 DB 计数一致；清掉自己造的临时会话。
