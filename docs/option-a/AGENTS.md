# Codex-Turnloom 全局架构与 Option A（苹果日光毛玻璃）设计规范 (AGENTS.md)

本文件是 [Codex-Turnloom](https://github.com/736368217/Codex-Turnloom) 项目的最高优先级架构与 UI/UX 宪法。无论是使用 OpenAI Codex 还是 [Pi Coding Agent](https://pi.dev/) 进行代码生成与重构，在修改任何前端或客户端代码前，必须严格遵守本规范。

## 1. 项目定位与“双线并行”架构约束

[Codex-Turnloom](https://github.com/736368217/Codex-Turnloom) 是一个让用户在户外通过手机端远程监控、对话并指挥电脑端运行的 AI 编程代理（Codex Desktop 与 [Pi Coding Agent](https://pi.dev/)）的控制系统。

### 1.1 严禁破坏的核心后端层（Backend Immutability）
* **核心服务端**：`server.js` 与 `backends/http-backend.js` 提供了稳定的轻量级 HTTP / 流式通信契约，并通过 `third-party/turnloom-pidesktop` 桥接桌面端会话，通过 `desktop/` 提供 Windows [Electron](https://www.electronjs.org/) 托盘守护进程。
* **核心接口契约（保持 100% 向下兼容）**：
  * `GET /threads`：获取当前电脑端所有活跃与历史会话列表。
  * `GET /threads/:id/messages?limit&before`：拉取指定会话的消息流、思考状态、工具调用日志与运行计时。
  * `POST /threads`：在电脑端发起新的代理任务会话。
  * `POST /threads/:id/messages`：向指定会话发送指令或补充上下文。
  * `POST /threads/:id/interrupt`：远程一键中断当前正在执行的电脑端任务。

### 1.2 客户端“双线并行”目录规划（统一采用 Option A 视觉规范）
客户端采取双线并行架构，共用 `server.js` 后端，且**双线统一锁定采用 Option A（Cupertino Daylight Glass / 苹果日光雾白毛玻璃风）**：

| 并行路线 | 源码工作目录 | 构建产物目标 | 核心技术栈与开源组件库 | 核心交付形态 |
| :--- | :--- | :--- | :--- | :--- |
| **第一线：Web-Native 升级线 (Track A)** | `web-ui/` | 编译输出至 `public/` | [React](https://react.dev/) + [Vite](https://vite.dev/) + [Tailwind CSS](https://tailwindcss.com/) + [Konsta UI](https://konstaui.com/) (iOS Light) + [Vaul](https://vaul.emilkowal.ski/) + [Lucide Icons](https://lucide.dev/) | 手机浏览器扫码直连 PWA + 现有 `android/` WebView 容器直接升级 |
| **第二线：真机原生 App 线 (Track B)** | `mobile-app/` | 独立编译 iOS / Android 安装包 | [Expo](https://expo.dev/) ([React Native](https://reactnative.dev/)) + [NativeWind](https://www.nativewind.dev/) + [React Native Reusables](https://reactnativereusables.com/) + `expo-blur` | 独立安装的高帧率原生 App（支持真机触觉震动、原生扫码、原生毛玻璃渲染） |

## 2. 统一视觉规范：Option A — 苹果日光雾白毛玻璃风（Cupertino Daylight Glass）

**硬性规定：全局严禁使用黑底/暗黑模式（Dark Mode）！** 双线客户端统一采用 **Option A（Cupertino Daylight Glass）** 浅色设计系统，专为户外阳光下高可读性与苹果原生高级质感打造。

### 2.1 Option A 核心色板与材质 Token（Cupertino Daylight Palette）

| 视觉层级 | 颜色/材质定位 | Hex / 材质值 | Tailwind / NativeWind 类名 | 适用组件范围 |
| :--- | :--- | :--- | :--- | :--- |
| **全局底层画布（iOS Grouped Canvas）** | 苹果系统分组雾灰白 | `#F2F2F7` | `bg-[#F2F2F7]` | 页面主背景（严禁使用纯白做底层画布，用 `#F2F2F7` 衬托纯白分组卡片的立体感） |
| **一级内嵌分组卡片（Inset Grouped Card）** | 纯净高亮白卡片 | `#FFFFFF` | `bg-white rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04)]` | 机器状态卡、任务会话列表项、代码 Diff 卡片 |
| **二级内嵌容器（Secondary Fill）** | 苹果浅灰填充层 | `#EFEFF4` 或 `#F1F5F9` | `bg-[#EFEFF4]` / `bg-slate-100` | 折叠式 `AI Thinking` 思考块、终端日志内框、底部圆角输入框背景 |
| **顶底毛玻璃导航（Cupertino Glass）** | 82% 透光白毛玻璃 | `rgba(255,255,255,0.82)` + `blur(20px)` | `bg-white/80 backdrop-blur-xl` (RN 用 `BlurView tint="light"`) | 顶部大标题粘性导航栏、底部拇指操控舱、手势半屏抽屉背景 |
| **极细内部分割线（iOS Separator）** | 苹果标准细分割线 | `#E5E5EA` | `border-[#E5E5EA]` / `divide-[#E5E5EA]` | 列表项之间的内嵌分割线、卡片柔和外边框 |
| **主标题与正文（Label Primary）** | 苹果深邃黑 | `#000000` 或 `#1C1C1E` | `text-[#1C1C1E]` | iOS 大标题、卡片主标题、AI 回复正文 |
| **次要信息与副标题（Label Secondary）** | 苹果中性灰 | `#8E8E93` | `text-[#8E8E93]` | 时间戳、文件路径、耗时统计、列表右侧箭头 |
| **主交互色（iOS System Blue）** | 苹果系统蓝 | `#007AFF` | `bg-[#007AFF] text-white` / `bg-[#007AFF]/10 text-[#007AFF]` | 主操作按钮、激活态 Tab 图标、`Active` 状态胶囊、发送按钮 |
| **在线/审批通过色（iOS System Green）** | 苹果翡翠绿 | `#34C759` | `bg-[#34C759] text-white` / `bg-[#34C759]/12 text-[#248A3D]` | `DESKTOP CONNECTED` 状态点、`Approve & Apply` 按钮、Git Diff 新增行 |
| **中断/危险操作色（iOS System Red）** | 苹果珊瑚红 | `#FF3B30` | `bg-[#FF3B30] text-white` / `bg-[#FF3B30]/12 text-[#D70015]` | 底部 `Interrupt` 一键打断按钮、Git Diff 删除行、错误提醒 |

## 3. 严禁出现的“网页感”反模式（Anti-Web Constraints）

1. **严禁桌面端网页布局**：禁止使用顶部汉堡菜单（`☰`）、禁止顶部水平文字导航条、禁止网页底部版权页脚（Footer）、禁止面包屑导航。
2. **严禁网页居中 Modal 弹窗**：手机端严禁出现屏幕正中央弹出的传统 `Dialog/Modal`。所有二级交互（切换 Thread、扫码配对、切换 Codex/Pi 引擎、审批文件修改）必须 100% 采用带顶部拖拽条（`w-9 h-1.5 rounded-full bg-[#C7C7CC] mx-auto`）的**底部 iOS 手势半屏抽屉（Bottom Sheet）**，且抽屉拉起时背后主屏幕需呈现 iOS 卡片微缩景深效果。
3. **严禁网页滚动与交互痕迹**：
   * 全局隐藏原生滚动条（`scrollbar-none` / `showsVerticalScrollIndicator={false}`）。
   * 按钮、导航栏、状态胶囊全面禁用文本选中（`select-none`），仅允许代码块与 AI 回复正文长按复制。
   * 所有可点击卡片与按钮必须具备 iOS 级按压高亮或微缩放反馈（`active:scale-[0.98] active:opacity-80 transition-all duration-150`）。

## 4. 户外远程遥控四大核心界面原语

1. **iOS 大标题与机器状态顶栏（Large Title & Machine Header）**：
   * 固定在顶部安全区（`pt-safe`），支持 iOS 大标题（`text-3xl font-bold tracking-tight text-[#1C1C1E]`）向下滚动平滑收缩为居中标准标题。
   * 顶栏下方首张纯白圆角卡片展示电脑连接状态（`🟢 DESKTOP-PC CONNECTED`）、`Codex CLI` 与 `Pi Agent` 分段切换器（Segmented Control）及一键扫码配对入口。
2. **折叠式思考与终端日志卡片（Collapsible Thought & Terminal Box）**：
   * 将冗长的 AI 思考过程（`AI Thinking...`）与命令行执行日志封装在 `#EFEFF4` 浅灰圆角折叠框内，默认只显示单行动态状态与计时，点击平滑展开查看等宽日志。
3. **浅色高对比度 Git Diff 卡片（Daylight Diff Card）**：
   * 置于 `#FFFFFF` 纯白圆角卡片内，新增行采用清爽浅绿底色（`bg-[#E8F8EE] text-[#1E7E34]`），删除行采用清爽浅红底色（`bg-[#FDECEC] text-[#C82333]`），户外强光下一目了然。
4. **底部毛玻璃大拇指操控舱（Thumb-Zone Glass Bar）**：
   * 固定在底部安全区上方（`pb-safe bg-white/85 backdrop-blur-xl border-t border-[#E5E5EA]`），包含快捷指令胶囊条、语音输入按钮、圆角自适应输入框（`bg-[#EFEFF4] rounded-full px-4`），以及任务运行中右侧高亮的苹果红 **`Interrupt`** 按钮（调用 `POST /threads/:id/interrupt`）。
