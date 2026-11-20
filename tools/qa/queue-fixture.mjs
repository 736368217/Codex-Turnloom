#!/usr/bin/env node
/**
 * Deterministic queue fixture API for the 2.3.0 mobile queue acceptance.
 *
 * The real App bundle (`app/dist`) is driven against this server, exactly like
 * `visual-fixture.mjs` serves the visual audit. It is a CONTRACT fixture: the
 * shapes follow `docs/team/QUEUE_SPEC.md` §3, and every request is recorded so
 * a UI claim ("send really queued") can be checked against the wire.
 *
 * It is not a claim about the real host. The real `server.js` queue contract is
 * verified separately (`tools/qa/check-queue-api.mjs`); this fixture exists to
 * make every UI state (queued / sending / awaiting / failed / paused / full /
 * enqueue-failure) deterministic at 390×844, 390×640 and 320×568.
 *
 *   node tools/qa/queue-fixture.mjs            # 127.0.0.1:7813
 *
 * Control API (never called by the App):
 *   GET  /__qa/state
 *   GET  /__qa/requests
 *   POST /__qa/reset
 *   POST /__qa/control {action, ...}
 */
import http from "node:http";

const PORT = Number(process.env.QA_QUEUE_PORT || 7813);
const HOST = "127.0.0.1";

// A real 1×1 PNG; queue thumbnails must never claim a picture that is not one.
const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
// A real 2×2 JPEG (red). The image regression must cover both MIME types: a
// JPEG stuffed into a data:image/png URL renders broken in some WebViews.
const JPEG_2PX = "/9j/4AAQSkZJRgABAQEAeAB4AAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD50ooor8MP9Uz/2Q==";
const now = Date.now();

const models = [
  { id: "gpt-5.1-codex", label: "GPT-5.1 Codex", efforts: ["low", "medium", "high"], defaultEffort: "high", supportsImages: true },
  { id: "gpt-5.1", label: "GPT-5.1", efforts: ["low", "medium", "high"], defaultEffort: "medium", supportsImages: true },
];

const THREAD_ID = "qa-queue-running";

const state = {
  thinking: true,
  interactionRequired: false,
  turnId: "turn-qa-queue-1",
  startedAtMs: now - 95_000,
  queue: [],
  paused: false,
  failNextEnqueue: false,
  failNextSteer: false,
  failNextResume: false,
  failNextRetry: false,
  drainTimer: null,
  requests: [],
  seed: 0,
};

const messages = [
  { id: "q1", role: "user", content: "继续跑一遍 2.3.0 的视觉检定", createdAt: now - 95_000 },
  { id: "q2", role: "assistant", content: "正在执行 build 与截图，完成后我会把对比图贴出来。", createdAt: now - 90_000 },
  { id: "q-img", role: "user", content: "先看一下这张照片", createdAt: now - 89_000, images: [{ name: "photo-red.jpg", mimeType: "image/jpeg", url: `/api/thread-image?threadId=${encodeURIComponent(THREAD_ID)}&name=photo-red.jpg` }] },
  { id: "q3", role: "tool", kind: "tool_output", title: "shell · 2.1s", content: "$ npm run app:build\nvite v7 building client environment for production...", createdAt: now - 88_000 },
];

let sequence = 0;
const nextId = () => `qitem-${++sequence}-${Math.random().toString(36).slice(2, 6)}`;

function json(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "accept, content-type, x-access-token",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "cache-control": "no-store",
    ...extraHeaders,
  });
  res.end(payload);
}

function normalizeDelivery(value) {
  const text = String(value || "").toLowerCase();
  if (text === "sending") return "sending";
  if (text === "awaitingconfirmation") return "awaitingConfirmation";
  if (text === "failed") return "failed";
  return "queued";
}

function previewOf(item) {
  const text = String(item.text || "").replace(/\s+/g, " ").trim();
  if (text) return text.slice(0, 80);
  const parts = [];
  if (item.images.length) parts.push(`${item.images.length} 张图片`);
  if (item.files.length) parts.push(`${item.files.length} 个附件`);
  return parts.length ? `（${parts.join("，")}）` : "（空消息）";
}

function statusPayload() {
  return {
    queueLength: state.queue.length,
    queuePaused: state.paused,
    queueSource: "local",
    queueCapabilities: { turnSteer: true, queueFiles: true },
    queuedMessages: state.queue.map((item, index) => ({
      id: item.id,
      position: index + 1,
      text: item.text,
      preview: previewOf(item),
      imageCount: item.images.length,
      fileCount: item.files.length,
      images: item.images.map((image, imageIndex) => ({
        name: image.name,
        mimeType: image.mimeType,
        url: `/api/queue/image?threadId=${encodeURIComponent(THREAD_ID)}&itemId=${encodeURIComponent(item.id)}&index=${imageIndex}`,
      })),
      files: item.files.map((file) => ({ name: file.name, size: file.size, mimeType: file.mimeType })),
      enqueuedAt: item.enqueuedAt,
      deliveryState: item.deliveryState,
      lastError: item.lastError || null,
      model: "",
      effort: "",
    })),
  };
}

function threadStatus() {
  return {
    state: state.thinking ? "running" : state.interactionRequired ? "waiting" : "ended",
    thinking: state.thinking,
    interactionRequired: state.interactionRequired,
    staleTurn: false,
    turnId: state.thinking ? state.turnId : null,
    startedAtMs: state.thinking ? state.startedAtMs : null,
    ...statusPayload(),
  };
}

function threadRow() {
  return {
    id: THREAD_ID,
    title: "运行中：排队一条消息",
    preview: "继续跑一遍 2.3.0 的视觉检定",
    status: { state: state.thinking ? "running" : "ended", thinking: state.thinking },
    updatedAt: now - 5_000,
    cwd: "D:\\Turn-DSH\\Codex-Turnloom",
    project: { key: "codex-turnloom", name: "Codex-Turnloom" },
  };
}

function normalizeAttachments(rows, kind) {
  const list = Array.isArray(rows) ? rows : [];
  return list.map((row, index) => {
    const data = String(row?.data || "").replace(/\s/g, "");
    const size = Number(row?.size) || Math.floor(data.length * 3 / 4);
    return {
      name: String(row?.name || `${kind === "image" ? "图片" : "附件"} ${index + 1}`).slice(0, 120),
      mimeType: String(row?.mimeType || (kind === "image" ? "image/png" : "application/octet-stream")),
      data,
      size,
    };
  }).filter((row) => row.data);
}

function enqueue({ text = "", images = [], files = [], deliveryState = "queued", lastError = null }) {
  const item = {
    id: nextId(),
    text: String(text || ""),
    images: normalizeAttachments(images, "image"),
    files: normalizeAttachments(files, "file"),
    enqueuedAt: new Date().toISOString(),
    deliveryState: normalizeDelivery(deliveryState),
    lastError: lastError ? String(lastError).slice(0, 500) : null,
  };
  state.queue.push(item);
  return item;
}

function clearDrain() {
  if (state.drainTimer) {
    clearTimeout(state.drainTimer);
    state.drainTimer = null;
  }
}

/** Simulate the server drain loop; only used by control actions. */
function scheduleDrain(mode = "ok", delayMs = 1500) {
  clearDrain();
  state.drainTimer = setTimeout(() => {
    state.drainTimer = null;
    if (state.paused || state.thinking || state.interactionRequired) return;
    const head = state.queue[0];
    if (!head) return;
    head.deliveryState = "sending";
    head.lastError = null;
    setTimeout(() => {
      if (mode === "fail") {
        head.deliveryState = "failed";
        head.lastError = "电脑端连接中断：send failed（QA 故障注入）";
        return;
      }
      // Success: the queued text becomes a real turn in the conversation.
      messages.push({ id: `q-sent-${Date.now()}`, role: "user", content: head.text || "（附件）", createdAt: Date.now() });
      state.queue.shift();
      if (state.queue.length) scheduleDrain(mode, 1500);
    }, 420);
  }, delayMs);
}

function readBody(req, callback) {
  let raw = "";
  req.on("data", (chunk) => { raw += chunk; });
  req.on("end", () => {
    let body = {};
    try { body = JSON.parse(raw || "{}"); } catch { body = {}; }
    callback(body, raw);
  });
}

function control(action, body) {
  switch (action) {
    case "reset":
      clearDrain();
      state.thinking = true;
      state.interactionRequired = false;
      state.turnId = "turn-qa-queue-1";
      state.startedAtMs = Date.now() - 95_000;
      state.queue = [];
      state.paused = false;
      state.failNextEnqueue = false;
      state.failNextSteer = false;
      state.failNextResume = false;
      state.failNextRetry = false;
      state.requests = [];
      messages.splice(0, messages.length,
        { id: "q1", role: "user", content: "继续跑一遍 2.3.0 的视觉检定", createdAt: Date.now() - 95_000 },
        { id: "q2", role: "assistant", content: "正在执行 build 与截图，完成后我会把对比图贴出来。", createdAt: Date.now() - 90_000 },
        { id: "q-img", role: "user", content: "先看一下这张照片", createdAt: Date.now() - 89_000, images: [{ name: "photo-red.jpg", mimeType: "image/jpeg", url: `/api/thread-image?threadId=${encodeURIComponent(THREAD_ID)}&name=photo-red.jpg` }] },
        { id: "q3", role: "tool", kind: "tool_output", title: "shell · 2.1s", content: "$ npm run app:build\nvite v7 building client environment for production...", createdAt: Date.now() - 88_000 },
      );
      return { ok: true };
    case "set": {
      if (typeof body.thinking === "boolean") state.thinking = body.thinking;
      if (typeof body.interactionRequired === "boolean") state.interactionRequired = body.interactionRequired;
      if (typeof body.paused === "boolean") state.paused = body.paused;
      if (body.turnId) state.turnId = String(body.turnId);
      return { ok: true, ...statusPayload() };
    }
    case "seed-queue": {
      clearDrain();
      state.queue = [];
      const items = Array.isArray(body.items) ? body.items : [];
      for (const item of items) enqueue(item);
      return { ok: true, ...statusPayload() };
    }
    case "set-item": {
      const item = state.queue.find((row) => row.id === body.itemId);
      if (!item) return { ok: false, error: "item-not-found" };
      if (body.deliveryState) item.deliveryState = normalizeDelivery(body.deliveryState);
      if (body.lastError !== undefined) item.lastError = body.lastError ? String(body.lastError) : null;
      return { ok: true, ...statusPayload() };
    }
    case "fail-next":
      if (body.what === "enqueue") state.failNextEnqueue = true;
      if (body.what === "steer") state.failNextSteer = true;
      if (body.what === "resume") state.failNextResume = true;
      if (body.what === "retry") state.failNextRetry = true;
      return { ok: true };
    case "finish-turn": {
      clearDrain();
      state.thinking = false;
      state.turnId = "";
      const mode = String(body.drain || "hold");
      if (mode !== "hold") scheduleDrain(mode, Number(body.delayMs) || 300);
      return { ok: true, ...statusPayload() };
    }
    case "start-turn":
      state.thinking = true;
      state.turnId = `turn-${Date.now()}`;
      state.startedAtMs = Date.now();
      return { ok: true };
    default:
      return { ok: false, error: `unknown control action: ${action}` };
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const pathname = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "accept, content-type, x-access-token",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    });
    res.end();
    return;
  }

  if (pathname === "/__qa/state") return json(res, 200, { ...state, drainTimer: undefined, messages });
  if (pathname === "/__qa/requests") return json(res, 200, { requests: state.requests });
  if (pathname === "/__qa/control" && req.method === "POST") {
    return readBody(req, (body) => json(res, 200, control(String(body.action || ""), body)));
  }
  if (pathname === "/__qa/reset" && req.method === "POST") {
    return readBody(req, () => json(res, 200, control("reset", {})));
  }

  state.requests.push({
    at: new Date().toISOString(),
    method: req.method,
    path: pathname,
    query: Object.fromEntries(url.searchParams.entries()),
  });
  const record = state.requests.at(-1);

  if (pathname === "/api/harnesses") {
    return json(res, 200, {
      ok: true, protocol: "codex-turnloom", version: 2,
      machineId: "qa-queue-machine", machineName: "QA 队列工作站",
      defaultHarnessId: "codex", harnesses: [
        { id: "codex", name: "Codex Desktop", token: "qa-codex-token", kind: "codex", online: true, defaultHarness: true },
      ],
    });
  }
  if (pathname === "/api/health") {
    return json(res, 200, {
      ok: true, authRequired: true, version: "2.3.0",
      backend: { kind: "codex", url: "fixture://qa-queue", profile: null },
      allowWrite: true, models, defaultModel: "gpt-5.1-codex", defaultEffort: "high",
    });
  }
  if (pathname === "/api/threads" && req.method === "GET") {
    return json(res, 200, { threads: [threadRow()], total: 1, nextCursor: null });
  }
  const msgMatch = /^\/api\/threads\/([^/]+)\/messages$/.exec(pathname);
  if (msgMatch && req.method === "GET") {
    return json(res, 200, {
      thread: threadRow(),
      messages,
      status: threadStatus(),
      totalMessages: messages.length,
      hasOlderMessages: false,
      olderCursor: null,
    });
  }
  if (msgMatch && req.method === "POST") {
    let body = {};
    try { body = JSON.parse("{}"); } catch { /* ignore */ }
    // Body is parsed below; this branch only serves the App which never posts here.
    return json(res, 405, { error: "use /api/send" });
  }
  const changeMatch = /^\/api\/threads\/([^/]+)\/changes$/.exec(pathname);
  if (changeMatch) return json(res, 200, { changes: [], changed: false });

  if (pathname === "/api/send" && req.method === "POST") {
    return readBody(req, (body) => {
      record.body = { mode: body.mode || "start", text: String(body.message || body.text || "").slice(0, 120), imageCount: (body.images || []).length, fileCount: (body.files || []).length };
      const mode = String(body.mode || "start");
      if (mode === "queue") {
        if (state.failNextEnqueue) {
          state.failNextEnqueue = false;
          return json(res, 500, { error: "电脑端暂时无法写入队列（QA 故障注入）。消息还在输入框里。" });
        }
        if (state.queue.length >= 20) {
          return json(res, 409, { error: "队列已满（20 条）。请等前几条发出或先删除一些再排队。", code: "queue_full" });
        }
        const item = enqueue({ text: body.message || body.text || "", images: body.images || [], files: body.files || [] });
        return json(res, 200, { ok: true, queued: true, threadId: THREAD_ID, queueItem: statusPayload().queuedMessages.at(-1), queueLength: state.queue.length, queuePaused: state.paused, sentAt: item.enqueuedAt, queueSource: "local" });
      }
      if (state.thinking) {
        return json(res, 409, { error: "本轮正在运行，请排队发送。", code: "thread_running" });
      }
      messages.push({ id: `m-${Date.now()}`, role: "user", content: String(body.message || body.text || ""), createdAt: Date.now() });
      return json(res, 200, { ok: true, threadId: THREAD_ID, sentAt: new Date().toISOString() });
    });
  }
  if (pathname === "/api/interrupt" && req.method === "POST") {
    return readBody(req, () => {
      state.thinking = false;
      state.turnId = "";
      if (state.queue.length) state.paused = true;
      return json(res, 200, { ok: true, threadId: THREAD_ID, queueLength: state.queue.length, queuePaused: state.paused });
    });
  }

  if (pathname === "/api/queue/status" && req.method === "GET") {
    return json(res, 200, { ok: true, threadId: url.searchParams.get("threadId") || THREAD_ID, ...statusPayload() });
  }
  if (pathname === "/api/queue/reorder" && req.method === "POST") {
    return readBody(req, (body) => {
      record.body = { itemId: body.itemId, direction: body.direction };
      const index = state.queue.findIndex((item) => item.id === body.itemId);
      if (index < 0) return json(res, 409, { error: "排队消息已发送或已移除，请刷新后查看。" });
      const item = state.queue[index];
      if (["sending", "awaitingConfirmation"].includes(item.deliveryState)) {
        return json(res, 409, { error: "正在发送，暂时不能调整顺序。" });
      }
      const direction = String(body.direction || "");
      const target = direction === "top" ? 0 : direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= state.queue.length || target === index) {
        return json(res, 200, { ok: true, moved: false, ...statusPayload() });
      }
      const [moved] = state.queue.splice(index, 1);
      state.queue.splice(target, 0, moved);
      return json(res, 200, { ok: true, moved: true, itemId: item.id, ...statusPayload() });
    });
  }
  if (pathname === "/api/queue/resume" && req.method === "POST") {
    return readBody(req, () => {
      if (state.failNextResume) {
        state.failNextResume = false;
        return json(res, 500, { error: "恢复队列失败（QA 故障注入）。" });
      }
      state.paused = false;
      return json(res, 200, { ok: true, threadId: THREAD_ID, queuePaused: false, ...statusPayload() });
    });
  }
  if (pathname === "/api/queue/cancel" && req.method === "POST") {
    return readBody(req, (body) => {
      record.body = { itemId: body.itemId, edit: Boolean(body.edit) };
      const index = state.queue.findIndex((item) => item.id === body.itemId);
      if (index < 0) return json(res, 409, { error: "排队消息已发送或已移除，请刷新后查看。" });
      const item = state.queue[index];
      if (["sending", "awaitingConfirmation"].includes(item.deliveryState)) {
        return json(res, 409, { error: "正在发送，暂时不能修改。" });
      }
      state.queue.splice(index, 1);
      return json(res, 200, {
        ok: true, threadId: THREAD_ID, cancelled: 1, cancelledIds: [item.id],
        ...(body.edit === true ? { draft: { text: item.text, images: item.images, files: item.files } } : {}),
        ...statusPayload(),
      });
    });
  }
  if (pathname === "/api/queue/steer" && req.method === "POST") {
    return readBody(req, (body) => {
      record.body = { itemId: body.itemId };
      if (state.failNextSteer) {
        state.failNextSteer = false;
        return json(res, 409, { error: "本轮已结束，消息仍在队列里。", code: "turn_ended" });
      }
      if (!state.thinking) return json(res, 409, { error: "本轮已结束，消息仍在队列里。", code: "turn_ended" });
      const index = state.queue.findIndex((item) => item.id === body.itemId);
      if (index < 0) return json(res, 409, { error: "排队消息已发送或已移除，请刷新后查看。" });
      const item = state.queue[index];
      if (["sending", "awaitingConfirmation"].includes(item.deliveryState)) {
        return json(res, 409, { error: "正在发送，暂时不能转为插入。" });
      }
      state.queue.splice(index, 1);
      messages.push({ id: `steer-${Date.now()}`, role: "user", content: item.text || "（附件）", createdAt: Date.now() });
      return json(res, 200, { ok: true, threadId: THREAD_ID, mode: "steer", ...statusPayload() });
    });
  }
  if (pathname === "/api/queue/retry" && req.method === "POST") {
    return readBody(req, (body) => {
      record.body = { itemId: body.itemId };
      if (state.failNextRetry) {
        state.failNextRetry = false;
        return json(res, 500, { error: "重试失败（QA 故障注入）。" });
      }
      const item = state.queue.find((row) => row.id === body.itemId);
      if (!item) return json(res, 409, { error: "排队消息已发送或已移除，请刷新后查看。" });
      item.deliveryState = "queued";
      item.lastError = null;
      return json(res, 200, { ok: true, threadId: THREAD_ID, itemId: item.id, ...statusPayload() });
    });
  }
  if (pathname === "/api/queue/image" && req.method === "GET") {
    const threadId = url.searchParams.get("threadId") || "";
    const itemId = url.searchParams.get("itemId") || "";
    const index = Number(url.searchParams.get("index") || 0);
    const item = state.queue.find((row) => row.id === itemId);
    const image = item?.images?.[index];
    if (!image) return json(res, 404, { error: "排队图片不存在或已发送。" });
    if (url.searchParams.get("format") === "json") {
      return json(res, 200, { ok: true, mimeType: image.mimeType || "image/png", data: image.data });
    }
    const bytes = Buffer.from(image.data, "base64");
    res.writeHead(200, { "content-type": image.mimeType || "image/png", "content-length": bytes.length, "cache-control": "no-store" });
    res.end(bytes);
    return;
  }
  if (pathname === "/api/thread-image" && req.method === "GET") {
    const name = String(url.searchParams.get("name") || "");
    const bytes = Buffer.from(name.endsWith(".jpg") || name.endsWith(".jpeg") ? JPEG_2PX : PNG_1PX, "base64");
    res.writeHead(200, { "content-type": name.endsWith(".jpg") || name.endsWith(".jpeg") ? "image/jpeg" : "image/png", "content-length": bytes.length, "cache-control": "no-store" });
    res.end(bytes);
    return;
  }
  if (pathname === "/api/projects") {
    return json(res, 200, { projects: [{ id: "codex-turnloom", name: "Codex-Turnloom", path: "D:\\Turn-DSH\\Codex-Turnloom" }] });
  }
  if (pathname === "/api/account") {
    return json(res, 200, { user: { name: "QA", label: "QA 账号" }, plan: { type: "pro", label: "Pro" }, backend: { kind: "codex", url: "fixture://qa-queue" } });
  }
  if (pathname === "/api/app/update" || pathname === "/api/app/update-public") {
    return json(res, 200, { available: false, packageName: "com.codex.turnloom.app", versionCode: 97, versionName: "2.3.0", apkUrl: "", sha256: "", sizeBytes: 0, notes: "" });
  }
  return json(res, 404, { error: `unhandled ${req.method} ${pathname}` });
});

server.listen(PORT, HOST, () => {
  console.log(`[queue-fixture] http://${HOST}:${PORT} · thread ${THREAD_ID}`);
});
