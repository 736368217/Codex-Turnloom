# tools/qa — 移动端 E2E 截图与量测

不起第二套假 App：这里跑的是**真实 `server.js`**，只是把后端换成固定数据。App 代码零改动。

```powershell
npm run app:build                                     # 先构建 app/dist
node tools/qa/capture.mjs                             # 390×844，写到 docs/qa/visual/before
node tools/qa/capture.mjs --out docs/qa/visual/after
node tools/qa/capture.mjs --viewports 360x800,320x568,768x1024 --out docs/qa/visual/after
node tools/qa/capture.mjs --only threads,chat --dump   # 只跑部分屏；--dump 打印 TabBar DOM
```

输出：每个视口一个目录（`<out>/390x844/01-connect.png` …），加上 `report.json`（每屏的横向溢出、越界元素、<44px 交互元素、TabBar/输入舱几何、请求日志、审批请求体）。

## 2.2.6 重设计：分段控件的行为验收

```powershell
node tools/qa/check-redesign.mjs             # 夹具自证 + 真实 app/dist（控件未落地则 SKIP）
node tools/qa/check-redesign.mjs --build     # 先按当前源码重建 app/dist 再量，免得量到上一轮产物
node tools/qa/check-redesign.mjs --require   # 控件必须在；缺失算失败（出包门禁用）
```

判据全部可量，不靠眼看：切换时逐帧采样指示器位移（过渡中 ≥3 帧落在 A、B 之间且单调）；静止时指示器落在选中段内、中心差 ≤1px；轨道整条 44px 带用 `elementFromPoint` 逐点验证归属（按钮盒 38px 也不等于只有 38px 可点）；列表滚动时控件不移动（Vera 判据 5）；`prefers-reduced-motion: reduce` 下 1 帧落位；390/360/320 无横向溢出；thumb 过渡 300ms。输出里钉死 `asset` 文件名与字节数——同一份 `report.json` 混过两个 build，这件事必须可追。

判据先在夹具上自证：240ms 过渡那份必须过，0ms 瞬移那份必须被判失败（`EXPECTED-FAIL`，不计入结论）。判据没牙齿时这一步会先红。

契约：视图切换是 `role="tablist"` + `role="tab"`（文字「按时间」「按项目」），指示器命中 `[data-seg-thumb]` / `.tl-seg-pill` / `.tl-seg-thumb` / class 含 `thumb|indicator|pill` 之一。换 DOM 不用改脚本，保住这两条即可。

### 设备面板：第二条门禁（`check-226-device.mjs`）

`check-redesign.mjs` 管几何与动画；设备树的「记得住两台、单值、只开一层、失败语义」由 `check-226-device.mjs` 判——它播种两台已配对电脑（A = 视觉夹具，B = 报自己身份的代理，可 `--mode fail` 返 503）。

```powershell
node tools/qa/check-226-device.mjs --build --mode ok --width 390   # 重建 tmp/dist-vera；两台在场、切过去成功
node tools/qa/check-226-device.mjs --mode ok   --width 320         # 复用上面那个 bundle
node tools/qa/check-226-device.mjs --mode fail --width 390         # B 返 503：当前卡不变、提示带原因
```

- **第一条必须带 `--build`**：不带时直接复用 `tmp/dist-vera` 里的旧包（`check-226-device.mjs:40,69`），源码改了却不重建，四组测的仍是上一轮的 bundle——这种绿比红危险。宁可直接删掉 `tmp/dist-vera` 再跑：没有 bundle 会报错退出。
- `--build` 只写 `tmp/dist-vera`（共享的 `app/dist` 是别人的活靶子，不碰）；端口全部运行时分配，和别的 QA 跑不冲突。
- 同一次运行还会在**同一个 bundle** 上跑 `snippets/check-226-list.js`（滑块、命中带、钉住、减动效），报告里钉死 asset 名与字节数。
- **退出码就是结论**：任何一格 FAIL → 1。出包前直接看退出码，不用读 JSON。

**出包门禁要两条都绿**：`84 PASS / 0 FAIL` 里不含「`data-machine` 只挂 `.tl-platblock`」和「失败提示带原因」，那两格在这条脚本里，别让前者的绿盖过后者的红。

### 量边界：一把尺子量两边

headless Chromium 的 `elementFromPoint` 把每个盒子的上沿提前约 **0.95px**（300px 处放一个纯黑 div，它从 299.05 就开始命中），而截图里它仍从 300 画起。所以**不要拿 `getBoundingClientRect()` 当几何基准**——正确的实现会被判成「越出 1px」。做法：用同一把尺子量两侧，逐 0.1px 扫出元素的首末行，再把对手元素临时关掉（例如命中带的 `::before`）扫它自己的首末行，比两侧差值；声明侧另给一条精确判据（`::before -3px` → 带高 44、越出 上 0 / 下 0）。

## 2.2.1 发送链路：故障 E2E 与真实照片压缩

```powershell
node --test test/app-send-faults.test.cjs          # 400/超时/断连/重试/诊断上报（真实 HTTP 故障服务）
node tools/qa/compress-check.mjs                    # 4032×3024 → 2048 长边 JPEG，headless Edge + 真 /api/send
$env:QA_SEND_FAIL='image-400'; node tools/qa/capture.mjs --only chat,compose --viewports 390x844,360x800,320x568
$env:QA_BRIDGE_SEND_FAIL='network'; node tools/qa/capture.mjs --only chat,compose --viewports 390x844
$env:QA_BRIDGE_SEND_FAIL='timeout'; node tools/qa/capture.mjs --only chat,compose --viewports 390x844
```

- `send-fault-server.mjs`：`/api/send` 的确定性故障旋钮（`ok / image-400 / english-400 / chinese-400 / empty-400 / 413 / timeout / reset / reset-once / 401 / slow-ok`），并实现 `/api/diagnostics` 的 200/401/413 与最近 200 条截断。它也记录每次请求的 `clientRequestId`、图片名与字节数，供 `test/app-send-faults.test.cjs` 断言。
- `compress-check.mjs`：把生产 `app/src/lib/imageUpload.ts` 用 app 自带的 esbuild 打成 IIFE，在 390×844@3 的 headless Edge 里跑真实 canvas 压缩，再把结果 POST 到故障服务；输出 `.scratch/qa/compress-report.json`（源图字节、长边、输出字节、请求体字节、发送状态）。
- `capture.mjs` 的两个环境变量：`QA_SEND_FAIL` 让 fixture 后端回 400/reset/timeout；`QA_BRIDGE_SEND_FAIL=network|timeout` 在**原生桥边界**回答 status 0（这是 Android socket 断开/读超时的真实形状，`server.js` 到 fixture 的链路做不到——fixture 断开会变成 502）。两者都会截 `11b-send-error` 并记录文案、行数、横向溢出、`role`、草稿是否保留。
- 截图落在 `docs/qa/visual/send/<场景>/<视口>/11b-send-error.png`；该目录被 `.gitignore` 忽略，只在 Thread/报告里引用。

## 组成

| 文件 | 作用 |
| :--- | :--- |
| `fixture-backend.mjs` | 按 `backends/http-backend.js` 契约实现 `/threads`、`/threads/:id/messages`、`/threads/:id/interrupt`、`/approval`。数据里有短消息、长 Markdown、宽代码块、表格、工具卡、思考、运行中、失败、真实审批请求、40 条会话。`POST /approval` 只接受精确的 `{threadId, requestId, approvalKind, detailsHash}`，否则 409。 |
| `pairing-proxy.mjs` | 转发到真服务，只自己回答 `GET /api/harnesses`（原因见 D1）。 |
| `cdp.mjs` | 零依赖 CDP 驱动（Node 22+ 自带 WebSocket）：起 Edge headless、设视口/DPR/安全区、截图、点击、输入、清存储。 |
| `capture.mjs` | 编排整栈 + 走查配对 → 首页 → 会话 → 详情（长文/代码/运行中/审批）→ 监控 → 设置 → 抽屉 → 键盘压缩，并采集量测。 |

`capture.mjs` 自带重试与端口去重（随机取端口，两两不同）；跑完会杀掉自己起的进程。

## 为什么替换原生桥

出厂 WebView 走 `TurnloomNative.request`（无同源限制）。headless 浏览器没有这个对象，所以 harness 注入一个同形状的实现：`request` 用 `fetch` 发同一份 URL/headers/body，再回调 `__turnloomNativeHttpResult`；`secureGet/Set` 落到 `localStorage`。

因此：

- **必须** `--disable-web-security`：页面来自 `vite preview`（随机端口），`/api/*` 指向另一个端口。
- 页内 `fetch` 是跨源的，这条路径与出厂 WebView 不同，只影响 CORS，不影响协议或数据。

## D1（已修）：`--backend http` 模式下手机无法配对（`server.js`）

`server.js:8235` 在 `server.js:8236`（`GET /api/harnesses` 发现路由）**之前**就把请求交给 `handleHttpBackendApi()`；HTTP 后端不认识这个路由，于是返回：

```
GET /api/harnesses -> 501 {"error":"This endpoint is not supported by the HTTP backend"}
```

也就是说：用 `--backend http` 部署时，手机端永远走不到配对发现，`ConnectScreen` 只会报「连不上这台机器」。`pairing-proxy.mjs` 当时用来自己回答这一个请求。**该缺陷已由 `server.js` 修复**（发现路由在 501 兜底前 `return false`，回归 `test/http-backend-pairing.test.cjs`），所以 `capture.mjs` 现在默认直连 `server.js` 配对，`--proxy` 只用于对照旧行为。

复现：

```powershell
node server.js --port 8791 --backend http --backend-url http://127.0.0.1:7802 --password qa
curl.exe -s -H "x-access-token: qa" http://127.0.0.1:8791/api/harnesses     # 501
```

修法（属 `server.js`，owner @Atlas）：把发现路由提到 `handleHttpBackendApi` 之前，或让 HTTP 后端转发 `/api/harnesses`。
