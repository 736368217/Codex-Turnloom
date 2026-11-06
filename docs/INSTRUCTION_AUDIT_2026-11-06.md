# 历史指令逐项审计（2026-11-06）

> 目的：回看用户历次要求，区分「真正落地」「部分完成」「未完成」，避免用 CHANGELOG 文案冒充功能完成。
> 本文件是审计基线；后续每次实现应更新状态与证据。

## 状态说明

- ✅ 已解决：代码、回归、运行/真机证据齐全
- 🟡 部分完成：UI 或链路做了，但仍有功能缺口、边界未闭环
- ❌ 未完成：用户明确要求但缺少真实功能或可靠证据

## 一、稳定性 / 交付纪律

| 指令 | 状态 | 证据 / 缺口 |
|---|---|---|
| 守护/离线、登录自启、杀后端自愈 | ✅ | watchdog 4/4、wscript 无窗口链、杀 18788 后自愈 |
| 点任务栏控制台不再误报 8787 占用 | ✅ | 先 health 后 port，复用 external PID/SSH；smoke-test 通过 |
| GitHub CI 不再连续失败/邮件轰炸 | ✅ | Node22 全量 0 fail/0 cancelled、workflow success |
| push 前必须 `npm run verify:ci` | ✅ | 最近多次 push 前均 PASS，远端 success |
| 清理临时会话/分支，软删除为唯一方式 | ✅ | prune 干跑「没有候选」，session.deleted_at 语义已固化 |
| 默认 push，不只本地提交 | ✅ | 最近提交均 `unpushed=0` |
| 真实 UI 测试必须 CDP 鼠标/盒模型 | ✅ | 本轮再次真鼠标加载态/打开/返回栈/中心命中/input 中心命中，并补空目录 hidden 回归 |
| 每次改桥同步源/安装/快照且运行时重载 | 🟡 | 文件哈希一致；运行桥仍需用户插件页重载，不伪称已生效 |

## 二、手机端基础体验

| 指令 | 状态 | 证据 / 缺口 |
|---|---|---|
| 原生感：无长按选词、无原生 select/系统弹窗 | ✅ | MainActivity + appConfirm、应用内模型面板 |
| 100/125/150% 字体放大、键盘 420px 可视区 | ✅ | CDP 量发送键 y=407、composer 底 420 |
| 「需要关注」唯一置顶组 | ✅ | public/threads.js + 回归 |
| 状态总览/标题徽标不遮挡 | ✅ | 独立状态行，P0 hidden 契约 |
| App 内更新检查/下载/安装 | ✅ | FileProvider + /api/apk PK 校验 |
| 图片上传后输入文字不丢预览 | ✅ | has-attachments + 52px 缩略图 |
| 带图消息发送后刷新仍能看到图片 | ✅ | 桥写 scratch receipt；服务端 `/api/thread-image` 按 turnId/文本/时间恢复；纯函数回归 |
| 排队消息默认一行、可展开 | ✅ | 40px 摘要、localStorage、CDP 注入 3 条 |
| 附件/模型/@/发送按钮尺寸层级与「仅文字」标记 | ✅ | 40–44px、grid 标记；三级过滤已落地并 CDP 验证 |
| 加载态模型面板绝不挡页面 | ✅ | `#shell [hidden] display:none!important` + 真鼠标四步 CDP |

## 三、队列与发送

| 指令 | 状态 | 证据 / 缺口 |
|---|---|---|
| 手机端与 PI 桌面端同一份 `turn_queue` | ✅ | 桥 `turnloom/queue/*` 直接读写 pi.sqlite |
| 排队按 PI priority/position 顺序 | ✅ | 桥 + `test-shared-queue.cjs` |
| 排队消息实际能发送出去 | ✅ | `turnloom/queue/claim` 原子出队 + 服务端安全 drain 调 `sendToCodex()`；失败原 id 幂等写回 |
| 模型/供应商请求失效的重试可见 | ✅ | sidecar `lastError/nextAttemptAtMs`、折叠失败数、展开错误原因/重试时间/重试按钮、`/api/queue/retry` |
| 发图失败不污染会话，普通消息继续可用 | 🟡 | 代码已不自动 configure 且失败状态可见；运行桥仍需用户插件页重载 |
| `model/effort` 随排队项持久化 | ✅ | scratch sidecar 保存并随 drain 传给 `sendToCodex()`；桥 v2 测试覆盖 |
| `nativeQueueRemove` 只清手机 principal | ✅ | 清空全部仅 `turnloom-mobile`；显式单条仍可操作共享队列；桥 v2 测试 |
| `nativeQueueWrite` `SQLITE_BUSY` 重试 | ✅ | `BEGIN IMMEDIATE` + busy_timeout + 5 次指数退避；桥契约测试 |
| IPC 抖动时保留上次已知共享队列 | ✅ | `lastKnownNativeQueue` + `queueStale`；失败不写影子队列；纯函数回归 |
| 直接写 turn_queue 触发当前桌面 Composer 即时 UI | 🟡/边界 | 已复核 asar/Rust：`queuePush` 不在插件控制目录，`agentQueueChanged` 来自宿主内部回调；手机/服务端发送闭环已保证，当前桌面窗口即时条需宿主刷新/未来官方 API |

## 四、模型 / 会话 / 导航

| 指令 | 状态 | 证据 / 缺口 |
|---|---|---|
| 模型搜索、显示全部 240 个、供应商名显示 | ✅ | 常用/全部/搜索已实现 |
| 先选供应商→模型→强度，分类清晰 | ✅ | 1 供应商 chips / 2 模型列表 / 3 强度 chips；真实过滤、搜索跨供应商、CDP 真鼠标 |
| 每个会话加载原本模型，不用固定默认 | ✅ | `thread.model` 优先 + 显式草稿 `modelExplicit`；localStorage 跨刷新恢复 |
| 输入文字切换会话后各会话独立 | ✅ | 持久化草稿、图片体积上限、pagehide/visibilitychange 保存、发送成功清理 |
| 模型「仅文字」标识不歪、强度可见 | ✅ | grid + effort chips CDP 可见 |
| 电脑选择页只在首次/主动切换出现 | ✅ | SharedPreferences activeDevice，开机直接聊天 |
| 系统返回不直接退出/回电脑选择页 | ✅ | Android `moveTaskToBack(true)` |
| 多页面分级返回 | ✅ | 12 层 viewStack、聊天页为根；CDP 真鼠标打开 + `codexPocketHandleBack()` 关闭复验 |
| 会话菜单「⋯」、更多文字 | ✅ | 新手检定后已做 |

## 五、PI 宿主能力 / 数据边界

| 指令 | 状态 | 证据 / 缺口 |
|---|---|---|
| 审批/待办/通知/定时/用量/技能/命令/供应商/浏览器/文件/diff | ✅ | 服务端 `/api/host*` + 桥白名单 + 手机面板 |
| 危险操作手机二次确认 + `confirm:true` | ✅ | 服务端 DANGEROUS_HOST_OPERATIONS + 桥双重校验 |
| 手机端默认软删除 / 恢复 | ✅ | sessions.deleted_at + 已移除列表 |
| 彻底删除仍桌面确认 | ✅ | 保留次要入口 |
| `pendingInteractive` 工具级一次性权限列表 | ❌/宿主边界 | 复核 CONTROL_OPERATION_SPECS 仍无此 API；手机端可处理持久化 Plan/Goal 与已知 requestId，桌面等待中的一次性工具授权仍需桌面确认 |
| `browser/getState` 无标签页 | ✅ | 明确提示，不是故障 |
| `agent/compact` 空会话失败 | ✅ | 宿主行为，已记录 |

## 六、本轮 feat 收口

1. ✅ 真正三级模型选择、会话草稿/模型跨刷新持久化。
2. ✅ 共享队列经原子 claim + 安全 drain 实际发送；官方 queuePush 对插件不可达，已如实记录。
3. ✅ 失败原因、下次重试时间、显式重试按钮 / `/api/queue/retry`。
4. ✅ 带图消息服务端 receipt + `/api/thread-image` 持久回显。
5. ✅ 网页分级返回栈，聊天页为根。
6. ✅ principal 限定、model/effort sidecar、SQLITE_BUSY 重试、IPC 抖动保留队列。
7. 🟡 当前桌面 Composer 即时 UI：宿主官方 API 未开放，不能虚假承诺；发送闭环与手机/服务端状态一致已保证。
8. 🟡 运行中的 PI 插件需用户在插件页重载 `cn.star.turnloom-bridge`（或下次启动 PI）；文件已同步但未强杀宿主。
9. ✅ CDP 真鼠标/盒模型、Node 22/24、Android、`verify:ci` 与单次 push / CI 确认按交付纪律执行。

## 七、本轮新增证据（2026-11-07）

- CDP 静态预览（真 app.js/CSS）：加载态 `#modelPanel hidden=true / display:none / 0 by 0`，中心 `#messageList`，输入中心 `#composerInput`。
- 真鼠标 `snapshot → click(uid=e86)` 打开：`display:flex / aria-expanded=true / center #modelPanel`。
- 调用 `codexPocketHandleBack()`：栈 `["modelPanel"] → []`，`modelPanelOpen=true → false`，`hidden=false → true`，中心回 `#messageList`，输入中心仍 `#composerInput`。
- 桥源码 / 安装目录 / 仓库快照 SHA256 一致 `CCFF166AA622…`；六套桥测试 + `test-shared-queue-v2.cjs` 全绿。
- `test/server.test.js` 99/99、`test/ui-host-overlays.test.js` 19/19；`npm run verify:ci`、Android、远端 CI 结果见最终交付记录。

## 首页与低频入口（2026-11-07 后续指令）

- ✅ 首页不再显示电脑选择：有活动设备时 Android 开机直接打开聊天；仅首次启动 / 无活动设备 / 用户主动切换时显示选择页。
- ✅ 提供带文字、44px 命中区的「切换电脑」大按钮；「更多能力」里也有同名入口，系统返回不会把电脑列表当首页。
- ✅ 对话标题栏的小扳手已删除；工具/内部记录开关移入「更多」，功能保留且引导文案同步。
- ✅ 真鼠标 CDP：加载态无小扳手、更多面板可命中、开关/切换按钮 44px、返回栈关闭后中心与输入框恢复。
- ✅ `verify:ci` Node 24/22 172/172，Android test/build，版本 `1.17.31(52)`，APK `3411705 / PK`。
