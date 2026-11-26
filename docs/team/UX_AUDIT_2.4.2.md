# 2.4.2 设计门禁（NB3）

> 判据先立、实现后签。每条只有「证据」栏填满才算过；没证据的写「未验」，不写「应该可以」。
> 条目范围见 Task #21；本文件只记录**怎么算过**，不重复范围说明。
> 签发基线：代码冻结 `e54b67f`，资产 `9748c09`，发布 tag `v2.4.2` = `bfb0513`（docs-only）；APK **1,833,961 B** / `ef041790…cb4402`，包内 `assets/public/assets/index-D3nf4Zsz.js` **859,560 B** / `9a534f58…d891d5ae`（= 仓库里那份资产，逐字节相同）；`npm test` 694 / **692 pass / 0 fail / 2 skipped**（APK 存在后的最终一轮；我 21:01 那轮是 691 pass / 3 skipped，差的 1 条正是 `publish-guard` 的 release 预检），`app:typecheck` 退出 0。

| # | 条目 | 判据（缺一条不签） | 证据 | 状态 |
|---|---|---|---|---|
| 1 | 底部导航：按下不闪蓝、选中看得出来 | `.tl-tabbar` 内无 `rgba(0,122,255`、无 `!important` 着色、无 Konsta 死类；**验到 svg 自己的 computed color**；按下不得有任何背景色块；320/390 不截断、命中 ≥44 | `6ace796`；我自跑 390/320：选中 `svg`/`label` = `rgb(28,28,30)` + `600`，未选中 = `rgb(142,142,147)` + `500`，按钮背景 `rgba(0,0,0,0)`；`:active` 仅 `svg, .tl-tabbar-label { opacity:.5 }`。Iris 按住实测：带内 ΔE76 `0.69`/`0.63`（判据 <3），`max(B−R)` `4`/`4`（判据 ≤8）；tab 高 56；每屏 `aria-selected=true` 恰好 1 个 | **已签** |
| 2 | 更新一键化：启动自检 + 单弹层两级动作 | 冷启动零点击弹层且下载 0 次；「立即更新」= 原生下载 1 次；`ready` 后安装器恰好 1 次；「稍后」本进程同版本不再弹；无来源应答时不得写「已是最新」；不得叠 sheet；未配对不弹 | `0bc3c49`；冻结树上我自跑 `check-242-update.mjs --build` → **exit 0 / 36 PASS / RESULT: PASS**（资产 `index-D3nf4Zsz.js` 859,560 B），`--width 320 --height 568` → **exit 0 / 36 PASS**。2.4.1 的四行（手动检查 / 下载 / 暂停 / 打开安装界面）0 命中；真机安装与落盘归 Rhea 装置验收 | **已签**（真机链路见残项） |
| 3 | 来源头像：浅色块 + 墨色字形 | 深底白字绝迹；背景亮度 ≥0.8、字形对比 ≥4.5:1；会话头 20 / 平台卡 24 / 对话行 24 / 非当前电脑组 20 四处同一套；codex 与 pi 各至少渲染一次；未知平台保留字母兜底 | `6ace796`；`#ECECF0` 底 / `#1C1C1E` 字：L=**0.841**、对比 **14.4:1**（390/320 一致）；四处 `data-kind` 计数 ≥1 且 codex+pi 都出现；`claude` 渲染两字母 `CL`、无空块；`app/src` 内 `#3A3A3C` **0 命中**；Iris 在**包内字节**上复核样式（`/tmp` 脚本只读），`git diff 6ace796 e54b67f -- <A/C 三文件>` 为空 | **已签** |
| 4 | 默认 PI | 无标记 → PI；显式 Codex 经成功重校验仍是 Codex；401 兜底写回 `explicit=false` 且序列化后仍 false；旧注册表只迁一次；设备页展开当前平台；`默认入口` → `本机服务` | `a4ab456`；`app-harness-default` **12/12**、`app-state-recovery` **24/24**；种子机双 harness 冷启动落在 `pi`（真实路径，不只单测） | **已签** |
| 5 | 发布闸：`debuggable=false` + 三方字节一致 | release 包 `aapt2` 无 `debuggable`；证书 `2feb63c5…fa9c`；APK / Release 附件 / 公网 `latest.json` 三处字节一致；包内 bundle sha256 = 该提交 blob | 我独立复核（只读、未重建）：badging `versionCode=101 versionName=2.4.2`、xmltree **debuggable 0 行**、`apksigner` 证书 `2feb63c511cd725795cadc8fa890f9cbc754fe59c0bbfe0787ac33f94f44fa9c`；本地 APK `ef041790…cb4402`（= 本地 `.sha256`）；公网 `latest.json` = 2.4.2 / 101 / **1,833,961 B** / `ef041790…`；**从 R2 下载回读**同值；GitHub Release 资产 digest `sha256:ef041790…`、size 1,833,961；server zip 2,108,106 B / `704a6fc1…c160a0`，包内 `Codex-Turnloom.apk` 同 `ef041790…`；包内 bundle `9a534f58…d891d5ae` = 仓库资产；`publish-guard` **5/5**。**已知偏差（owner 裁定接受，记录在案）**：zip 的 `VERSION.json.gitCommit` = `b40e052`，tag `v2.4.2` = `bfb0513`，两者差一个**只动 docs** 的提交；字面规则「tag = 包内 gitCommit」不成立。2.4.3 起改为先 tag 后打包，或让 `VERSION.json` 记录 tag 本身 | **已签（附已知偏差）** |

## 已定口径（供 2.4.3 沿用）

- 选中态用**墨色 + 字重**，不用强调蓝：玻璃底栏上的蓝字会被读成「粘住的选中块」（Human 20:33 原话：「按了之后会变蓝色，太丑了，没有质感」）。
- 按下只降**字形层**透明度（`svg` + `.tl-tabbar-label`），不降到按钮整块：整块 opacity 会让滚动的列表从毛玻璃里透出来。
- 来源标用 Lucide 单一家族：`Terminal` 本身无外框（`SquareTerminal` 才有），`Pi` 直接是 π；未知平台保留两字母兜底——**不允许空块**。
- 更新只有一个对话框：`立即更新` / `稍后`；「稍后」= 本进程同版本不再自动弹；更高 `versionCode` 是新答案，可以再弹。
- PI 优先是**规则**，不是用户选择：`harnessExplicit` 只有设备页手点才为 true，否则每次发现都重新按规则算。

## 观察与残项

- `globals.css` 的 `.tl-tabbar [role="tab"] { transition: none }` 会盖掉 `.tl-tabbar-item` 的 120ms 颜色过渡，选中切换是瞬时的。视觉可接受、未阻断；2.4.3 想更柔和可删这一条（按下态自带 `opacity` 过渡）。
  **实测（NB3 2026-11-26 08:54–08:57，`emulator-5554` 发布版 2.4.2 (101)，真实 `input swipe` 触摸）**：按下 `opacity` 1.0→0.5 用了 **~102 ms**（`0.918@479 ms → 0.5@581 ms`，120 ms ease 的尾段到位）；**松手当帧弹回 1.0**，选中色也在同一帧翻（item computed `transition = none`）。所以这条不是「过渡失效」，而是「过渡只活在 `:active` 里」。
  **2.4.3 定案（NB3 2026-11-26 09:00，owner 只做记录）：删 `transition: none`，并把过渡全部挪到基态。** 写法（已核 `globals.css:287/299-303/500`，`GlassTabBar` 的按钮本身就是 `[role="tab"]`）：

  ```css
  .tl-tabbar-item { transition: color 120ms ease; }              /* :287 已有，删掉 :500 的 transition:none 才生效 */
  .tl-tabbar-item svg,
  .tl-tabbar-item .tl-tabbar-label { transition: opacity 120ms ease; }  /* 基态声明，值变才有过渡 */
  .tl-tabbar-item:active svg,
  .tl-tabbar-item:active .tl-tabbar-label { opacity: .5; }       /* 删掉 :302 那条只在 :active 里的 transition */
  ```

  注意：`opacity` 变的是 `svg` / `.tl-tabbar-label`，过渡必须写在**这两个元素**的基态上；写在 `.tl-tabbar-item` 上无效（那个元素没有 opacity 变化）。验收判据（NB3 复核按这四条签）：① 按下 ~102 ms（±20）到 0.5；② 松手 **120 ms 内**回到 1.0，不是当帧；③ 选中色 120 ms 内完成，不再同帧翻；④ 门禁 1 不变——底栏内仍无 `rgba(0,122,255` 背景块、`.tl-tabbar` 内无 `!important`。2.4.2 出货字节不动，只进 2.4.3。
- 320 三页*内容*：**模拟器已走查（NB3，2026-11-26 08:54–08:57，`emulator-5554` 发布版 2.4.2 (101) + 真实配对/会话，`wm density 390` → 320×645 css / dpr 2.438）**：三页 `scrollWidth−clientWidth = 0`、越界元素 0，底栏 56.4 高 / 三项各 106.7×56，触达 44+（`.tl-choice-option` 33×44 无 slop，但 390 宽同样 33，非 320 特有），**PASS**；报告 `D:\Turn-DSH\.scratch\nb3-320-20261126\run-2026-11-26T00-54-41\`。**真机仍挂账**：本版两页有新控件（导航、更新弹层），门禁覆盖几何与 DOM，「真机上看一眼」仍挂到 Rhea 的 100→101 装置走查，覆盖则回填。
- 320 下的省略号截断 3 处（全是 nowrap+ellipsis，无裸裁切；状态词未丢——卡内 `127.0.0.1:8787 · 在线 · 刚同步` 完整）：`.tl-settings-title` 138/200（`Turnloom-QA · Cod…`）、会话页 72 处（19 行 × title+preview）。其中 `.tl-plat-meta` 那条**已修**（`e13f453`：设备卡改三行式，「发现时在线」删掉、离线才出 chip；NB3 用 debug 构建重跑 `run-320.mjs` 复核 `clipped 0` / `offenders 0`，基线 186/212 已消失）；剩下两条与小A2 这批无关，仍是 2.4.3 候选。2.4.3 候选（NB3 提，均不阻塞 2.4.2）：设置页当前电脑标题去平台名或给两行；会话标题允许两行、日期另起。
- **门禁④ 键盘子项未过（小A2 实测 2026-11-26 09:19，待修，进 2.4.3）**：390dp 键盘弹起 `innerHeight` = 517，「验证并连接」落在 477..527，只露 10 px 且不自动滚动；320dp 时整颗在视口外（371..421 vs 293）。根因在代码里：`app/src/screens/ConnectScreen.tsx:157` 只在「展开手动表单」时调一次 `scrollIntoView`，输入框聚焦与键盘顶起后不再滚动；`.tl-connect-scroll`（`globals.css:463`）本身 `overflow-y: auto` 可滚，但底部只留 `24px + safe-area`，键盘占了半屏后按钮就落在可视区外。修法：两个输入框 `focus` 时把「验证并连接」滚进视口，并在键盘态补足底部留白。授权 2026-11-26 09:21 执行，验收两档（390 / 320）按钮整颗可见可点且输入框不被遮，已有 composer 键盘行为不得退步。**NB3 09:21 补两条设计侧判据**：① 键盘收起后布局必须自己复原、输入框焦点不丢（不能靠用户再点一下才回位）；② 不许给整页加滚动条凑数——`.tl-connect-scroll` 现在就能滚就沿用它，改动只落在「focus / 键盘顶起后再滚一次 + 键盘态补底部留白」。
- 门禁稳定性记录：旧版 `check-242-update.mjs` 在 320 曾出现 5 条 FAIL（`settings-open` 起，伴随 `Page.captureScreenshot: timeout`）；`e54b67f` 加了截图重试后，冻结树上 320 跑 **36 PASS / exit 0**。判定为脚本时序问题，不是 320 布局缺陷。
- 版本号漂移的根因已补：`APP_IDENTITY` 之前停在 `2.4.0 / 99`，`test/app-identity.test.cjs` 现在要求三处逐字一致（2/2 通过），下次漏改直接红。
- `check-226-device` 在冻结后曾两条红（`listSummary.stripDoesNotEatTrack` / `tapBand`，`bandHeight 0`）：原因是 2.2.6 夹具把 `getAppInfo` 写死成 `2.2.6 / 95`，新的启动自检按公网清单自动弹了更新层，盖住列表 tab。`b40e052` 改为读当前构建版本后，390/320 两档 exit 0。**结论：夹具撞车，不是布局回归**；记录在此，避免下次把它当布局问题重查。
