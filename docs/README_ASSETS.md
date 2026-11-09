# README 配图与视觉验收记录

本记录对应 `docs/readme-refresh` 分支的文档配图重建。它说明配图来源、真实性与已执行的视觉/易用性检查，避免把静态样机或旧版本 UI 当成产品截图。

## 截图来源

- 设备：MuMu Android `phone` 档位，固定 `1080×1920 / 440dpi`，通过唯一合法入口 `mumu-lease.ps1` 申请、校验、续租和释放。
- 应用：`com.codexpocket.optiona.nativq` 隔离测试包；包内 Hermes bundle 从当前 `main` 的 `mobile-app/` 源码重新编译，签名 v2/v3 与 zipalign 均通过。
- 数据：本机 `127.0.0.1:18997` 的隔离文档 fixture，仅通过 adb reverse 暴露给测试包；不连接真实 8787，不读取真实 Codex 会话。
- 隐私：截图中的服务地址、访问码、标题、消息、文件和模型名称均为文档演示数据；不展示真实二维码、账户、私人路径或真实访问码。

## 成品图

| 文件 | 内容 | 检查点 |
|---|---|---|
| `docs/assets/hero.png` | 三张真实设备截图的品牌化合成 | 标题不被遮挡、截图不越界、底部信息完整 |
| `docs/screenshots/app-home.png` | 已连接会话工作台 | 搜索、筛选、状态标签、项目名、底部 Tab 完整 |
| `docs/screenshots/app-thread.png` | 对话详情 | 消息流、模型/强度摘要、审批卡、运行详情、排队、输入舱完整 |
| `docs/screenshots/app-approval.png` | 长审批滚动到底 | 第 20 个文件可见，批准/拒绝 footer 坐标固定 |
| `docs/screenshots/app-model.png` | 模型与强度面板 | 标题、说明、关闭、当前模型与备选模型可见 |
| `docs/screenshots/app-mentions.png` | 插件/技能引用 | 插件接口 503 时技能仍列出；技能/插件 Tab 可见 |
| `docs/screenshots/app-terminals.png` | 终端管理 | 当前连接、测试、编辑、解除配对、添加入口完整 |
| `docs/screenshots/app-pairing.png` | 扫码/手动配对 | 手动表单展开、访问码掩码、提交按钮可见 |

所有单屏截图归一化为 `1080×1920` PNG；UI 像素来自真实设备截图，仅做尺寸归一化与圆角处理，没有重绘界面或替换控件文本。

## 自动化守卫

`test/readme-assets.test.js` 会由 `npm test` / `npm run verify:ci` 自动执行，检查：

- README 中所有本地 `<img src="docs/...">` 引用存在；
- Hero 为 `1800×940`，单屏截图为 `1080×1920` 且文件非空；
- 旧样机文件名和错误运行时说明不再出现；
- README 写明 Node.js 22.5+、原生 App 主线、可信局域网边界。

## 易用性与视觉检查

- 配对：默认优先扫码；手动输入可展开；服务地址/访问码/提交按钮均在可达区域；失败时保留输入并显示错误。
- 会话：搜索、状态筛选、项目名、状态标签、时间对齐；底部 Tab 未被裁切。
- 对话：消息层级清楚；运行详情位于消息之后；排队消息与输入舱不被遮挡；复制/引用/附件/中断入口可见。
- 长审批：20 个文件滚动到底后，`mock-file-20-LAST.ts` 可见，底部「批准并应用 / 拒绝」仍固定；1.3× 字体检查沿用本轮设备验收。
- 模型与引用：面板标题、说明、关闭按钮、模型列表、技能列表、Tab 均完整；插件接口失败不掩盖技能。
- 显示回归：所有成品图逐张在浏览器预览中打开；无黑边、无右侧截断、无控件重叠、无占位图、无乱码、无过期 UI 文案。

## 清理

- 验收结束后停止隔离 fixture；
- 移除 adb reverse；
- 通过 `mumu-lease.ps1 release` 归还设备；
- 不提交 APK、Hermes bundle、原始大尺寸截图、XML dump 或 fixture 进程文件。
