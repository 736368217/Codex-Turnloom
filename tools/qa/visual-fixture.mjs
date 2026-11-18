#!/usr/bin/env node
/**
 * Visual-audit fixture API for the single App line (`app/`).
 *
 * It serves only read-mostly `/api/*` responses in the exact shapes the client
 * parses (`app/src/lib/turnloomApi.ts` + `machinePairing.ts`), so the real
 * production bundle can be screenshotted at 390×844 / 360×800 / 320×568 /
 * 768×1024 with deterministic, synthetic content.
 *
 *   node tools/qa/visual-fixture.mjs          # 127.0.0.1:7812
 *
 * Nothing here is a claim about the real host: it is a layout fixture. Every
 * screenshot taken against it is labeled as fixture data in VISUAL_AUDIT.md.
 * No private conversation, credential or path from this machine is included.
 */
import http from "node:http";

const PORT = Number(process.env.QA_VISUAL_PORT || 7812);
const HOST = "127.0.0.1";
const now = Date.now();
const HASH_OK = "a".repeat(64);

const WIDE_CODE = [
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  'node tools/qa/visual-capture.mjs --out docs/qa/visual --viewport 390x844 --scale 2',
  'for f in app/src/screens/*.tsx; do echo "== $f"; wc -l "$f"; done',
  "npx vite preview --port 4173 --strictPort",
].join("\n");

const LONG_MD = [
  "## 视觉检定结论",
  "",
  "这一屏验证 **390×844** 下的正文排版：长段落、有序/无序列表、引用、表格、行内代码与宽代码块。",
  "",
  "1. 中文断行以字为单位，标点不落在行首；",
  "2. 英文单词整体换行，不把 URL 撑破气泡；",
  "3. 代码块横向滚动，右侧不能被圆角裁掉。",
  "",
  "- 行内代码 `app/src/theme/globals.css` 与正文基线对齐",
  "- 长路径 C:\\Users\\Administrator\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar\\dsh\\dist\\web\\assets\\index-8f7c1d2e.js",
  "- 长链接 https://example.com/very/long/path/that/keeps/going?token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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
  "> 引用块：这一行超过一屏宽时必须换行，而不是把气泡撑破。",
  "",
  "最后一行结束。",
].join("\n");

const TOOL_OUTPUT = [
  "$ npm run app:typecheck",
  "> turnloom-app@2.1.7 typecheck",
  "> tsc --noEmit",
  "",
  "$ npm run app:build",
  "dist/assets/index-DmRNNmQ-.js  758.15 kB │ gzip: 221.57 kB",
].join("\n");

const projectA = { key: "codex-turnloom", name: "Codex-Turnloom" };
const projectB = { key: "pidesktop-bridge", name: "PI-Desktop 桥接" };

const threads = [
  {
    id: "qa-visual-md", title: "视觉检定：长 Markdown、代码块与表格", status: { state: "ended" },
    updatedAt: now - 60_000, preview: "这一屏验证 390×844 下的正文排版…", project: projectA,
    cwd: "D:\\Turn-DSH\\Codex-Turnloom", model: "gpt-5.1-codex",
  },
  {
    id: "qa-visual-running", title: "正在运行：把视觉检定跑完", status: { state: "running", thinking: true, startedAtMs: now - 95_000 },
    updatedAt: now - 5_000, preview: "工具调用中…", project: projectA, cwd: "D:\\Turn-DSH\\Codex-Turnloom",
  },
  {
    id: "qa-visual-approval", title: "等待审批：删除构建产物的命令", status: { state: "waiting", thinking: true, interactionRequired: true },
    updatedAt: now - 120_000, preview: "需要确认 rm -rf 操作", project: projectA, cwd: "D:\\Turn-DSH\\Codex-Turnloom",
  },
  {
    id: "qa-visual-failed", title: "失败：桌面端服务未启动", status: { state: "ended", error: "desktop-ipc-unavailable" },
    updatedAt: now - 3_600_000, preview: "连接电脑失败", project: projectB, cwd: "D:\\Turn-DSH\\Codex-Turnloom\\third-party",
  },
  {
    id: "qa-visual-longtitle",
    title: "这是一个非常非常长的会话标题用来验证标题截断与换行是否会把右侧状态挤掉或者撑出横向滚动条",
    status: { state: "ended" }, updatedAt: now - 86_400_000, preview: "很长的标题", project: projectB,
  },
];
for (let i = 1; i <= 24; i += 1) {
  threads.push({
    id: `qa-visual-filler-${String(i).padStart(2, "0")}`,
    title: `填充会话 ${i}：检查列表滚动与点击目标`,
    status: { state: i % 4 === 0 ? "running" : "ended" },
    updatedAt: now - i * 900_000,
    preview: "填充数据 · 用于观察列表密度与分隔线",
    project: i % 2 ? projectA : projectB,
    cwd: "D:\\Turn-DSH\\Codex-Turnloom",
  });
}

const messagesByThread = {
  "qa-visual-md": [
    { id: "m1", role: "user", content: "帮我看下这条消息在手机上的宽度", createdAt: now - 600_000 },
    { id: "m2", role: "assistant", kind: "thinking", content: "先确认气泡宽度与断行策略，再检查代码块的横向滚动是否被裁掉。", createdAt: now - 590_000 },
    { id: "m3", role: "assistant", content: LONG_MD, createdAt: now - 580_000 },
    { id: "m4", role: "tool", kind: "tool_output", title: "shell · 2.1s", content: TOOL_OUTPUT, createdAt: now - 570_000 },
    { id: "m5", role: "assistant", content: "短回复：好的。", createdAt: now - 560_000 },
    { id: "m6", role: "user", content: "再确认一下超长的一行中文会不会把气泡撑出去，比如这一段：把视觉做到 iOS 级完成度的关键在于留白、字重与层级的一致性，而不是堆叠更多的分隔线和阴影。", createdAt: now - 555_000 },
    { id: "m7", role: "tool", kind: "error", title: "apply_patch 失败", content: "error: patch does not apply\n  at app/src/screens/ChatDetailScreen.tsx:273", createdAt: now - 550_000 },
  ],
  "qa-visual-running": [
    { id: "r1", role: "user", content: "继续跑一遍检定", createdAt: now - 95_000 },
    { id: "r2", role: "assistant", content: "正在执行 build 与截图，稍后给出前后对比。", createdAt: now - 90_000 },
    { id: "r3", role: "tool", kind: "tool_call", title: "shell", content: "$ npm run app:build\nvite v7.3.8 building client environment for production...", createdAt: now - 85_000 },
  ],
  "qa-visual-approval": [
    { id: "a1", role: "user", content: "清掉临时构建目录", createdAt: now - 200_000 },
    {
      id: "a2", role: "interaction", kind: "approval", approvalKind: "command", requestId: "req-qa-0001",
      threadId: "qa-visual-approval", detailsHash: HASH_OK, canApprove: true, title: "需要确认的命令",
      content: "$ rm -rf app/dist && npm run app:build\n\n工作目录：D:\\Turn-DSH\\Codex-Turnloom\n理由：契约要求干净重建，删除产物目录。",
      availableDecisions: ["decline", "approve", "approveForSession"], createdAt: now - 190_000,
    },
  ],
  "qa-visual-failed": [
    { id: "f1", role: "user", content: "打开会话", createdAt: now - 3_600_000 },
    { id: "f2", role: "notice", kind: "error", content: "连接电脑失败：桌面端服务未响应。", createdAt: now - 3_590_000 },
  ],
  "qa-visual-longtitle": [
    { id: "l1", role: "user", content: "标题很长的时候，头部会怎么处理？", createdAt: now - 86_400_000 },
  ],
};

const changes = {
  "qa-visual-md": [
    { path: "app/src/theme/globals.css", status: "modified", additions: 42, deletions: 18 },
    { path: "app/src/components/StatusCard.tsx", status: "modified", additions: 12, deletions: 9 },
  ],
};

const models = [
  { id: "gpt-5.1-codex", label: "GPT-5.1 Codex", efforts: ["low", "medium", "high"], defaultEffort: "high", supportsImages: true },
  { id: "gpt-5.1", label: "GPT-5.1", efforts: ["low", "medium", "high"], defaultEffort: "medium", supportsImages: true },
  { id: "o4-mini", label: "o4-mini", efforts: [], supportsImages: false },
  { id: "claude-sonnet-4.5", label: "Claude Sonnet 4.5", efforts: ["low", "medium", "high"], defaultEffort: "medium", supportsImages: true },
];

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "accept, content-type, x-access-token",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "cache-control": "no-store",
  });
  res.end(payload);
}

function messagesFor(id, { limit = 80, before = "" } = {}) {
  const all = messagesByThread[id] || [];
  const end = before ? Math.max(0, Number(before) || 0) : all.length;
  const start = Math.max(0, end - Number(limit || 80));
  return { rows: all.slice(start, end), hasOlder: start > 0, olderCursor: start > 0 ? String(start) : null };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const path = url.pathname;
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    if (req.method === "OPTIONS") { res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "accept, content-type, x-access-token",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    }); return res.end(); }

    if (path === "/api/harnesses") {
      return json(res, 200, {
        ok: true, protocol: "codex-turnloom", version: 2,
        machineId: "qa-visual-machine", machineName: "QA 工作站",
        defaultHarnessId: "codex", harnesses: [
          { id: "codex", name: "Codex Desktop", token: "qa-codex-token", kind: "codex", online: true, defaultHarness: true },
          { id: "pidesk", name: "PI-Desktop", token: "qa-pi-token", kind: "pi", online: true },
        ],
      });
    }
    if (path === "/api/health") {
      return json(res, 200, {
        ok: true, authRequired: true, version: "2.1.7",
        backend: { kind: "codex", url: "fixture://qa", profile: null },
        models, defaultModel: "gpt-5.1-codex", defaultEffort: "high",
      });
    }
    if (path === "/api/threads") {
      const limit = Number(url.searchParams.get("limit") || 60);
      const cursor = Number(url.searchParams.get("cursor") || 0);
      const start = Number.isFinite(cursor) && cursor > 0 ? cursor : 0;
      const slice = threads.slice(start, start + limit);
      const next = start + limit < threads.length ? String(start + limit) : null;
      return json(res, 200, { threads: slice, total: threads.length, nextCursor: next });
    }
    const msgMatch = /^\/api\/threads\/([^/]+)\/messages$/.exec(path);
    if (msgMatch) {
      const id = decodeURIComponent(msgMatch[1]);
      const thread = threads.find((row) => row.id === id);
      if (!thread) return json(res, 404, { error: "thread-not-found" });
      const page = messagesFor(id, {
        limit: url.searchParams.get("limit") || 80,
        before: url.searchParams.get("before") || "",
      });
      return json(res, 200, {
        thread, messages: page.rows, status: thread.status,
        hasOlderMessages: page.hasOlder, olderCursor: page.olderCursor,
      });
    }
    const changeMatch = /^\/api\/threads\/([^/]+)\/changes$/.exec(path);
    if (changeMatch) {
      const id = decodeURIComponent(changeMatch[1]);
      return json(res, 200, { changes: changes[id] || [], changed: Boolean(changes[id]) });
    }
    const archiveMatch = /^\/api\/threads\/([^/]+)\/archive$/.exec(path);
    if (archiveMatch && req.method === "POST") return json(res, 200, { ok: true, archived: true });
    if (path === "/api/send" && req.method === "POST") return json(res, 200, { ok: true, threadId: "qa-visual-md" });
    if (path === "/api/interrupt" && req.method === "POST") return json(res, 200, { ok: true });
    if (path === "/api/approval" && req.method === "POST") return json(res, 200, { ok: true, requestId: "req-qa-0001" });
    if (path === "/api/projects") return json(res, 200, { projects: [
      { id: "codex-turnloom", name: "Codex-Turnloom", path: "D:\\Turn-DSH\\Codex-Turnloom" },
      { id: "pidesktop-bridge", name: "PI-Desktop 桥接", path: "D:\\Turn-DSH\\Codex-Turnloom\\third-party" },
    ] });
    if (path === "/api/account") return json(res, 200, {
      user: { name: "QA", label: "QA 账号" }, plan: { type: "pro", label: "Pro" },
      backend: { kind: "codex", url: "fixture://qa" },
    });
    if (path === "/api/app/update" || path === "/api/app/update-public") return json(res, 200, {
      available: false, packageName: "com.codex.turnloom.app", versionCode: 83,
      versionName: "2.1.7", apkUrl: "", sha256: "", sizeBytes: 0, notes: "",
    });
    return json(res, 404, { error: `unhandled ${req.method} ${path}` });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[visual-fixture] http://${HOST}:${PORT} · ${threads.length} threads`);
});
