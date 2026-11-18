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
