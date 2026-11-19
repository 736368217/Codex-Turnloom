# 2.2.6 现状测量（Vera）

对象：**随包 2.2.5 的真实 bundle**，不是工作树里的 `app/dist`。

```
native-shell/app/src/main/assets/public/assets/index-CC0SxfnI.js   784,932 B
git: 18b7bbf  build(native-shell): embed the 2.2.5 bundle
viewport: 390x844 / 360x800 / 320x568, dpr 2
```

## 0｜先记两条会让证据失真的坑

1. **`app/dist` 是活靶子。** 00:27:14 它被重建（作者正在改分段控件），我的首轮 `capture`
   在 320 档拍到的已经是新控件（`docs/qa/visual/2.2.6-before/320x568/04-threads-default.png`
   是灰轨道 + 白 thumb），390/360 档才是 2.2.5 的黑色药丸。同一份 report.json 里混着两个
   build，跨档不可比。**凡记"现状"或"已修"，都要写 asset 文件名 + 字节数**；Rhea 的出包验收
   同理，否则会出现"我这边过了"但过的是别人重建的包。
2. **夹具的监控页比真机繁荣。** `16-monitors` 截图里 13 条运行中、整屏红「停止」；真机 de 常态
   0–2 条。拿夹具的观感当"这个 tab 有用"的理由会判错——下面第 4 节按真机算。

复算：`tmp/shipped-measure.ps1 -Mode probe`（把 preview 指向任意 bundle 目录）+
`tools/qa/visual-capture.mjs --eval @<page probe>.js`。这两个脚本在 `tmp/`（gitignored），
只作本次取证的本地工具；团队共用的门禁是 Rhea 的 `tools/qa/check-redesign.mjs`。

## 1｜三档总量：布局层没有欠账

`tools/qa/capture.mjs --viewports 390x844,360x800,320x568`，26 个场景 × 3 档 = **78 屏**：

| 指标 | 结果 |
| :--- | :--- |
| `docScrollWidth == viewport` | 78/78（390/360/320 各自相等） |
| `horizontalOverflow` | 0 屏 |
| `offenders`（越界元素） | 0 屏 |
| `smallTargets`（<44px 可点） | 0 屏 |
| `badPreviewRows`（id/换行/超长预览） | 0 屏 |

唯一的横向滚动是代码块内部（`clientWidth 254 / scrollWidth 1132`，`scrollable: true`），属设计内。

## 2｜分段控件：2.2.5 的真实数值

三档完全同构，只是宽度不同：

| 量 | 390 | 360 | 320 |
| :--- | :--- | :--- | :--- |
| rail 盒 | x=0 w=390 h=58 | x=0 w=360 h=58 | x=0 w=320 h=58 |
| rail 布局 | `justify-content: flex-start` · `padding: 2px 16px 12px` · `gap: 8px` · `overflow-x: auto` · `position: static` | 同 | 同 |
| 按时间 chip | 82×44 @x=16 | 82×44 @x=16 | 82×44 @x=16 |
| 按项目 chip | 82×44 @x=106 | 82×44 @x=106 | 82×44 @x=106 |
| 圆角 / 字号 | 999px / 14px 600 | 同 | 同 |
| 未选中 | 底 `#FFFFFF`，字 `#3C3C43` | 同 | 同 |
| 选中 | 底 `#1C1C1E`，字 `#FFFFFF` | 同 | 同 |
| transition | `transform, opacity, background-color` 各 `.15s` | 同 | 同 |

**命中带**：chip 上沿 +1px、下沿 −1px 处 `elementFromPoint` 都落在 chip 内（44px 可点）；
chip 上沿 −3px 处落回 `.tl-thread-scroll`。即**没有额外外扩的命中区**，44px 就是全部。

**与图 1 的差**：没有轨道、没有滑块、没有位移；所谓"切换动画"只有 150ms 底色渐变。
`transform` 在 transition 列表里但选中态不改 transform，所以看不到滑动。

**一条报告里没有的缺陷：这个控件会随列表一起滚走。**

```
scrollTop=600 → rail 从 y=100 变 y=-500（bottom -442）  390/360/320 三档相同
```

`.tl-thread-filters` 在 `.tl-thread-scroll` 内部（`ThreadsScreen.tsx:157-180`），不是固定头部。
翻到列表中段想切换"按时间/按项目"，必须先滚回顶部。**新控件应放在滚动容器之外**（与搜索框一起
做固定头部），否则换成灰轨道也还是找不到。这一条请写进 Iris 的实现约束，不是纯视觉问题。

## 3｜可读性：达标，但没有余量

| 元素 | 字号/行高 | 颜色 | 对比度 |
| :--- | :--- | :--- | :--- |
| 会话标题 | 16/21 600 | `#1C1C1E` on `#FFF` | **17.01:1** |
| 会话预览 | 13/18 | `#636366` on `#FFF` | **5.99:1** |
| 会话时间 | 12/16 | `#636366` on `#FFF` | 5.99:1 |
| 分组头（项目名） | 13/600 | `#636366` on `#F2F2F7` | **5.37:1** |
| 设置标题 / 副标题 | 15/20 · 11/15 | `#1C1C1E` / `#636366` | 17.01 / 5.99 |
| 旧 chip 未选中 | 14/600 | `#3C3C43` on `#FFF` | 10.94:1 |
| 旧 chip 选中 | 14/600 | `#FFF` on `#1C1C1E` | 17.01:1 |
| 蓝字按钮 | 15 | `#007AFF` on `#FFF` | **4.02:1**（大字/图标可以，正文级偏紧） |
| 灰色占位/图标 | — | `#8E8E93` on `#FFF` | **3.26:1**（仅装饰可用） |

结论：**没有低于 4.5:1 的正文**；两个偏紧的是蓝字与灰占位，属既有权衡，2.2.6 不必动。
11px 副标题（设置里的地址行）是这套界面最小的信息字，改设计时别再往下压。

## 4｜七屏必要性：按"别处还有没有入口"算

| 屏 | 计数 | 判据（能量到的） | 处置 | 别处入口 |
| :--- | :--- | :--- | :--- | :--- |
| 会话列表 | 1 标题 + 44px 搜索 + 58px rail + N 行（每行 66px） | 主入口，首屏能放 5–9 行 | 保留 | — |
| 搜索框 | 44 高，常驻 | 29 条会话时仍常驻，占 8% 屏高（320） | 后置：滚动时收起 | — |
| 视图切换 | 2×82×44 | **滚走**（见 §2） | 重做并固定 | — |
| 监控 | 5 指标 + 运行列表 + 2 个 44 高按钮 | **5 项全有替代**：运行中=每行状态图标/详情页「运行中」；错误=`设置→运行信息`；会话数=列表本身；距上次同步=下拉刷新；连接=设置/横幅 | **删除整屏** | 唯一独占：多条运行中会话并排 + 每行 56×44「停止」；聊天详情已有单会话「停止」44×44（实测） |
| 设置 | 10 行（48–55 高，4 组） | 每行都是动作或状态 | 保留，合并「测试连接」「切换电脑上的服务」进设备面板 | — |
| 抽屉（切换服务） | 2 行 × 44 | 设置里的两跳动作；今天只有 1 台电脑 × 2 个发现项 | 并入设备面板 | 设置首组 |
| 聊天 | 头部 58 + 标题 16 + 模型 chip 146×44 + 输入舱 111 | 头部信息密度合适；chip 44 命中 | 保留 | — |
| 输入区 | 5 个按钮全 44×44（@ / 拍照 / 图片 / 附件 / 停止） | `@` 在最左，与报告目标一致 | 保留 | — |
| 模型面板 | 16 行可滚、搜索框、chip 带勾 | 2.2.5 已按集合渲染 | 保留 | 头部 chip |
| 设备页 | **今天不存在** | 等价物=设置首组（1 行 55 高）+ harness sheet（2 行） | 新建 | — |

监控页的"必要性"判定与报告一致，但补一条依据：它的 5 个数字全部是 `dataStore/sessionStore`
的派生值（Atlas 00:26 已核到同一结论），没有任何一个 API 只在这里被用到——**删它不掉数据**。

## 5｜我给 2.2.6 的机器判据（复核用的口径）

在报告第 5 节四条之外，加两条来自上面实测的：

1. thumb `getBoundingClientRect().left` 落在第二个 cell 内 ±1px（点第二个 cell 后）；
2. 平台节点 `data-machine` 同时只有一个值；
3. 320/360/390 `docScrollWidth == viewport`；
4. `prefers-reduced-motion: reduce` 下 `transition-duration` 为 `0s`；
5. **（新增）滚动到列表中段后，分段控件仍在视口内**（`rail.getBoundingClientRect().bottom > 0`）；
6. **（新增）分段控件命中带 = 可见高度 ≥44px**，且 chip 外 3px 不再算命中（与今天一致，别偷偷外扩）。

## 6｜复算命令

```powershell
# 78 屏布局量测（app/dist 会动，跑完记下 asset 名）
node tools/qa/capture.mjs --viewports 390x844,360x800,320x568 --out docs/qa/visual/2.2.6-before

# 钉住随包 bundle 的几何/样式量测
powershell -NoProfile -ExecutionPolicy Bypass -File tmp/shipped-measure.ps1 -Mode probe `
  -Views "390x844:2,360x800:2,320x568:2"
```

截图：`docs/qa/visual/2.2.6-before/<viewport>/`（**320 档含新控件，不作 2.2.5 基线**）。

## 7｜落地复核：分段控件（2026-11-20 00:46，当前源码）

对象：`vite build` 自当前源码的 `index-96086YuR.js` · 789,997 B（不是 `app/dist`）。390 与 320 同结果。

| 判据 | 结果 | 实测 |
| :--- | :--- | :--- |
| thumb 落在选中段内 | **PASS** | 偏移 0、宽差 0；回切同样 0 |
| 命中带 ≥44 | **PASS** | 带高 44（y 48–91），绘制盒 38 |
| 滚动时控件不动 | **PASS** | 列表滚 600，控件 top 51→51；控件已在滚动容器外 |
| 无横向溢出 | **PASS** | `scrollWidth == viewport` |
| reduce-motion | **PASS** | 4 条 `@media (prefers-reduced-motion: reduce)` 规则在包内 |
| 单一 `data-machine` | **n/a** | 0 个节点，设备面板未落地——**没有主语就不记 PASS**，落地后单独一行给结论 |

负向对照：同一脚本跑随包 2.2.5 → `thumbInCell` FAIL（无 thumb）、`pinnedWhileScroll` FAIL（控件在滚动容器内）。
脚本另加了 guard：`scrollTop < 100` 一律 FAIL 并标 `inconclusive`——短列表曾让这条假通过一次。

口径要求（NB3 00:50 升级为通用规则）：**先证明被测对象有被测量的余地**（滚动量、节点数、可选段数），否则记 `inconclusive` / `n/a`，不写 PASS。
