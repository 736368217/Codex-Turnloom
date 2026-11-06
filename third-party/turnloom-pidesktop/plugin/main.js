"use strict";
/**
 * Turnloom 桥（PI-Desktop + Codex 合体版）
 *
 * 目标：**一个 Turnloom 进程同时服务两个软件**。
 *
 *  1) 数据：把 PI-Desktop（pi.sqlite）与 Codex Desktop（~/.codex）两边的会话
 *     合并写进同一份"门面目录"（Codex 本地格式），Turnloom 照旧只读这一个 home。
 *  2) 动作：在 \\.\pipe\pidesktop-codex-ipc 上扮演 Codex Desktop；
 *     - PI-Desktop 会话 → 宿主的 agent/prompt / agent/abort
 *     - Codex 会话     → 原样代理回真正的 \\.\pipe\codex-ipc
 *  3) 托管：8799 没在监听就拉起 Turnloom；异常退出自动重启。
 *
 * 只读两份数据库；写操作只走宿主 API 或 Codex 自带 IPC。
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const codexSide = require("./codex-side.cjs");

/**
 * PI-Desktop 的数据根目录可以被用户改（%APPDATA%\PI-Desktop\storage-location.json 指向别处），
 * 所以不能把 ~/.pi-desktop/pi.sqlite 写死：配置优先，再按两个已知位置兜底。
 */
function piStorageBases() {
  const bases = [];
  const push = (value) => {
    const v = String(value || "").trim();
    if (v && !bases.includes(v)) bases.push(v);
  };
  push(process.env.APPDATA);
  if (process.platform === "win32") push(path.join(os.homedir(), "AppData", "Roaming"));
  if (process.platform === "darwin") push(path.join(os.homedir(), "Library", "Application Support"));
  push(path.join(os.homedir(), ".config"));
  return bases;
}

/**
 * 宿主进程里 process.env.APPDATA 可能为空（Electron 子进程实测会丢），
 * 所以除了环境变量还要按各平台标准位置找 storage-location.json。
 * 只认 roots.data，找不到就返回空数组。
 */
function piConfiguredDataRoots() {
  const roots = [];
  for (const base of piStorageBases()) {
    for (const name of ["PI-Desktop", "pi-desktop"]) {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(base, name, "storage-location.json"), "utf8"));
        const data = parsed?.roots?.data;
        if (data && !roots.includes(String(data))) roots.push(String(data));
      } catch {
        /* 该位置没有配置 */
      }
    }
  }
  return roots;
}

/**
 * 解析 PI 数据库。
 *
 * 2026-11-05 事故：宿主进程拿不到 APPDATA → 回落到 ~/.pi-desktop/pi.sqlite，
 * 而那个路径是被 DatabaseSync 顺手创建出来的 0 字节空库，于是所有「表不存在」，
 * 手机端审批/待办/通知全空。现在：
 *   1. 按多平台标准位置读配置；
 *   2. 只接受「存在且非空」的数据库，绝不把空库当权威；
 *   3. 配置失效时用已知默认位置兜底。
 */
function resolvePiDb() {
  const configured = piConfiguredDataRoots().map((root) => path.join(root, "pi.sqlite"));
  const known = ["数据目录\\data\\pi.sqlite", path.join(os.homedir(), ".pi-desktop", "pi.sqlite")];
  const all = [...configured, ...known];
  const usable = all.find((file) => {
    try {
      return fs.existsSync(file) && fs.statSync(file).size > 0;
    } catch {
      return false;
    }
  });
  return usable || configured[0] || known[0];
}

function resolvePiDataRoot() {
  const configured = piConfiguredDataRoots();
  if (configured.length) return configured[0];
  // 不要直接读 PI_DB 变量（模块求值时它还在 TDZ，曾导致整个插件加载失败）；
  // 调用解析函数拿到最终数据库所在目录，保证与 PI_DB 一致。
  return path.dirname(resolvePiDb());
}

function nativeQueueDb() {
  // 绝不创建空库：DatabaseSync 默认会新建文件，一旦路径解析错就会留下
  // 0 字节 pi.sqlite，后续所有查询都变成 "no such table"。
  let size = 0;
  try {
    size = fs.statSync(PI_DB).size;
  } catch {
    /* 下面统一报错 */
  }
  if (!size) {
    throw new Error(`PI database is missing or empty: ${PI_DB}`);
  }
  const db = new DatabaseSync(PI_DB);
  db.exec("PRAGMA busy_timeout = 8000");
  return db;
}
const PI_DATA_ROOT = resolvePiDataRoot();

/** 把 data URL / 裸 base64 落成宿主可解析的附件文件，返回 {path,name}。 */
function stageAttachmentFile(sessionId, image) {
  const dir = path.join(PI_DATA_ROOT, "scratch", String(sessionId));
  fs.mkdirSync(dir, { recursive: true });
  const ext = /^image\/(png|jpe?g|webp|gif|bmp|heic)$/i.exec(image.mimeType || "");
  const suffix = ext ? ext[1].toLowerCase().replace("jpeg", "jpg") : "png";
  const name = `turnloom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${suffix}`;
  const target = path.join(dir, name);
  fs.writeFileSync(target, Buffer.from(image.data, "base64"));
  return { path: target, name };
}
const PI_DB = resolvePiDb();
const SHIM_HOME = path.join(os.homedir(), ".pidesktop-turnloom");
const SESSIONS_DIR = path.join(SHIM_HOME, "sessions");

const crypto = require("node:crypto");

/**
 * 手机端与桌面端必须看见同一份排队消息。
 *
 * PI-Desktop 的权威队列是 pi.sqlite 的 turn_queue；宿主按
 * priority → position → created_at 决定执行顺序。桥把手机端的排队动作
 * 直接写进这张表，Turnloom 不再维护自己的 pending-queues.json 影子队列。
 */
const TURNLOOM_QUEUE_PRINCIPAL = "turnloom-mobile";
const MAX_NATIVE_QUEUE_ITEMS = 50;
const nativeQueueLocks = new Map();

function nativeQueueSessionId(params) {
  const value = String(params?.sessionId || params?.threadId || params?.conversationId || "").trim();
  if (!value) throw new Error("queue request without sessionId");
  return value;
}

function nativeQueueText(params) {
  const text = String(params?.content ?? params?.text ?? "").trim();
  if (!text) throw new Error("queue item has no content");
  if (text.length > 12000) throw new Error("queue item is too long");
  return text;
}

function nativeQueueAttachments(params, sessionId) {
  const raw = Array.isArray(params?.images) ? params.images : Array.isArray(params?.input) ? params.input : [];
  const input = raw.map((image) => image && typeof image === "object" && image.data
    ? { type: "image", data: String(image.data), mimeType: String(image.mimeType || ""), name: String(image.name || "") }
    : image);
  return attachmentsFromTurnInput(input, sessionId);
}

/** PI 宿主的真实执行顺序：优先项（小 priority）在前，其余按 position/created_at。 */
function orderNativeQueueRows(rows) {
  return [...rows].sort((a, b) => {
    const left = a.priority == null ? null : Number(a.priority);
    const right = b.priority == null ? null : Number(b.priority);
    if (left != null && right == null) return -1;
    if (left == null && right != null) return 1;
    if (left != null && right != null && left !== right) return left - right;
    return (Number(a.position) || 0) - (Number(b.position) || 0)
      || (Number(a.created_at) || 0) - (Number(b.created_at) || 0)
      || String(a.id).localeCompare(String(b.id));
  });
}

function nativeQueueRows(sessionId = "", db = null) {
  const ownsDb = !db;
  const database = db || nativeQueueDb();
  try {
    const sql = `SELECT id, session_id, principal, idempotency_key, input_hash, content,
        attachments_json, permission_mode, position, priority, created_at
      FROM turn_queue ${sessionId ? "WHERE session_id = ?" : ""}`;
    const rows = sessionId ? database.prepare(sql).all(sessionId) : database.prepare(sql).all();
    return orderNativeQueueRows(rows);
  } finally {
    if (ownsDb) database.close();
  }
}

function nativeQueueEntry(row, index = 0) {
  let attachments = [];
  try {
    const parsed = JSON.parse(row.attachments_json || "[]");
    if (Array.isArray(parsed)) attachments = parsed;
  } catch {
    attachments = [];
  }
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    content: String(row.content || ""),
    attachments,
    position: index + 1,
    ...(row.priority == null ? {} : { priority: Number(row.priority) }),
    createdAt: new Date(Number(row.created_at) || Date.now()).toISOString(),
    source: "pi-native"
  };
}

function serializedNativeQueue(rows, sessionId = "") {
  return orderNativeQueueRows(rows).map((row, index) => nativeQueueEntry(row, index));
}

function withNativeQueueLock(key, execute) {
  const previous = nativeQueueLocks.get(key) || Promise.resolve();
  const operation = previous.catch(() => {}).then(execute);
  nativeQueueLocks.set(key, operation);
  operation.finally(() => {
    if (nativeQueueLocks.get(key) === operation) nativeQueueLocks.delete(key);
  }).catch(() => {});
  return operation;
}

/** 写 pi.sqlite 时用 BEGIN IMMEDIATE 把「读位置 → 写行」变成一个原子事务。 */
function nativeQueueWrite(execute) {
  const db = nativeQueueDb();
  try {
    db.exec("BEGIN IMMEDIATE");
    const result = execute(db);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally {
    db.close();
  }
}

async function nativeQueuePush(params) {
  const sessionId = nativeQueueSessionId(params);
  const content = nativeQueueText(params);
  const idempotencyKey = String(params?.clientRequestId || params?.idempotencyKey || "").trim() || crypto.randomUUID();
  return withNativeQueueLock(sessionId, () => nativeQueueWrite((db) => {
    const existing = db.prepare(
      "SELECT * FROM turn_queue WHERE session_id = ? AND principal = ? AND idempotency_key = ?"
    ).get(sessionId, TURNLOOM_QUEUE_PRINCIPAL, idempotencyKey);
    if (existing) return { ok: true, duplicate: true, ...nativeQueueEntry(existing) };
    const exists = db.prepare("SELECT EXISTS(SELECT 1 FROM sessions WHERE id = ? AND deleted_at IS NULL) AS yes").get(sessionId);
    if (!Number(exists?.yes)) throw new Error(`session not found: ${sessionId}`);
    const count = db.prepare("SELECT COUNT(*) AS count, COALESCE(MAX(position), 0) AS position FROM turn_queue WHERE session_id = ?").get(sessionId);
    if (Number(count?.count) >= MAX_NATIVE_QUEUE_ITEMS) throw new Error("QUEUE_FULL");
    const attachments = nativeQueueAttachments(params, sessionId);
    const inputHash = crypto.createHash("sha256").update(JSON.stringify({
      content,
      attachments,
      sessionId,
      model: String(params?.model || ""),
      effort: String(params?.effort || "")
    })).digest("hex");
    const id = crypto.randomUUID();
    const position = Number(count?.position || 0) + 1;
    const createdAt = Date.now();
    db.prepare(`INSERT INTO turn_queue (
        id, session_id, principal, idempotency_key, input_hash, content,
        attachments_json, permission_mode, position, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, sessionId, TURNLOOM_QUEUE_PRINCIPAL, idempotencyKey, inputHash,
      content, JSON.stringify(attachments), "inherit", position, createdAt
    );
    return {
      ok: true,
      duplicate: false,
      id,
      sessionId,
      content,
      position,
      createdAt: new Date(createdAt).toISOString(),
      source: "pi-native"
    };
  }));
}

function nativeQueueList(params) {
  const sessionId = String(params?.sessionId || params?.threadId || params?.conversationId || "").trim();
  return {
    ok: true,
    entries: serializedNativeQueue(nativeQueueRows(sessionId), sessionId),
    source: "pi-native"
  };
}

function nativeQueueRemove(params) {
  const sessionId = nativeQueueSessionId(params);
  const itemId = String(params?.itemId || params?.id || "").trim();
  const wantsDraft = Boolean(params?.edit);
  return withNativeQueueLock(sessionId, () => {
    const result = nativeQueueWrite((db) => {
      const rows = nativeQueueRows(sessionId, db);
      const selected = itemId ? rows.filter((row) => String(row.id) === itemId) : rows;
      if (selected.length) {
        const ids = selected.map((row) => String(row.id));
        const placeholders = ids.map(() => "?").join(",");
        db.prepare(`DELETE FROM turn_queue WHERE session_id = ? AND id IN (${placeholders})`).run(sessionId, ...ids);
      }
      const draft = wantsDraft && selected[0]
        ? {
            text: String(selected[0].content),
            images: nativeQueueEntry(selected[0]).attachments.map((attachment) => ({
              name: String(attachment.name || ""),
              mimeType: String(attachment.mimeType || "image/png"),
              data: attachment.path && fs.existsSync(attachment.path)
                ? fs.readFileSync(attachment.path).toString("base64")
                : "",
              path: String(attachment.path || "")
            }))
          }
        : null;
      return {
        selected,
        draft,
        entries: serializedNativeQueue(nativeQueueRows(sessionId, db), sessionId)
      };
    });
    return {
      ok: true,
      cancelled: result.selected.length,
      cancelledIds: result.selected.map((row) => String(row.id)),
      ...(result.draft ? { draft: result.draft } : {}),
      entries: result.entries,
      source: "pi-native"
    };
  });
}

function nativeQueueSteer(params) {
  const sessionId = nativeQueueSessionId(params);
  const itemId = String(params?.itemId || params?.id || "").trim();
  if (!itemId) throw new Error("queue steer without itemId");
  return withNativeQueueLock(sessionId, () => {
    const result = nativeQueueWrite((db) => {
      const rows = nativeQueueRows(sessionId, db);
      const row = rows.find((entry) => String(entry.id) === itemId);
      if (!row) throw new Error("queue item not found");
      // PI 的 priority 小值先执行；把现有优先项整体后移一格，再把选中项置为 1。
      db.prepare("UPDATE turn_queue SET priority = priority + 1 WHERE session_id = ? AND priority IS NOT NULL").run(sessionId);
      db.prepare("UPDATE turn_queue SET priority = 1 WHERE session_id = ? AND id = ?").run(sessionId, itemId);
      return {
        text: String(row.content || ""),
        entries: serializedNativeQueue(nativeQueueRows(sessionId, db), sessionId)
      };
    });
    return {
      ok: true,
      mode: "priority",
      turnId: null,
      itemId,
      text: result.text,
      entries: result.entries,
      source: "pi-native"
    };
  });
}

/**
 * 软删除（从列表移除）。
 *
 * 为什么不用宿主的 `session/delete`：它在 CONTROL_OPERATION_SPECS 里是
 * dangerous，插件一调用就会在**桌面**弹原生确认框——用户不在电脑前就删不掉，
 * 这违背「手机端能独立管理会话」的设计目标。
 *
 * 软删除只写 `sessions.deleted_at`（PI 自己的删除语义），数据与 rollout 都保留，
 * 可以 restore；宿主列表与我们门面都过滤 deleted_at，所以立刻消失。真正不可逆的
 * 彻底删除仍然走宿主 `session/delete`（桌面确认），作为次要入口保留。
 */
function sessionHide(params) {
  const id = String(params?.sessionId || params?.threadId || "").trim();
  if (!id) throw new Error("hide without sessionId");
  const db = piWriteDb();
  try {
    const now = Date.now();
    const result = db
      .prepare("UPDATE sessions SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
      .run(now, now, id);
    return { ok: true, sessionId: id, hidden: Number(result.changes) > 0 };
  } finally {
    db.close();
  }
}

function sessionRestore(params) {
  const id = String(params?.sessionId || params?.threadId || "").trim();
  if (!id) throw new Error("restore without sessionId");
  const db = piWriteDb();
  try {
    const result = db
      .prepare("UPDATE sessions SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL")
      .run(Date.now(), id);
    return { ok: true, sessionId: id, restored: Number(result.changes) > 0 };
  } finally {
    db.close();
  }
}

/** 已移除（软删除）的会话，供手机端撤销。 */
function sessionHidden() {
  const db = piWriteDb();
  try {
    const rows = db
      .prepare("SELECT id, title, deleted_at FROM sessions WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 50")
      .all();
    return {
      ok: true,
      sessions: rows.map((row) => ({
        id: String(row.id || ""),
        title: String(row.title || ""),
        deletedAt: Number(row.deleted_at) || 0,
      })),
    };
  } finally {
    db.close();
  }
}

/** 可写数据库句柄（与队列共用同一套「拒绝空库」保护）。 */
function piWriteDb() {
  return nativeQueueDb();
}

// ── 宿主能力层：把 PI 的只读能力与显式确认的写能力开放给手机 ──────────────
/**
 * 白名单是安全边界：手机端只能调用这里列出的操作。
 *   read      —— 只读，直接放行；
 *   write     —— 会改状态但不危险（重命名、压缩、标记已读）；
 *   dangerous —— 宿主会弹原生确认框，必须由手机用户明确点「确认」后才带
 *                confirm:true 下发，绝不由桥自动确认。
 */
const HOST_READ_OPERATIONS = new Set([
  "app/getVersion", "app/health", "app/getOnboarding", "app/systemFonts",
  "providers/list", "providers/listModels", "providers/modelCatalogStatus",
  "project/get", "project/list", "settings/get", "commandShell/list",
  "session/list", "session/get", "session/getScratchPath", "session/listRevisions",
  "stats/getTokenUsageHistory", "notification/list",
  "scheduled/list", "scheduled/listRuns",
  "fs/list", "fs/read", "fs/readImageDataUrl", "fs/index",
  "workspace/diff", "browser/getState",
  "composer/commands", "commandPalette/search", "skill/list", "skill/read",
  "subagent/list", "subagent/catalog", "subagent/read",
  "mcp/list", "plugin/list", "plugin/views", "plugin/themes", "plugin/services",
  "plans/pending", "market/search", "market/getDetail",
  "updates/getState", "network/testProxy",
]);
const HOST_WRITE_OPERATIONS = new Set([
  "session/rename", "session/open", "session/moveProject",
  "agent/compact", "agent/abort", "agent/stop",
  "providers/refreshModelCatalog", "updates/check",
  "notification/markRead", "notification/markAllRead",
  "session/create", "session/fork",
]);
const HOST_DANGEROUS_OPERATIONS = new Set([
  "session/delete", "session/configure", "plans/resolve",
  "tool/resolvePermission", "agent/askTool/resolve",
  "agent/instructions/save", "extensions/ui/respond",
]);

async function hostInvoke(params) {
  const operation = String(params?.operation || "").trim();
  // 兼容标量 args：有的客户端（含 PowerShell 5.1 的 ConvertTo-Json）会把
  // 单元素数组序列化成裸值，直接丢给宿主就会变成 "reading 'startsWith'" 报错。
  const rawArgs = params?.args;
  const args = Array.isArray(rawArgs) ? rawArgs : rawArgs === undefined ? [] : [rawArgs];
  const confirm = params?.confirm === true;
  if (!operation) throw new Error("host invoke without operation");
  const isRead = HOST_READ_OPERATIONS.has(operation);
  const isWrite = HOST_WRITE_OPERATIONS.has(operation);
  const isDangerous = HOST_DANGEROUS_OPERATIONS.has(operation);
  if (!isRead && !isWrite && !isDangerous) {
    throw new Error(`host operation not allowed from phone: ${operation}`);
  }
  if (isDangerous && !confirm) {
    throw new Error(`host operation requires explicit confirmation: ${operation}`);
  }
  const result = await invokeHostArgs(operation, args, isDangerous ? { confirm: true } : {});
  return { ok: true, operation, result };
}

/** 审批：PI 把 Plan/Goal 审批持久化在 plan_approvals，手机端据此渲染审批卡。 */
function hostApprovals(params) {
  const sessionId = String(params?.sessionId || params?.threadId || "").trim();
  const db = nativeQueueDb();
  try {
    const where = sessionId ? "WHERE session_id = ?" : "";
    const rows = db
      .prepare(
        `SELECT request_id, session_id, turn_id, tool_call_id, kind, title, question, status,
                action, target_permission_mode, feedback, created_at, updated_at, expires_at,
                resolved_at, error_code, version
           FROM plan_approvals ${where} ORDER BY created_at DESC LIMIT 50`,
      )
      .all(...(sessionId ? [sessionId] : []));
    return {
      ok: true,
      approvals: rows.map((row) => ({
        requestId: String(row.request_id || ""),
        sessionId: String(row.session_id || ""),
        turnId: String(row.turn_id || ""),
        toolCallId: String(row.tool_call_id || ""),
        kind: String(row.kind || "plan"),
        title: String(row.title || ""),
        question: String(row.question || ""),
        status: String(row.status || ""),
        action: String(row.action || ""),
        targetPermissionMode: String(row.target_permission_mode || ""),
        feedback: String(row.feedback || ""),
        version: Number(row.version) || 1,
        createdAt: Number(row.created_at) || 0,
        updatedAt: Number(row.updated_at) || 0,
        expiresAt: Number(row.expires_at) || 0,
        resolvedAt: Number(row.resolved_at) || 0,
        errorCode: String(row.error_code || ""),
      })),
    };
  } finally {
    db.close();
  }
}

/**
 * 审批决定。宿主契约：
 *   plans/resolve              需要 proposalId/sessionId/turnId/toolCallId/action；
 *                              approve 还必须给 targetPermissionMode(ask|accept-edits|auto)。
 *   tool/resolvePermission     需要 requestId + decision(allow-once|allow-session|deny)。
 *   agent/askTool/resolve      需要 sessionId + requestId + 回答内容。
 * 三类都是 dangerous，必须带 confirm:true，且宿主仍会弹原生确认框。
 */
async function hostApprovalsResolve(params) {
  const kind = String(params?.kind || "plan").toLowerCase();
  const confirm = params?.confirm === true;
  if (!confirm) throw new Error("approval requires explicit confirmation on the phone");
  if (kind === "permission") {
    const requestId = String(params?.requestId || "").trim();
    const decision = String(params?.decision || "").trim();
    if (!requestId || !["allow-once", "allow-session", "deny"].includes(decision)) {
      throw new Error("permission resolution needs requestId and decision");
    }
    const result = await invokeHostArgs("tool/resolvePermission", [{ requestId, decision }], { confirm: true });
    return { ok: true, kind, result };
  }
  if (kind === "ask") {
    const sessionId = String(params?.sessionId || "").trim();
    const requestId = String(params?.requestId || "").trim();
    if (!sessionId || !requestId) throw new Error("ask resolution needs sessionId and requestId");
    const result = await invokeHostArgs(
      "agent/askTool/resolve",
      [{ sessionId, requestId, answers: params?.answers ?? null, answer: params?.answer ?? null, action: params?.action ?? null }],
      { confirm: true },
    );
    return { ok: true, kind, result };
  }
  const action = String(params?.action || "").trim();
  if (action !== "approve" && action !== "reject") throw new Error("plan resolution needs approve or reject");
  const targetPermissionMode = String(params?.targetPermissionMode || "ask").trim();
  const payload = {
    proposalId: String(params?.requestId || params?.proposalId || "").trim(),
    sessionId: String(params?.sessionId || "").trim(),
    turnId: String(params?.turnId || "").trim(),
    toolCallId: String(params?.toolCallId || "").trim(),
    action,
    ...(action === "approve" ? { targetPermissionMode } : {}),
    ...(Number.isFinite(Number(params?.version)) && Number(params.version) > 0 ? { version: Number(params.version) } : {}),
  };
  if (!payload.proposalId || !payload.sessionId || !payload.turnId || !payload.toolCallId) {
    throw new Error("plan resolution needs requestId, sessionId, turnId and toolCallId");
  }
  const result = await invokeHostArgs("plans/resolve", [payload], { confirm: true });
  return { ok: true, kind: "plan", result };
}

function hostTodos(params) {
  const sessionId = String(params?.sessionId || params?.threadId || "").trim();
  if (!sessionId) return { ok: true, todos: [] };
  const db = nativeQueueDb();
  try {
    const rows = db
      .prepare(
        `SELECT position, content, status, priority, updated_at
           FROM session_todo WHERE session_id = ? ORDER BY position ASC`,
      )
      .all(sessionId);
    return {
      ok: true,
      todos: rows.map((row) => ({
        position: Number(row.position) || 0,
        content: String(row.content || ""),
        status: String(row.status || "pending"),
        priority: String(row.priority || ""),
        updatedAt: Number(row.updated_at) || 0,
      })),
    };
  } finally {
    db.close();
  }
}

function hostNotifications(params) {
  const limit = Math.min(Math.max(Number(params?.limit) || 30, 1), 100);
  const db = nativeQueueDb();
  try {
    const rows = db
      .prepare(
        `SELECT id, kind, session_id, session_title, turn_id, error_code, created_at, read_at
           FROM notifications ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit);
    const unread = db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL").get();
    return {
      ok: true,
      unread: Number(unread?.n) || 0,
      notifications: rows.map((row) => ({
        id: String(row.id || ""),
        kind: String(row.kind || ""),
        sessionId: String(row.session_id || ""),
        sessionTitle: String(row.session_title || ""),
        turnId: String(row.turn_id || ""),
        errorCode: String(row.error_code || ""),
        createdAt: Number(row.created_at) || 0,
        read: Boolean(row.read_at),
      })),
    };
  } finally {
    db.close();
  }
}

function hostNotificationsRead(params) {
  const id = String(params?.id || "").trim();
  const db = nativeQueueDb();
  try {
    const now = Date.now();
    if (id) db.prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL").run(now, id);
    else db.prepare("UPDATE notifications SET read_at = ? WHERE read_at IS NULL").run(now);
    return { ok: true };
  } finally {
    db.close();
  }
}

function hostScheduled(params) {
  const db = nativeQueueDb();
  try {
    const rows = db
      .prepare(
        `SELECT id, title, prompt, cadence, enabled, project_id, last_run_at, created_at, updated_at
           FROM scheduled_tasks ORDER BY created_at DESC LIMIT 50`,
      )
      .all();
    return {
      ok: true,
      tasks: rows.map((row) => ({
        id: String(row.id || ""),
        title: String(row.title || ""),
        prompt: String(row.prompt || ""),
        cadence: String(row.cadence || ""),
        enabled: Boolean(row.enabled),
        projectId: row.project_id == null ? null : String(row.project_id),
        lastRunAt: Number(row.last_run_at) || 0,
        createdAt: Number(row.created_at) || 0,
        updatedAt: Number(row.updated_at) || 0,
      })),
    };
  } finally {
    db.close();
  }
}

/** 用量：按会话聚合 turns，手机端能看到真实 token 与最近几轮。 */
function hostUsage(params) {
  const sessionId = String(params?.sessionId || params?.threadId || "").trim();
  if (!sessionId) return { ok: true, totals: null, turns: [] };
  const db = nativeQueueDb();
  try {
    const totals = db
      .prepare(
        `SELECT COUNT(*) AS turns, COALESCE(SUM(input_tokens),0) AS input_tokens,
                COALESCE(SUM(output_tokens),0) AS output_tokens, MAX(ended_at) AS last_at
           FROM turns WHERE session_id = ? AND status = 'completed'`,
      )
      .get(sessionId);
    const rows = db
      .prepare(
        `SELECT id, status, provider_id, model_id, input_tokens, output_tokens, error_code,
                started_at, ended_at
           FROM turns WHERE session_id = ? ORDER BY started_at DESC LIMIT 20`,
      )
      .all(sessionId);
    return {
      ok: true,
      totals: {
        turns: Number(totals?.turns) || 0,
        inputTokens: Number(totals?.input_tokens) || 0,
        outputTokens: Number(totals?.output_tokens) || 0,
        lastAt: Number(totals?.last_at) || 0,
      },
      turns: rows.map((row) => ({
        id: String(row.id || ""),
        status: String(row.status || ""),
        providerId: String(row.provider_id || ""),
        modelId: String(row.model_id || ""),
        inputTokens: Number(row.input_tokens) || 0,
        outputTokens: Number(row.output_tokens) || 0,
        errorCode: String(row.error_code || ""),
        startedAt: Number(row.started_at) || 0,
        endedAt: Number(row.ended_at) || 0,
      })),
    };
  } finally {
    db.close();
  }
}
const STATE_DB = path.join(SHIM_HOME, "state_5.sqlite");
const SESSION_INDEX = path.join(SHIM_HOME, "session_index.jsonl");
const AUTH_FILE = path.join(SHIM_HOME, "auth.json");

const PIPE_PATH = "\\\\.\\pipe\\pidesktop-codex-ipc";
const TURNLOOM_DIR = "项目目录\\11\\Codex-Turnloom";
const TURNLOOM_PORT = 8799;
const TURNLOOM_PASSWORD = "example-code";
const TURNLOOM_LOG = path.join(__dirname, "turnloom-8799.log");
const TURNLOOM_ERR = path.join(__dirname, "turnloom-8799.err.log");
const NODE_BIN = process.platform === "win32" ? "node.exe" : "node";
const SYNC_INTERVAL_MS = 3000;
/** 门面是否也镜像 Codex 会话。默认关闭：Codex 已有独立设备，混在一起两个列表会重复。 */
const MIRROR_CODEX = process.env.TURNLOOM_MIRROR_CODEX === "1";


/** 增量同步状态：全局签名、每个会话的变更标记、已写出的 rollout 路径、错误日志节流。 */
let lastSignature = "";
const sessionMarks = new Map();
const rolloutFiles = new Map();
let lastErrorLogAt = 0;
let syncTimer = null;
let pipeServer = null;
let turnloomChild = null;
let turnloomTimer = null;
let unloading = false;
let syncBusy = false;
/** Codex 侧会话 id，用于把动作代理回 Codex IPC。 */
const codexThreadIds = new Set();
/**
 * 模型下发状态。宿主只认 (providerId, modelId) 这对 id：
 *   - modelIndex 把三种客户端写法解析回 id 对；
 *   - sessionModels 记每个会话当前生效的模型，用来判断「要不要真的切换」；
 *   - configureApplied/configureFailed 防止同一次切换反复弹宿主确认框。
 */
let modelIndex = { bySlug: new Map(), byPair: new Map(), byModelId: new Map() };
const sessionModels = new Map();
const configureApplied = new Set();
const configureFailed = new Set();

function log(...parts) {
  console.log("[turnloom-bridge]", ...parts);
}

// ── 门面数据 ─────────────────────────────────────────────────────────────
function iso(ms) {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : new Date().toISOString();
}

function rolloutFileName(sessionId, startedMs) {
  const stamp = iso(startedMs).replace(/[:.]/g, "-");
  return `rollout-${stamp}-${sessionId}.jsonl`;
}

function readPiSessions() {
  const db = new DatabaseSync(PI_DB, { readOnly: true });
  try {
    return {
      sessions: db
        .prepare(
          `SELECT id, title, project_id, created_at, updated_at, last_seq, pinned, model_id, provider_id,
                  (SELECT COUNT(*) FROM turns t WHERE t.session_id = sessions.id AND t.status = 'running') AS running_turns
             FROM sessions WHERE deleted_at IS NULL ORDER BY updated_at DESC`,
        )
        .all(),
      projects: db.prepare("SELECT id, path, name FROM projects").all(),
      // 正在跑的轮次：写进门面的 status_* 列，手机端才能看到“运行中”。
      runningTurns: db
        .prepare("SELECT session_id, id, started_at FROM turns WHERE status = 'running'")
        .all(),
      // PI 的供应商 × 模型：生成 Codex 兼容的模型目录，手机端才能按 PI 的配置选模型。
      models: db
        .prepare(
          `SELECT p.id AS provider_id, p.name AS provider_name, p.enabled AS provider_enabled,
                  p.default_model_id AS provider_default_model_id,
                  m.model_id AS model_id, m.display_name AS display_name,
                  m.capabilities_json AS capabilities_json,
                  p.config_json AS provider_config_json
             FROM models m INNER JOIN providers p ON p.id = m.provider_id
            ORDER BY p.name ASC, m.model_id ASC`,
        )
        .all(),
    };
  } finally {
    db.close();
  }
}

/** 只取"变过的"会话的消息与轮次；不再每轮把十万行消息整表读一遍。 */
function readPiDetails(sessionIds) {
  const db = new DatabaseSync(PI_DB, { readOnly: true });
  try {
    const marks = sessionIds.map(() => "?").join(",");
    return {
      messages: db
        .prepare(
          `SELECT session_id, turn_id, seq, role, tool_name, is_error, text, created_at
             FROM messages WHERE session_id IN (${marks}) ORDER BY session_id, created_at, seq`,
        )
        .all(...sessionIds),
      turns: db
        .prepare(`SELECT id, session_id, status, started_at, ended_at FROM turns WHERE session_id IN (${marks})`)
        .all(...sessionIds),
    };
  } finally {
    db.close();
  }
}

function buildRollout(session, messages, turns, queuedTurns = []) {
  const lines = [];
  const push = (obj) => lines.push(JSON.stringify(obj));
  const startedAt = Number(session.created_at) || Date.now();

  push({
    timestamp: iso(startedAt),
    type: "session_meta",
    payload: {
      id: session.id,
      timestamp: iso(startedAt),
      cwd: session.cwd || "",
      originator: "pidesktop",
      cli_version: "0.0.0",
      instructions: null,
    },
  });

  const turnById = new Map();
  for (const t of turns) if (t.session_id === session.id) turnById.set(String(t.id), t);

  let currentTurnId = null;
  let turnOpen = false;

  const closeTurn = (turnId, atMs) => {
    if (!turnOpen) return;
    const turn = turnId ? turnById.get(String(turnId)) : null;
    const startedMs = Number(turn?.started_at) || atMs;
    push({
      timestamp: iso(atMs),
      type: "event_msg",
      payload: {
        type: "task_complete",
        turn_id: turnId || null,
        duration_ms: Math.max(0, atMs - startedMs),
        completed_at: Math.round(atMs / 1000),
      },
    });
    turnOpen = false;
    currentTurnId = null;
  };

  const openTurn = (turnId, atMs) => {
    if (turnOpen && currentTurnId === turnId) return;
    if (turnOpen) closeTurn(currentTurnId, atMs);
    currentTurnId = turnId;
    turnOpen = true;
    push({
      timestamp: iso(atMs),
      type: "event_msg",
      payload: { type: "task_started", turn_id: turnId, started_at: Math.round(atMs / 1000) },
    });
  };

  let toolSeq = 0;
  for (const msg of messages) {
    const at = Number(msg.created_at) || startedAt;
    const turnId = msg.turn_id ? String(msg.turn_id) : "turn-local";
    openTurn(turnId, at);
    const text = String(msg.text ?? "");
    if (msg.role === "user") {
      if (text.trim()) {
        push({ timestamp: iso(at), type: "event_msg", payload: { type: "user_message", message: text } });
      }
    } else if (msg.role === "assistant") {
      if (text.trim()) {
        push({ timestamp: iso(at), type: "event_msg", payload: { type: "agent_message", message: text } });
      }
    } else if (msg.role === "tool" || msg.tool_name) {
      toolSeq += 1;
      const callId = `call_${session.id.slice(0, 8)}_${toolSeq}`;
      push({
        timestamp: iso(at),
        type: "response_item",
        payload: { type: "function_call", name: String(msg.tool_name || "tool"), arguments: "", call_id: callId },
      });
      if (text.trim() || msg.is_error) {
        push({
          timestamp: iso(at),
          type: "response_item",
          payload: { type: "function_call_output", call_id: callId, output: msg.is_error ? `error: ${text}` : text },
        });
      }
    }
  }
  // 把权威 turn_queue 以只读标记写进门面 rollout，桌面端与手机端都能看到
  // 同一份队列；user_message 类型会让 Turnloom 把它渲染成待发送消息。
  for (const queued of queuedTurns) {
    if (String(queued.session_id) !== String(session.id)) continue;
    push({
      timestamp: iso(Number(queued.created_at) || startedAt),
      type: "event_msg",
      payload: {
        type: "user_message",
        message: String(queued.content || ""),
        source: "turn_queue",
        queue_item_id: String(queued.id || ""),
        queue_position: Number(queued.position) || 0,
        ...(queued.priority == null ? {} : { queue_priority: Number(queued.priority) })
      }
    });
  }
  // 只有"确定已结束"的轮次才收尾。仍在 running 的轮次要保持未闭合，
  // 否则 Turnloom 会把每个会话都判成 ended——手机端就永远看不到"正在运行"。
  const lastTurn = currentTurnId ? turnById.get(String(currentTurnId)) : null;
  const stillRunning = Boolean(lastTurn && String(lastTurn.status) === "running" && !lastTurn.ended_at);
  if (turnOpen && !stillRunning) {
    closeTurn(currentTurnId, Math.max(Number(session.updated_at) || Date.now(), startedAt));
  }
  return `${lines.join("\n")}\n`;
}

function writeStateDb(piSessions, piProjects, piRollouts, codexThreads, codexRollouts, piRunningTurns = [], piModels = []) {
  // 就地更新 state_5.sqlite：Turnloom 一直持有这个文件，Windows 上“删旧库 + 改临时库名”必然
  // EPERM（历史上 3,666 条 sync failed 就来自这里）。改用事务内的整表替换，文件身份不变。
  const db = new DatabaseSync(STATE_DB);
  db.exec("PRAGMA busy_timeout = 8000");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY, title TEXT, rollout_path TEXT,
        created_at_ms INTEGER, updated_at_ms INTEGER, updated_at TEXT,
        archived INTEGER DEFAULT 0, preview TEXT, cwd TEXT, model TEXT, source TEXT,
        thread_source TEXT, agent_path TEXT, is_pinned INTEGER DEFAULT 0,
        thread_section_id TEXT, section_position INTEGER, project_id TEXT
      );
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT, position INTEGER);
      CREATE TABLE IF NOT EXISTS project_roots (project_id TEXT, path TEXT, position INTEGER);
      CREATE TABLE IF NOT EXISTS thread_sections (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE IF NOT EXISTS thread_spawn_edges (child_thread_id TEXT);
      CREATE TABLE IF NOT EXISTS thread_goals (thread_id TEXT PRIMARY KEY, objective TEXT, status TEXT);
    `);
    // 旧库没有状态列时补上（Turnloom 的 threadStatusColumns 会自动识别）。
    for (const [name, type] of [
      ["status_state", "TEXT"],
      ["status_turn_id", "TEXT"],
      ["status_started_ms", "INTEGER"],
      ["status_updated_ms", "INTEGER"],
    ]) {
      try {
        db.exec(`ALTER TABLE threads ADD COLUMN ${name} ${type}`);
      } catch {
        /* 列已存在 */
      }
    }
    const runningBySession = new Map();
    for (const turn of piRunningTurns) runningBySession.set(String(turn.session_id), turn);
    db.exec("BEGIN IMMEDIATE");
    db.exec(`
      DELETE FROM threads;
      DELETE FROM projects;
      DELETE FROM project_roots;
      DELETE FROM thread_sections;
      DELETE FROM thread_spawn_edges;
      DELETE FROM thread_goals;
    `);
    const insProject = db.prepare("INSERT INTO projects (id, name, position) VALUES (?,?,?)");
    const insRoot = db.prepare("INSERT INTO project_roots (project_id, path, position) VALUES (?,?,?)");
    piProjects.forEach((p, i) => {
      const pid = `p${p.id}`;
      insProject.run(pid, String(p.name || `project-${p.id}`), i);
      if (p.path) insRoot.run(pid, String(p.path), i);
    });
    const insThread = db.prepare(`
      INSERT OR REPLACE INTO threads (id,title,rollout_path,created_at_ms,updated_at_ms,updated_at,archived,
        preview,cwd,model,source,thread_source,agent_path,is_pinned,thread_section_id,section_position,project_id,
        status_state,status_turn_id,status_started_ms,status_updated_ms)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

    const projectById = new Map(piProjects.map((p) => [String(p.id), p]));
    for (const s of piSessions) {
      const rollout = piRollouts.get(s.id);
      const project = s.project_id != null ? projectById.get(String(s.project_id)) : null;
      const runningTurn = runningBySession.get(String(s.id)) || null;
      insThread.run(
        s.id,
        String(s.title || "Untitled"),
        rollout ? path.relative(SHIM_HOME, rollout).replace(/\\/g, "/") : null,
        Number(s.created_at) || null,
        Number(s.updated_at) || null,
        iso(s.updated_at),
        0,
        "",
        project?.path ? String(project.path) : "",
        String(s.model_id || ""),
        "pidesktop",
        "user",
        "",
        s.pinned ? 1 : 0,
        null,
        null,
        project ? `p${project.id}` : null,
        runningTurn ? "running" : "idle",
        runningTurn ? String(runningTurn.id) : null,
        runningTurn ? Number(runningTurn.started_at) || null : null,
        Number(s.updated_at) || null,
      );
    }
    // Codex 侧：原样搬运它的行（只读来源），rollout 用复制品。
    for (const t of codexThreads) {
      const rollout = codexRollouts.get(t.id);
      insThread.run(
        t.id,
        String(t.title || "Untitled"),
        rollout ? path.relative(SHIM_HOME, rollout).replace(/\\/g, "/") : null,
        Number(t.created_at_ms) || null,
        Number(t.updated_at_ms) || null,
        iso(t.updated_at_ms),
        t.archived ? 1 : 0,
        String(t.preview || ""),
        String(t.cwd || ""),
        String(t.model || ""),
        "codex",
        String(t.thread_source || "user"),
        String(t.agent_path || ""),
        t.is_pinned ? 1 : 0,
        t.thread_section_id || null,
        Number(t.section_position) || null,
        t.project_id ? `codex:${t.project_id}` : null,
        null,
        null,
        null,
        null,
      );
    }
    db.exec("COMMIT");
  } finally {
    db.close();
  }
  writeModelCatalog(piModels);
}

/** Codex 的模型目录字段很多，抄一份真实条目做模板，避免逐个踩校验错误。 */
function codexModelTemplate() {
  try {
    const dir = path.join(os.homedir(), ".codex", "model-catalogs");
    const files = fs
      .readdirSync(dir)
      .filter((name) => name.toLowerCase().endsWith(".json"))
      .map((name) => ({ full: path.join(dir, name), mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const file of files) {
      const parsed = JSON.parse(fs.readFileSync(file.full, "utf8"));
      const sample = Array.isArray(parsed?.models) ? parsed.models.find((m) => m && m.slug) : null;
      if (!sample) continue;
      const clone = { ...sample };
      delete clone.model_messages;
      delete clone.base_instructions;
      return clone;
    }
  } catch {
    /* 没有模板时退回最小字段集 */
  }
  return { visibility: "list", supported_in_api: true, shell_type: "unified_exec", support_verbosity: true, default_verbosity: "low" };
}

/** PI 的 capabilities_json 是 JSON 数组字符串；旧数据缺失时保守按纯文本处理。 */
function modelCapabilities(raw) {
  try {
    const parsed = JSON.parse(String(raw || "[]"));
    const items = Array.isArray(parsed) ? parsed.map((item) => String(item || "").trim()).filter(Boolean) : [];
    return {
      items,
      vision: items.some((item) => /^(vision|image|images|attachments)$/i.test(item)),
    };
  } catch {
    return { items: [], vision: false };
  }
}
/**
 * 一个模型到底能不能收图。
 *
 * 真机上 `models.capabilities_json` 经常是过时的 `["text"]`，而供应商的
 * `config_json.models[].supportsImages` 才是用户实际配置的权威声明
 * （例：krisphyn 的 cn:hy4 caps 写 text、config 写 supportsImages:true，
 * 只看 caps 会误拦一个本来能用的多模态模型）。
 * 优先级：供应商显式声明 > models 能力表。
 */
function modelVisionFromRow(row) {
  const caps = modelCapabilities(row?.capabilities_json).vision;
  let declared = null;
  try {
    const config = JSON.parse(String(row?.provider_config_json || "{}"));
    const list = Array.isArray(config?.models) ? config.models : [];
    const modelId = String(row?.model_id || "");
    const hit = list.find((item) => String(item?.id || item?.modelId || "") === modelId);
    if (hit && typeof hit.supportsImages === "boolean") declared = hit.supportsImages;
  } catch {
    /* 配置坏了就退回能力表 */
  }
  return declared === null ? caps : declared;
}

/** 把 PI 的 供应商 × 模型 写成 Codex 兼容的模型目录，手机端才能按 PI 的配置选模型。 */
function writeModelCatalog(piModels = []) {
  try {
    const dir = path.join(SHIM_HOME, "model-catalogs");
    fs.mkdirSync(dir, { recursive: true });
    const template = codexModelTemplate();
    const entries = [];
    const seen = new Set();
    for (const row of piModels) {
      if (!row || Number(row.provider_enabled) !== 1) continue;
      const modelId = String(row.model_id || "").trim();
      const providerName = String(row.provider_name || row.provider_id || "").trim();
      if (!modelId || !providerName) continue;
      const slug = `${providerName}/${modelId}`;
      if (seen.has(slug)) continue;
      seen.add(slug);
      const label = String(row.display_name || modelId).trim();
      const display = label === modelId ? `${modelId} · ${providerName}` : `${label} · ${providerName}`;
      const vision = modelVisionFromRow(row);
      // 手机端靠 input_modalities 判断「这个模型能不能收图」。模板原本固定写
      // ["text","image"]，加上过时的 capabilities 表，会把能力判断带偏。
      const inputModalities = vision ? ["text", "image"] : ["text"];
      const capabilities = modelCapabilities(row.capabilities_json);
      entries.push({
        ...template,
        slug,
        display_name: display,
        description: `PI-Desktop 供应商 ${providerName} 的 ${label}`,
        base_instructions:
          "You are Codex, a coding agent. You and the user share one workspace; keep working until the goal is genuinely handled. Read the codebase before changing it, prefer rg for search, and keep edits scoped.",
        visibility: "list",
        supported_in_api: true,
        input_modalities: inputModalities,
        supports_images: vision,
        pi_capabilities: capabilities.items,
        supported_reasoning_levels: ["low", "medium", "high", "xhigh", "max"].map((effort) => ({
          effort,
          description: `PI-Desktop ${effort} reasoning`,
        })),
        default_reasoning_level: "medium",
        priority: entries.length,
      });
    }
    if (!entries.length) return;
    fs.writeFileSync(path.join(dir, "pidesk.json"), JSON.stringify({ models: entries }, null, 2), "utf8");
    // Keep whatever model is already configured if it is still valid; the sidecar
    // owns the "latest session" default and must not be stomped every 3 seconds.
    let defaultSlug = entries[0].slug;
    try {
      const current = fs.readFileSync(path.join(SHIM_HOME, "config.toml"), "utf8");
      const match = current.match(/^\s*model\s*=\s*"([^"]+)"/m);
      if (match && entries.some((entry) => entry.slug === match[1])) defaultSlug = match[1];
    } catch {
      /* no config yet */
    }
    fs.writeFileSync(
      path.join(SHIM_HOME, "config.toml"),
      `model = "${defaultSlug}"\nmodel_reasoning_effort = "medium"\nmodel_catalog_json = "model-catalogs/pidesk.json"\n`,
      "utf8",
    );
  } catch (error) {
    if (Date.now() - lastErrorLogAt > 60000) {
      lastErrorLogAt = Date.now();
      log("model catalog write failed:", error?.message || error);
    }
  }
}

function syncOnce() {
  if (syncBusy) return;
  syncBusy = true;
  try {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    const { sessions, projects, runningTurns, models } = readPiSessions();
    buildModelIndex(models);
    sessionModels.clear();
    for (const s of sessions) {
      if (s.provider_id && s.model_id) {
        sessionModels.set(String(s.id), { providerId: String(s.provider_id), modelId: String(s.model_id) });
      }
    }

    // 队列变更必须进入签名，否则会话消息没变时 rollout 不会刷新，
    // 手机端就看不到桌面端刚排的消息（反之亦然）。
    const queueRows = nativeQueueRows();
    const queueSignature = queueRows
      .map((row) => `${row.session_id}:${row.id}:${row.position}:${row.priority ?? ""}:${row.created_at}`)
      .join("|");
    const signature =
      sessions.map((s) => `${s.id}:${s.last_seq}:${s.updated_at}:${s.title}:${s.running_turns}`).join("|") +
      `#${projects.length}#${queueSignature}`;
    if (signature === lastSignature) return;

    // 2) 只重建"变过"的会话 rollout；其余文件原样复用，不再每轮全量重写几十 MB。
    const changedIds = new Set();
    for (const s of sessions) {
      const mark = `${s.last_seq}:${s.updated_at}:${s.project_id}:${s.running_turns}:${queueSignature}`;
      if (sessionMarks.get(s.id) !== mark) changedIds.add(s.id);
    }
    const liveIds = new Set(sessions.map((s) => s.id));
    const removed = [...sessionMarks.keys()].filter((id) => !liveIds.has(id));

    const { messages, turns } = changedIds.size
      ? readPiDetails([...changedIds])
      : { messages: [], turns: [] };
    const bySession = new Map();
    for (const m of messages) {
      if (!bySession.has(m.session_id)) bySession.set(m.session_id, []);
      bySession.get(m.session_id).push(m);
    }
    const projectPath = new Map(projects.map((p) => [String(p.id), p.path ? String(p.path) : ""]));

    const rollouts = new Map();
    const keep = new Set();
    for (const s of sessions) {
      const file = rolloutFiles.get(s.id) || path.join(SESSIONS_DIR, rolloutFileName(s.id, s.created_at));
      if (changedIds.has(s.id)) {
        const cwd = projectPath.get(String(s.project_id)) || "";
        fs.writeFileSync(file, buildRollout({ ...s, cwd }, bySession.get(s.id) || [], turns, queueRows), "utf8");
      }
      rolloutFiles.set(s.id, file);
      sessionMarks.set(s.id, `${s.last_seq}:${s.updated_at}:${s.project_id}:${s.running_turns}:${queueSignature}`);
      rollouts.set(s.id, file);
      keep.add(path.basename(file));
    }
    for (const id of removed) {
      const file = rolloutFiles.get(id);
      if (file) fs.rmSync(file, { force: true });
      rolloutFiles.delete(id);
      sessionMarks.delete(id);
    }

    // Codex 已经有自己独立的设备（dual/config.json 里的 codex 后端），门面里只放 PI-Desktop 会话，
    // 否则两个设备的会话会重复出现在同一个列表里。TURNLOOM_MIRROR_CODEX=1 可退回"合体"模式。
    const codexThreads = MIRROR_CODEX ? codexSide.readCodexThreads() : [];
    const codexRollouts = MIRROR_CODEX ? codexSide.copyRollouts(codexThreads, SESSIONS_DIR) : new Map();
    for (const file of codexRollouts.values()) keep.add(path.basename(file));
    codexThreadIds.clear();
    if (MIRROR_CODEX) for (const t of codexThreads) codexThreadIds.add(String(t.id));

    for (const name of fs.readdirSync(SESSIONS_DIR)) {
      if (!keep.has(name)) fs.rmSync(path.join(SESSIONS_DIR, name), { force: true });
    }

    writeStateDb(sessions, projects, rollouts, codexThreads, codexRollouts, runningTurns, models);

    const index = [
      ...sessions.map((s) => ({ id: s.id, thread_name: String(s.title || "").trim() })),
      ...codexThreads.map((t) => ({ id: t.id, thread_name: String(t.title || "").trim() })),
    ]
      .map((row) => JSON.stringify(row))
      .join("\n");
    fs.writeFileSync(SESSION_INDEX, `${index}\n`, "utf8");
    fs.writeFileSync(
      AUTH_FILE,
      JSON.stringify({ email: "pidesktop@local", token: "pidesktop-local-shim" }, null, 2),
      "utf8",
    );
    lastSignature = signature;
  } catch (error) {
    // 同一个错误不要每 3 秒刷一行日志（之前一天能刷几万行）。
    if (Date.now() - lastErrorLogAt > 60000) {
      lastErrorLogAt = Date.now();
      log("sync failed:", error?.message || error);
    }
  } finally {
    syncBusy = false;
  }
}

// ── Codex IPC 门面（双源路由）────────────────────────────────────────────
function textFromTurnInput(input) {
  if (typeof input === "string") return input;
  if (!Array.isArray(input)) return "";
  return input
    .filter((part) => part && (part.type === "text" || part.type === "input_text"))
    .map((part) => String(part.text || ""))
    .join("\n")
    .trim();
}

/**
 * 从 turn input 里取出图片并落盘，转成宿主 agent/prompt 认的附件形状。
 *
 * Codex 侧把图片作为 {type:"image", url:"data:<mime>;base64,<data>"} 放进 input。
 * 宿主不收内联 base64：preparePromptAttachments() 只按 attachment.path 在
 * <dataRoot>/scratch/<sessionId> 等根目录里解析，所以这里必须先落盘。
 *
 * 早先这段只挑文本、把图片静默丢掉 —— 手机显示发送成功，模型却什么都没收到。
 * 第二步又试过只传 {kind,data,mimeType}，宿主读 attachment.path.trim() 直接抛
 * "Cannot read properties of undefined (reading 'trim')"。两条都记在这里。
 */
function attachmentsFromTurnInput(input, sessionId) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const part of input) {
    if (!part || typeof part !== "object") continue;
    if (part.type !== "image" && part.type !== "input_image") continue;
    let data = "";
    let mimeType = "";
    let declaredName = "";
    const inline =
      typeof part.url === "string" ? part.url : typeof part.image_url === "string" ? part.image_url : "";
    if (inline.startsWith("data:")) {
      const comma = inline.indexOf(",");
      mimeType = comma > 0 ? inline.slice(5, comma).split(";")[0] : "";
      data = comma > 0 ? inline.slice(comma + 1) : "";
    } else if (typeof part.data === "string") {
      data = part.data;
      mimeType = String(part.mimeType || part.media_type || "");
      declaredName = String(part.name || "");
    }
    if (!data) continue;
    if (!/^image\//i.test(mimeType)) mimeType = "image/png";
    const staged = stageAttachmentFile(sessionId, { data, mimeType });
    out.push({
      kind: "image",
      path: staged.path,
      name: declaredName || staged.name,
      mimeType,
    });
  }
  return out;
}

async function invokeHostArgs(operation, args, options = {}) {
  if (!pi?.desktop?.invoke) throw new Error("host desktop.invoke unavailable");
  // session/configure 在宿主契约里是 dangerous：input.confirm 必须为 true，
  // 宿主随后仍会弹原生确认框。confirm 是契约标记，不是绕过用户授权。
  const input = { operation, args };
  if (options.confirm === true) input.confirm = true;
  return pi.desktop.invoke(input);
}

async function invokeHost(operation, arg) {
  return invokeHostArgs(operation, [arg]);
}

function conversationIdOf(params) {
  return String(params?.conversationId || params?.threadId || params?.turnStart?.request?.threadId || "");
}

/** 从 pi.sqlite 的「供应商 × 模型」建立解析索引；认不出的写法一律不猜。 */
function buildModelIndex(rows) {
  const bySlug = new Map();
  const byPair = new Map();
  const byModelId = new Map();
  for (const row of rows || []) {
    const providerId = String(row.provider_id || "");
    const modelId = String(row.model_id || "").trim();
    if (!providerId || !modelId) continue;
    const pair = { providerId, modelId };
    byPair.set(`${providerId}/${modelId}`, pair);
    const name = String(row.provider_name || "").trim();
    if (name) bySlug.set(`${name}/${modelId}`, pair);
    const bucket = byModelId.get(modelId);
    if (bucket) bucket.push(pair);
    else byModelId.set(modelId, [pair]);
  }
  modelIndex = { bySlug, byPair, byModelId };
}

/** 会话当前生效的模型对（来自 pi.sqlite 快照）。 */
function currentSessionModel(sessionId) {
  return sessionModels.get(String(sessionId)) || null;
}

/**
 * 会话当前的 (provider, model) 在 PI 里是否还能用。
 *
 * 真机事故：会话被写成一个已禁用供应商的模型后，agent/prompt 每轮都从
 * resolveAgentRuntimeLaunch 抛 "No provider configured"，普通消息也一起挂。
 * 这类「会话本身已经坏了」的情况，光修模型切换并不够，必须在发送前识别。
 */
function modelPairUsable(pair) {
  const providerId = String(pair?.providerId || "").trim();
  const modelId = String(pair?.modelId || "").trim();
  if (!providerId || !modelId) return false;
  const db = new DatabaseSync(PI_DB, { readOnly: true });
  try {
    const row = db
      .prepare(
        `SELECT p.enabled AS provider_enabled, m.model_id AS model_id
           FROM providers p LEFT JOIN models m
             ON m.provider_id = p.id AND m.model_id = ?
          WHERE p.id = ?`,
      )
      .get(modelId, providerId);
    return Boolean(row && Number(row.provider_enabled) === 1 && row.model_id);
  } catch {
    return false;
  } finally {
    db.close();
  }
}

/** 会话当前生效的模型对（直接读 pi.sqlite，不用可能过期的内存快照）。 */
function sessionModelPair(sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) return null;
  const db = new DatabaseSync(PI_DB, { readOnly: true });
  try {
    const row = db.prepare(`SELECT provider_id, model_id FROM sessions WHERE id = ?`).get(id);
    if (!row) return null;
    return {
      providerId: String(row.provider_id || ""),
      modelId: String(row.model_id || ""),
    };
  } catch {
    return null;
  } finally {
    db.close();
  }
}

/**
 * 给坏会话挑一个确定可用的模型对：
 *   1) 这条会话最近一次成功轮次用过的模型（最贴近用户当时的意图）；
 *   2) 任一启用供应商的默认模型；
 *   3) 任一启用供应商的任一模型。
 * 全都找不到就返回 null —— 绝不编造一个组合往会话里写。
 */
function fallbackModelPair(sessionId) {
  const id = String(sessionId || "").trim();
  const db = new DatabaseSync(PI_DB, { readOnly: true });
  try {
    if (id) {
      const lastGood = db
        .prepare(
          `SELECT t.provider_id AS provider_id, t.model_id AS model_id
             FROM turns t
             JOIN providers p ON p.id = t.provider_id AND p.enabled = 1
             JOIN models m ON m.provider_id = t.provider_id AND m.model_id = t.model_id
            WHERE t.session_id = ? AND t.status = 'completed'
            ORDER BY t.ended_at DESC LIMIT 1`,
        )
        .get(id);
      if (lastGood?.provider_id && lastGood?.model_id) {
        return { providerId: String(lastGood.provider_id), modelId: String(lastGood.model_id) };
      }
    }
    const providerDefault = db
      .prepare(
        `SELECT p.id AS provider_id, p.default_model_id AS model_id
           FROM providers p
           JOIN models m ON m.provider_id = p.id AND m.model_id = p.default_model_id
          WHERE p.enabled = 1 AND p.default_model_id IS NOT NULL AND trim(p.default_model_id) <> ''
          ORDER BY p.name ASC LIMIT 1`,
      )
      .get();
    if (providerDefault?.provider_id && providerDefault?.model_id) {
      return { providerId: String(providerDefault.provider_id), modelId: String(providerDefault.model_id) };
    }
    const anyModel = db
      .prepare(
        `SELECT m.provider_id AS provider_id, m.model_id AS model_id
           FROM models m JOIN providers p ON p.id = m.provider_id AND p.enabled = 1
          ORDER BY m.model_id ASC LIMIT 1`,
      )
      .get();
    if (anyModel?.provider_id && anyModel?.model_id) {
      return { providerId: String(anyModel.provider_id), modelId: String(anyModel.model_id) };
    }
    return null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

/**
 * PI 宿主的 session/fork 只认 throughMessageId，而手机端手上只有 turnId
 * （消息 id 从来没透出到 Turnloom 的接口里）。所以桥自己换算：
 * 取这一轮里最后一条带 id 的消息作为分叉点。
 */
function piForkPoint(sessionId, { lastTurnId = "", beforeTurnId = "", throughMessageId = "" } = {}) {
  const db = new DatabaseSync(PI_DB, { readOnly: true });
  try {
    const id = String(sessionId || "");
    if (!id) return { messageId: "", fallback: false };
    // 手机端能直接给消息 id 时最准，先认它（必须属于这条会话）。
    const direct = String(throughMessageId || "").trim();
    if (direct) {
      const owned = db.prepare(`SELECT id FROM messages WHERE session_id = ? AND id = ?`).get(id, direct);
      if (owned?.id) return { messageId: String(owned.id), fallback: false };
    }
    const turnId = String(beforeTurnId || lastTurnId || "").trim();
    if (turnId) {
      const row = beforeTurnId
        ? db
            .prepare(
              `SELECT id FROM messages WHERE session_id = ? AND turn_id IS NOT NULL AND turn_id != ? AND id IS NOT NULL
                 AND seq < (SELECT MIN(seq) FROM messages WHERE session_id = ? AND turn_id = ?)
               ORDER BY seq DESC LIMIT 1`,
            )
            .get(id, turnId, id, turnId)
        : db
            .prepare(
              `SELECT id FROM messages WHERE session_id = ? AND turn_id = ? AND id IS NOT NULL
               ORDER BY seq DESC LIMIT 1`,
            )
            .get(id, turnId);
      if (row?.id) return { messageId: String(row.id), fallback: false };
    }
    // 退一步：没有可用的轮次信息就分叉到会话末尾，等同于「复制这条会话」。
    // 分叉出来的会话（PI 会把 turn_id 清空）会走到这里，所以要把这件事告诉用户。
    const tail = db
      .prepare(`SELECT id FROM messages WHERE session_id = ? AND id IS NOT NULL ORDER BY seq DESC LIMIT 1`)
      .get(id);
    return { messageId: tail?.id ? String(tail.id) : "", fallback: Boolean(tail?.id) && Boolean(turnId) };
  } finally {
    db.close();
  }
}

/**
 * 把 Codex 侧回传的 model 解析成宿主认的 (providerId, modelId)。
 * 精确匹配三种写法：我们发布的门面 slug（providerName/modelId）、providerId/modelId、
 * 以及裸 modelId（只有唯一供应商、或能对上会话当前供应商时才敢用）。
 */
function resolveModelPair(raw, preferredProviderId = "") {
  const slug = String(raw || "").trim();
  if (!slug) return null;
  const direct = modelIndex.bySlug.get(slug) || modelIndex.byPair.get(slug);
  if (direct) return direct;
  let candidates = (modelIndex.byModelId.get(slug) || []).slice();
  if (!candidates.length && slug.includes("/")) {
    // 老客户端可能只回传「供应商/模型」的后半截，按最后一段再试一次。
    const tail = slug.slice(slug.indexOf("/") + 1);
    const tailHit = modelIndex.bySlug.get(tail) || modelIndex.byPair.get(tail);
    if (tailHit) return tailHit;
    candidates = (modelIndex.byModelId.get(tail) || []).slice();
  }
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    const preferred = candidates.find((pair) => pair.providerId === preferredProviderId);
    if (preferred) return preferred;
    log(`model "${slug}" matches ${candidates.length} providers — keeping the session's model`);
  }
  return null;
}

/**
 * 把 Codex 侧的 model/effort 翻译成宿主认的 (providerId, modelId, thinkingLevel)。
 *
 * 宿主 agent/prompt 的 schema 里根本没有模型字段，模型只能经 session/create 或
 * session/configure 落地。此前这里把「providerName + 裸 modelId」一起塞给 prompt，
 * 结果会话被写成一个该供应商并不存在的模型组合，下一轮必 MODEL_NOT_CONFIGURED
 * （真机上已复现）。解析不出来就整对省略：宁可沿用会话当前模型，也不写坏会话。
 */
function turnSettingsFromRequest(params, preferredProviderId = "") {
  const request = params?.turnStart?.request || params || {};
  const settings = {};
  const slug = String(request.model || "").trim();
  if (slug) {
    const pair = resolveModelPair(slug, preferredProviderId);
    if (pair) {
      settings.providerId = pair.providerId;
      settings.modelId = pair.modelId;
    } else {
      log(`unresolved model "${slug}" — keeping the session's model`);
    }
  }
  const effort = String(request.effort || request.reasoningEffort || "").trim();
  if (effort) settings.thinkingLevel = effort;
  return settings;
}

/**
 * 切换模型只有 session/configure 一条路，宿主把它标为 dangerous：
 *   1. desktop.invoke({operation,args,confirm:true}) 是合法契约；
 *   2. 宿主还会弹原生确认框，由用户授权这次切换；
 *   3. 授权失败/用户拒绝时，绝不能吞掉错误继续 agent/prompt。
 * 旧实现缺 confirm 且吞掉拒绝，随后继续 prompt，最终把同一个坏
 * provider/model 反复启动成 No provider configured（发图后普通消息也一起挂）。
 */
async function applyModelIfChanged(sessionId, settings) {
  if (!sessionId || !settings.providerId || !settings.modelId) return;
  // 内存快照每 3 秒同步一次；桥刚重载时它还是空的。没有快照就以数据库为准，
  // 否则「模型其实没变」也会触发一次危险操作的确认框。
  const current = currentSessionModel(sessionId) || sessionModelPair(sessionId);
  if (current && current.providerId === settings.providerId && current.modelId === settings.modelId) return;
  const wanted = `${settings.providerId}/${settings.modelId}`;
  const key = `${sessionId}|${wanted}`;
  if (configureFailed.has(key)) {
    throw new Error(
      `模型切换为 ${wanted} 未被 PI 桌面端确认；为避免再次发送失败，本轮已停止。请在桌面端确认切换后重试，或保持当前模型。`,
    );
  }
  if (configureApplied.has(key)) return;
  const config = { mode: "agent", providerId: settings.providerId, modelId: settings.modelId };
  if (settings.thinkingLevel) config.thinkingLevel = settings.thinkingLevel;
  try {
    await invokeHostArgs("session/configure", [sessionId, config], { confirm: true });
    configureApplied.add(key);
    sessionModels.set(String(sessionId), { providerId: settings.providerId, modelId: settings.modelId });
    log(`session ${sessionId} -> ${wanted}`);
  } catch (error) {
    configureFailed.add(key);
    // 冷却 45 秒后再允许重试：用户可能刚在桌面端授权，或换了可用模型。
    // 但绝不能让一次失败永久封锁这条会话。
    setTimeout(() => configureFailed.delete(key), 600000).unref?.();
    const reason = error?.message || String(error);
    log(`session ${sessionId} model switch to ${wanted} refused:`, reason);
    throw new Error(
      `模型切换为 ${wanted} 未被 PI 桌面端确认：${reason}。本轮未发送，避免损坏会话；请在桌面端确认后重试，或保持当前模型。`,
    );
  }
}

/**
 * 发送前的唯一模型闸门。
 *
 * 依次决定这一轮到底用哪个 (providerId, modelId)：
 *   1) 手机端明确选中的模型，且它在 PI 里确实可用；
 *   2) 会话当前模型，且仍可用；
 *   3) 这条会话最近一次成功轮次 / 供应商默认模型；
 *   4) 一个都没有 → 直接报错，不发送。
 *
 * 关键点：会话已经坏掉时（供应商被禁用、模型被删除），修好它是发送的前提；
 * 旧实现只切「用户选的新模型」，会话本来坏着就每轮都 No provider configured。
 */
async function ensureSendableModel(sessionId, settings = {}) {
  const desired = settings.providerId && settings.modelId
    ? { providerId: settings.providerId, modelId: settings.modelId }
    : null;
  let target = desired && modelPairUsable(desired) ? desired : null;
  if (!target) {
    const currentPair = sessionModelPair(sessionId);
    if (currentPair && modelPairUsable(currentPair)) target = currentPair;
  }
  if (!target) {
    target = fallbackModelPair(sessionId);
    if (!target) {
      throw new Error(
        "当前会话没有可用模型（供应商被禁用或模型已删除）。请在 PI 桌面端重新选择模型后重试。",
      );
    }
    log(`session ${sessionId} model unusable -> repairing to ${target.providerId}/${target.modelId}`);
  }
  await applyModelIfChanged(sessionId, { ...settings, providerId: target.providerId, modelId: target.modelId });
  const settled = sessionModelPair(sessionId);
  if (settled && !modelPairUsable(settled)) {
    throw new Error(
      `模型 ${target.providerId}/${target.modelId} 在 PI 中不可用，本轮未发送。请在桌面端选择可用模型后重试。`,
    );
  }
}

/** 返回 {result} 或抛错；Codex 侧直接代理。 */
async function handleAction(method, params, version) {
  const conversationId = conversationIdOf(params);

  // 队列是 PI 自身的权威状态，不能按会话来源代理到 Codex IPC。
  if (method === "turnloom/queue/push") return nativeQueuePush(params);
  if (method === "turnloom/queue/list") return nativeQueueList(params);
  if (method === "turnloom/queue/remove") return nativeQueueRemove(params);
  if (method === "turnloom/queue/steer") return nativeQueueSteer(params);
  // 宿主能力：手机端经白名单访问 PI 的只读能力与显式确认的写能力。
  if (method === "turnloom/host/invoke") return hostInvoke(params);
  if (method === "turnloom/approvals/list") return hostApprovals(params);
  if (method === "turnloom/approvals/resolve") return hostApprovalsResolve(params);
  if (method === "turnloom/todos") return hostTodos(params);
  if (method === "turnloom/notifications") return hostNotifications(params);
  if (method === "turnloom/notifications/read") return hostNotificationsRead(params);
  if (method === "turnloom/scheduled") return hostScheduled(params);
  if (method === "turnloom/usage") return hostUsage(params);
  // 手机端「从列表移除」走软删除，不触发桌面确认框；restore 用于撤销。
  if (method === "turnloom/session/hide") return sessionHide(params);
  if (method === "turnloom/session/restore") return sessionRestore(params);
  if (method === "turnloom/session/hidden") return sessionHidden(params);

  if (conversationId && codexThreadIds.has(conversationId)) {
    const frame = await codexSide.proxyRequest(method, params, version);
    if (frame.resultType === "error") throw new Error(frame.error || `${method} failed in Codex`);
    return frame.result ?? {};
  }

  // The app-server handshake must be answered, otherwise the client reports
  // "unsupported method: initialize" and silently falls back to spawning codex CLI.
  if (method === "initialize") return { clientId: "pidesktop-bridge" };
  // The app-server handshake must be answered, otherwise the client reports
  // "unsupported method: initialize" and silently falls back to spawning codex CLI.
  if (method === "initialize") return { clientId: "pidesktop-bridge" };

  if (method === "thread-follower-start-turn") {
    const input = params?.turnStart?.request?.input;
    const text = textFromTurnInput(input);
    const attachments = attachmentsFromTurnInput(input, conversationId);
    if (!conversationId) throw new Error("start-turn without conversationId");
    if (!text && !attachments.length) throw new Error("start-turn without text");
    // Never auto-run session/configure here. It is a dangerous host operation
    // and PI Desktop shows a native confirm dialog on every change. The phone
    // already sends the selected model for new sessions; existing sessions must
    // keep their current model unless the user explicitly requests a switch.
    // agent/prompt 的 schema 只有 sessionId/content/attachments：模型只能靠上面的
    // configure 落地，往这里塞模型字段会被静默忽略（历史上还因此写坏过会话）。
    await invokeHost("agent/prompt", {
      sessionId: conversationId,
      content: text,
      ...(attachments.length ? { attachments } : {}),
    });
    return { conversationId, turnId: null };
  }
  // 新建对话：先让 PI-Desktop 建会话，再把首条消息发进去。
  if (method === "start-conversation") {
    const input = params?.input;
    const text = textFromTurnInput(input);
    const settings = turnSettingsFromRequest(params);
    // 手机端选的项目（= 文件夹）由宿主按 projectPath 归档。只认显式 projectPath：
    // 拿 cwd 兜底会把所有临时会话都塞进 Turnloom 自己的安装目录。
    const projectPath = String(params?.projectPath || "").trim();
    // 新会话的模型必须在 session/create 一次给对：宿主只认 (providerId, modelId) 这对 id。
    const created = await invokeHost("session/create", {
      mode: "agent",
      ...(projectPath ? { projectPath } : {}),
      ...(settings.providerId && settings.modelId
        ? { providerId: settings.providerId, modelId: settings.modelId }
        : {}),
      ...(settings.thinkingLevel ? { thinkingLevel: settings.thinkingLevel } : {}),
    });
    const id = String(created?.session?.id || created?.id || "");
    if (!id) throw new Error("PI-Desktop did not return a session id");
    if (settings.providerId && settings.modelId) {
      sessionModels.set(String(id), { providerId: settings.providerId, modelId: settings.modelId });
    }
    // 附件要落到 <dataRoot>/scratch/<sessionId>/，所以必须在拿到 id 之后再落盘。
    const attachments = attachmentsFromTurnInput(input, id);
    if (text || attachments.length) {
      await invokeHost("agent/prompt", {
        sessionId: id,
        content: text,
        ...(attachments.length ? { attachments } : {}),
      });
    }
    return { conversationId: id, turnId: null };
  }

  // 手机端「从这里创建分支」：Codex 侧发 thread/fork(lastTurnId)，宿主认
  // session/fork(throughMessageId)。桥负责换算并继承原会话的模型对，
  // 否则新会话第一次 prompt 会被宿主判成 MODEL_NOT_CONFIGURED。
  if (method === "thread/fork") {
    const threadId = String(params?.threadId || conversationId || "").trim();
    if (!threadId) throw new Error("fork without threadId");
    const forkPoint = piForkPoint(threadId, {
      lastTurnId: params?.lastTurnId || "",
      beforeTurnId: params?.beforeTurnId || "",
      throughMessageId: params?.throughMessageId || "",
    });
    const forked = await invokeHost("session/fork", {
      sessionId: threadId,
      ...(forkPoint.messageId ? { throughMessageId: forkPoint.messageId } : {}),
    });
    const forkedId = String(forked?.session?.id || forked?.id || "");
    if (!forkedId) throw new Error("PI-Desktop did not return a forked session id");
    const current = currentSessionModel(threadId);
    if (current?.providerId && current?.modelId) {
      sessionModels.set(forkedId, { providerId: current.providerId, modelId: current.modelId });
    }
    return {
      ok: true,
      threadId: forkedId,
      conversationId: forkedId,
      throughMessageId: forkPoint.messageId || null,
      branchFallback: forkPoint.fallback,
    };
  }

  if (method === "thread-follower-interrupt-turn") {
    if (!conversationId) throw new Error("interrupt without conversationId");
    await invokeHost("agent/abort", { sessionId: conversationId });
    return { ok: true };
  }
  if (method === "thread-follower-steer-turn") {
    const input = params?.input;
    const text = textFromTurnInput(input);
    const attachments = attachmentsFromTurnInput(input, conversationId);
    if (conversationId && (text || attachments.length)) {
      // Intentionally no ensureSendableModel(): no dangerous configure on send.
      await invokeHost("agent/prompt", {
        sessionId: conversationId,
        content: text,
        ...(attachments.length ? { attachments } : {}),
      });
    }
    return { ok: true };
  }
  // 真调用宿主压缩；旧实现只回 ok，手机端按了没有任何效果。
  if (method === "thread-follower-compact-thread") {
    if (!conversationId) throw new Error("compact without conversationId");
    // Intentionally no ensureSendableModel(): no dangerous configure on send.
    const result = await invokeHost("agent/compact", { sessionId: conversationId });
    return { ok: true, result };
  }
  if (method === "thread-owner-discovery") return { handledByClientId: null };
  if (method === "refresh-recent-conversations-for-host") return { ok: true };
  // Codex 形状的审批回执：PI 的审批走 turnloom/approvals/resolve。
  if (method.includes("approval")) {
    return { ok: false, reason: "PI approvals are resolved through turnloom/approvals/resolve" };
  }
  if (method === "thread/goal/get") return { goal: null };
  if (method === "thread/goal/set") return { goal: null };
  throw new Error(`unsupported method: ${method}`);
}

function encodeFrame(obj) {
  const payload = Buffer.from(JSON.stringify(obj), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

function startPipeServer() {
  pipeServer = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const length = buffer.readUInt32LE(0);
        if (buffer.length < 4 + length) break;
        const payload = buffer.subarray(4, 4 + length).toString("utf8");
        buffer = buffer.subarray(4 + length);
        let message;
        try {
          message = JSON.parse(payload);
        } catch {
          continue;
        }
        if (message?.type !== "request") continue;
        const respond = (resultType, result, error) => {
          const frame = { type: "response", requestId: message.requestId, method: message.method, resultType };
          if (resultType === "success") frame.result = result ?? {};
          else frame.error = String(error || "error");
          try {
            socket.write(encodeFrame(frame));
          } catch {
            /* client gone */
          }
        };
        handleAction(String(message.method || ""), message.params || {}, message.version)
          .then((result) => respond("success", result))
          .catch((error) => {
            log("ipc action failed:", message.method, error?.message || error);
            respond("error", null, error?.message || String(error));
          });
      }
    });
    socket.on("error", () => {});
  });
  pipeServer.on("error", (error) => log("pipe server error:", error?.message || error));
  pipeServer.listen(PIPE_PATH, () => log("codex IPC facade listening on", PIPE_PATH));
}

// ── Turnloom 托管 ────────────────────────────────────────────────────────
function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.setTimeout(800, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function ensureTurnloom() {
  if (unloading) return;
  if (await portOpen(TURNLOOM_PORT)) return;
  if (!fs.existsSync(path.join(TURNLOOM_DIR, "server.js"))) {
    log("turnloom server.js not found at", TURNLOOM_DIR);
    return;
  }
  log("starting turnloom on port", TURNLOOM_PORT);
  const out = fs.openSync(TURNLOOM_LOG, "a");
  const err = fs.openSync(TURNLOOM_ERR, "a");
  turnloomChild = spawn(
    NODE_BIN,
    [
      path.join(TURNLOOM_DIR, "server.js"),
      "--port",
      String(TURNLOOM_PORT),
      "--codex-home",
      SHIM_HOME,
      "--password",
      TURNLOOM_PASSWORD,
      "--ipc-socket",
      PIPE_PATH,
    ],
    { cwd: TURNLOOM_DIR, stdio: ["ignore", out, err], windowsHide: true },
  );
  turnloomChild.on("exit", (code) => {
    turnloomChild = null;
    if (unloading) return;
    log("turnloom exited code", code, "- retry in 10s");
    setTimeout(() => ensureTurnloom().catch(() => {}), 10000);
  });
}

// ── 生命周期 ─────────────────────────────────────────────────────────────
async function onLoad() {
  log("loading: merged mirror (PI-Desktop + Codex) + IPC facade + turnloom supervisor");
  syncOnce();
  syncTimer = setInterval(syncOnce, SYNC_INTERVAL_MS);
  startPipeServer();
  ensureTurnloom().catch((error) => log("ensureTurnloom failed:", error?.message || error));
  turnloomTimer = setInterval(() => ensureTurnloom().catch(() => {}), 60000);
}

async function onUnload() {
  unloading = true;
  if (syncTimer) clearInterval(syncTimer);
  if (turnloomTimer) clearInterval(turnloomTimer);
  syncTimer = null;
  turnloomTimer = null;
  if (pipeServer) {
    try {
      pipeServer.close();
    } catch {
      /* ignore */
    }
    pipeServer = null;
  }
  turnloomChild = null;
  log("unloaded");
}

module.exports = { onLoad, onUnload };
