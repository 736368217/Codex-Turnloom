#!/usr/bin/env node
/**
 * Deterministic HTTP backend fixture for mobile QA.
 *
 * It implements exactly the adapter contract documented in
 * backends/http-backend.js, so it can be plugged into the real server:
 *
 *   node server.js --backend http --backend-url http://127.0.0.1:7802 --password qa
 *
 * Content is synthetic (no private conversations). It exercises the layout
 * shapes the usability audit needs: short bubbles, long Markdown, wide code,
 * tables, long paths/URLs, tool output, thinking, a running thread, a failing
 * thread, a real approval request, and enough rows to page the thread list.
 */
import http from "node:http";

const PORT = Number(process.env.QA_FIXTURE_PORT || 7802);
const HOST = "127.0.0.1";
const HASH_OK = "a".repeat(64);
const HASH_STALE = "b".repeat(64);
/**
 * QA_SEND_FAIL turns POST /threads/:id/messages into the 2.2.1 failure modes:
 *   image-400  400 with a real Chinese host sentence + code
 *   reset      drop the socket (transport failure; the app retries once)
 *   timeout    never answer (the client's 30 s timer must win)
 * Unset = the normal 200 fixture used by the visual/usability suite.
 */
const SEND_FAIL = String(process.env.QA_SEND_FAIL || "").trim();
const now = Date.now();

const WIDE_CODE = [
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  'node --experimental-strip-types ./tools/qa/capture.mjs --viewport 390x844 --out docs/qa/visual --device-scale-factor 3 --timeout 30000 --wait-for-selector ".tl-chat-list"',
  "for f in app/src/screens/*.tsx; do echo \"== $f\"; wc -l \"$f\"; done",
].join("\n");

const LONG_MD = [
  "## 回归结论",
  "",
  "这一轮验证了 **390×844** 下的会话详情排版，包含长段落、列表、表格、行内代码与宽代码块。",
  "",
  "- 短消息气泡：`padding` 与行高一致，没有上下抖动。",
  "- 长段落：中文断行正常，标点不落在行首。",
  "- 宽代码块：需要横向滚动，且不能被气泡裁掉右侧内容。",
  "- 长路径：`C:\\\\Users\\\\Administrator\\\\AppData\\\\Local\\\\Programs\\\\DeepSeek Harness\\\\resources\\\\app.asar\\\\dsh\\\\dist\\\\web\\\\assets\\\\index-8f7c1d2e.js`",
  "- 长链接：https://example.com/very/long/path/that/keeps/going?token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "",
  "| 视口 | 状态 | 备注 |",
  "| --- | --- | --- |",
  "| 390×844 | 通过 | 主验收尺寸 |",
  "| 360×800 | 待看 | 安卓常见 |",
  "| 320×568 | 待看 | 老设备最小宽 |",
  "",
  "```bash",
  WIDE_CODE,
  "```",
  "",
  "> 引用块：如果这一行超过一屏宽，必须换行而不是撑破气泡。",
  "",
  "最后一行结束。",
].join("\n");

const TOOL_OUTPUT = [
  "$ npm run app:typecheck",
  "> turnloom-app@2.1.7 typecheck",
  "> tsc --noEmit",
  "",
  "$ git status --porcelain",
  "?? app/package-lock.json",
  "?? docs/team/",
  "?? tools/qa/",
].join("\n");

const threads = [
  { id: "qa-long", title: "长 Markdown、代码块与表格的排版回归", status: { state: "ended" }, updatedAtMs: now - 60_000, },
  { id: "qa-running", title: "正在运行：把视觉检定跑完", status: { state: "running", thinking: true, startedAtMs: now - 95_000 }, updatedAtMs: now - 5_000, },
  { id: "qa-approval", title: "等待审批：删除构建产物的命令", status: { state: "waiting", thinking: false, interactionRequired: true }, updatedAtMs: now - 120_000, },
  { id: "qa-failed", title: "失败：桌面端服务未启动", status: { state: "ended", error: "desktop-ipc-unavailable" }, updatedAtMs: now - 3_600_000, },
  { id: "qa-mismatch", title: "审批详情缺失（按钮应禁用）", status: { state: "waiting", interactionRequired: true }, updatedAtMs: now - 7_200_000, },
  { id: "qa-long-title", title: "这是一个非常非常长的会话标题用来验证标题截断与换行是否会把右侧状态挤掉或者撑出横向滚动条", status: { state: "ended" }, updatedAtMs: now - 86_400_000, }
];
for (let i = 1; i <= 34; i += 1) {
  threads.push({ id: `qa-filler-${String(i).padStart(2, "0")}`, title: `填充会话 ${i}：检查列表滚动与点击目标`, status: { state: i % 3 === 0 ? "running" : "ended" }, updatedAtMs: now - i * 900_000, });
}

const messagesByThread = {
  "qa-long": [
    { id: "m1", role: "user", content: "帮我看下这条消息在手机上的宽度", createdAt: now - 600_000 },
    { id: "m2", role: "assistant", kind: "thinking", content: "先确认气泡宽度与断行策略，再检查代码块的横向滚动是否被裁掉。", createdAt: now - 590_000 },
    { id: "m3", role: "assistant", content: LONG_MD, createdAt: now - 580_000 },
    { id: "m4", role: "tool", kind: "tool_output", title: "shell · 2.1s", content: TOOL_OUTPUT, createdAt: now - 570_000 },
    { id: "m5", role: "assistant", content: "短回复：好的。", createdAt: now - 560_000 },
    { id: "m6", role: "tool", kind: "error", title: "apply_patch 失败", content: "error: patch does not apply\n  at C:\\\\Users\\\\Administrator\\\\project\\\\app\\\\src\\\\screens\\\\ChatDetailScreen.tsx:273", createdAt: now - 550_000 }
  ],
  "qa-running": [
    { id: "r1", role: "user", content: "继续跑一遍检定", createdAt: now - 95_000 },
    { id: "r2", role: "assistant", content: "正在执行 build 与截图…", createdAt: now - 90_000 }
  ],
  "qa-approval": [
    { id: "a1", role: "user", content: "清掉临时构建目录", createdAt: now - 200_000 },
    {
      id: "a2", role: "interaction", kind: "approval", approvalKind: "command", requestId: "req-qa-0001",
      threadId: "qa-approval", detailsHash: HASH_OK, canApprove: true, title: "需要确认的命令",
      content: "$ rm -rf app/dist && npm run app:build\n\n工作目录：D:\\\\Turn-DSH\\\\Codex-Turnloom\n理由：契约要求干净重建，删除产物目录。",
      availableDecisions: ["decline", "approve", "approveForSession"], createdAt: now - 190_000
    }
  ],
  "qa-failed": [
    { id: "f1", role: "user", content: "打开会话", createdAt: now - 3_600_000 },
    { id: "f2", role: "notice", kind: "error", content: "连接电脑失败：桌面端服务未响应。", createdAt: now - 3_590_000 }
  ],
  "qa-mismatch": [
    { id: "x1", role: "user", content: "看一下这个审批", createdAt: now - 7_200_000 },
    {
      id: "x2", role: "interaction", kind: "approval", approvalKind: "file", requestId: "req-qa-stale",
      threadId: "qa-mismatch", detailsHash: HASH_STALE, canApprove: false, unavailable: true, title: "需要确认的文件修改",
      content: "+ 删除 3 个文件", availableDecisions: ["decline", "approve"], createdAt: now - 7_100_000
    }
  ]
};

// 预览必须能从会话自己的最后一条文本消息推出来，不许手写。
// 生产环境的 /api/threads 常常没有 preview，列表行会掉到 cwd/id 上；
// 夹具一旦自己编一句好听的，这个缺陷就永远看不见（真机上一整列 UUID 就是这么漏的）。
for (const thread of threads) {
  const rows = messagesByThread[thread.id] || [];
  const last = [...rows].reverse().find((message) =>
    (message.role === "user" || message.role === "assistant")
    && typeof message.content === "string" && message.content.trim() !== "");
  thread.preview = last ? last.content.replace(/\s+/g, " ").slice(0, 60) : "";
}

// 新建会话的默认项目取自「最近一条有 projectId 的会话」，所以这里必须给真值，
// id 与 /api/projects 的 id 对齐（turnloom / pidesktop / notes）。
threads.forEach((thread, index) => {
  if (index % 3 === 0) thread.projectId = "turnloom";
  else if (index % 3 === 1) thread.projectId = "pidesktop";
});

// 「未归类」必须至少有一条真实样本：分组 UI 要求它排最后且默认展开。
for (const thread of threads.slice(-2)) delete thread.projectId;

const resolved = new Set();
const approvalsSeen = [];
const sendsSeen = [];

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

function threadById(id) {
  return threads.find((row) => row.id === id) || null;
}

function messagesFor(id, { limit = 200, before = "" } = {}) {
  const all = messagesByThread[id] || [];
  const live = all.filter((row) => !(resolved.has(`${id}:${row.requestId || ""}`) && row.role === "interaction"));
  const end = before ? Math.max(0, Number(before)) : live.length;
  const start = Math.max(0, end - Number(limit || 200));
  return { rows: live.slice(start, end), hasOlder: start > 0, olderCursor: start > 0 ? String(start) : null, total: live.length };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const path = url.pathname;
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    // 引用菜单的另外两档：形状照 Atlas 的真库（skills 带 uri，plugins 带 compact）。
    // QA_CATALOG_FAIL=1 模拟「宿主没有这两个接口」（代理会包成 200 + unavailable:true）。
    if (process.env.QA_CATALOG_FAIL && (path === "/skills" || path === "/plugins")) {
      return json(res, 503, { error: "catalog-unavailable" });
    }
    if (req.method === "GET" && path === "/skills") {
      return json(res, 200, {
        skills: [
          { name: "qa-skill-a", displayName: "QA 技能 A", description: "用于验证技能档插入格式", source: "user", priority: 80, kind: "prompt", action: "insert", uri: "skill://qa-skill-a@user" },
          { name: "qa-skill-b", displayName: "QA 技能 B", description: "第二条技能，用来验证搜索过滤", source: "system", priority: 40, kind: "prompt", action: "insert", uri: "skill://qa-skill-b@system" },
          { name: "qa-skill-c", displayName: "QA 技能 C", description: "第三条技能", source: "user", priority: 10, kind: "prompt", action: "insert", uri: "skill://qa-skill-c@user" },
        ],
      });
    }
    if (req.method === "GET" && path === "/plugins") {
      const compact = url.searchParams.get("compact") === "1";
      const plugins = [
        { name: "qa-plugin-a", displayName: "QA 插件 A", description: "用于验证插件档插入格式", marketplace: "local", uri: "plugin://qa-plugin-a@local" },
        { name: "qa-plugin-b", displayName: "QA 插件 B", description: "第二条插件", marketplace: "community", uri: "plugin://qa-plugin-b@community" },
      ].map((plugin) => (compact ? plugin : { ...plugin, iconDataUrl: "data:image/png;base64,iVBORw0KGgo=" }));
      return json(res, 200, { plugins });
    }
    if (req.method === "GET" && path === "/threads") {
      return json(res, 200, { threads, total: threads.length });
    }
    // 新建会话要能选项目：真机上是 /api/projects，这里去掉 /api 前缀。
    if (req.method === "GET" && path === "/projects") {
      return json(res, 200, {
        projects: [
          { id: "turnloom", name: "Codex-Turnloom", threadCount: 12, updatedAtMs: now - 60_000 },
          { id: "pidesktop", name: "PI-Desktop 桥接", threadCount: 4, updatedAtMs: now - 3_600_000 },
          { id: "notes", name: "随手记", threadCount: 1, updatedAtMs: now - 86_400_000 },
        ],
      });
    }
    const msgMatch = /^\/threads\/([^/]+)\/messages$/.exec(path);
    if (msgMatch && req.method === "GET") {
      const id = decodeURIComponent(msgMatch[1]);
      const thread = threadById(id);
      if (!thread) return json(res, 404, { error: "thread-not-found" });
      const page = messagesFor(id, { limit: url.searchParams.get("limit") || 200, before: url.searchParams.get("before") || "" });
      return json(res, 200, {
        thread,
        messages: page.rows,
        status: thread.status,
        totalMessages: page.total,
        hasOlderMessages: page.hasOlder,
        olderCursor: page.olderCursor,
      });
    }
    if (msgMatch && req.method === "POST") {
      let payload = {};
      try { payload = JSON.parse(body || "{}"); } catch { payload = {}; }
      sendsSeen.push({ threadId: decodeURIComponent(msgMatch[1]), model: payload.model ?? null, effort: payload.effort ?? null, message: String(payload.text ?? payload.message ?? "").slice(0, 40), hasModelField: Object.prototype.hasOwnProperty.call(payload, "model"), projectId: payload.projectId ?? null });
      if (SEND_FAIL === "image-400") {
        return json(res, 400, {
          error: "图片尺寸超出电脑端限制（单边 16–4096px，且总像素 ≤12MP），当前 4032×3024（12.2MP）。请压缩或裁剪后再发送。",
          code: "image_dimensions_out_of_range",
        });
      }
      if (SEND_FAIL === "reset") { req.socket.destroy(); return; }
      if (SEND_FAIL === "timeout") return; // leave the socket open; the app's timer decides
      return json(res, 200, { ok: true });
    }
    if (path === "/threads" && req.method === "POST") {
      let payload = {};
      try { payload = JSON.parse(body || "{}"); } catch { payload = {}; }
      const text = String(payload.text ?? payload.message ?? "").slice(0, 200);
      const id = `qa-new-${Date.now()}`;
      sendsSeen.push({ threadId: id, model: payload.model ?? null, effort: payload.effort ?? null, message: text.slice(0, 40), hasModelField: Object.prototype.hasOwnProperty.call(payload, "model"), newThread: true, projectId: payload.projectId ?? null, clientRequestId: payload.clientRequestId ?? null });
      threads.unshift({
        id, title: text.slice(0, 48) || "新会话", preview: text.slice(0, 80),
        status: { state: "ended" }, updatedAt: Date.now(),
      });
      // The real host echoes the first user message; the mock does too, so the
      // post-send screenshot shows a real bubble instead of "暂无消息".
      messagesByThread[id] = [{ id: `${id}-m1`, role: "user", content: text, createdAt: Date.now() }];
      return json(res, 200, { ok: true, threadId: id });
    }
    const interruptMatch = /^\/threads\/([^/]+)\/interrupt$/.exec(path);
    if (interruptMatch && req.method === "POST") {
      const id = decodeURIComponent(interruptMatch[1]);
      const thread = threadById(id);
      if (thread) thread.status = { state: "ended" };
      return json(res, 200, { ok: true });
    }
    if (path === "/approval" && req.method === "POST") {
      let payload = {};
      try { payload = JSON.parse(body || "{}"); } catch { payload = {}; }
      approvalsSeen.push(payload);
      const exact = payload.threadId === "qa-approval" && payload.requestId === "req-qa-0001" &&
        payload.approvalKind === "command" && payload.detailsHash === HASH_OK;
      if (!exact) return json(res, 409, { error: "approval-request-mismatch" });
      resolved.add(`qa-approval:req-qa-0001`);
      return json(res, 200, { ok: true, requestId: payload.requestId, decision: payload.decision });
    }
    if (path === "/__qa/approvals" && req.method === "GET") {
      return json(res, 200, { approvalsSeen });
    }
    if (path === "/__qa/sends" && req.method === "GET") {
      return json(res, 200, { sendsSeen });
    }
    if (path === "/__qa/reset" && req.method === "POST") {
      resolved.clear();
      approvalsSeen.length = 0;
      sendsSeen.length = 0;
      // Drop threads created by earlier viewports so each screenshot starts
      // from the same deterministic list.
      for (let index = threads.length - 1; index >= 0; index -= 1) {
        if (String(threads[index].id || "").startsWith("qa-new-")) {
          delete messagesByThread[threads[index].id];
          threads.splice(index, 1);
        }
      }
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: `unhandled ${req.method} ${path}` });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[fixture] backend on http://${HOST}:${PORT}`);
});

