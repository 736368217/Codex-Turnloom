"use strict";
/**
 * Codex Desktop 侧适配（只读 + IPC 代理）。
 *
 * 目的：让**一个 Turnloom 进程**同时服务两个软件 —— 门面里既有 PI-Desktop 会话，
 * 也有 Codex Desktop 自己的会话；对 Codex 会话的操作原样代理回 Codex 的 IPC，
 * 保证行为与直连 Codex 完全一致。
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const { randomUUID } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
// Codex 的真实数据目录：优先按 CodexPocket 的配置解析（默认 ~/.codex 常常是空的）。
function resolveCodexHome() {
  const candidates = [];
  const cfg = path.join(process.env.LOCALAPPDATA || "", "CodexPocket", "config.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(cfg, "utf8"));
    if (parsed?.codexHome) candidates.push(String(parsed.codexHome));
  } catch {
    /* no CodexPocket config */
  }
  candidates.push(path.join(os.homedir(), ".codex"));
  for (const dir of candidates) {
    if (dir && fs.existsSync(path.join(dir, "state_5.sqlite"))) return dir;
  }
  return candidates[candidates.length - 1];
}

const CODEX_HOME = resolveCodexHome();
const CODEX_DB = path.join(CODEX_HOME, "state_5.sqlite");
const CODEX_IPC = "\\\\.\\pipe\\codex-ipc";

function iso(ms) {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : new Date().toISOString();
}

/** 读 Codex 的 threads；失败（没装/被锁）就当没有。 */
function readCodexThreads() {
  if (!fs.existsSync(CODEX_DB)) return [];
  let db;
  try {
    db = new DatabaseSync(CODEX_DB, { readOnly: true });
    return db
      .prepare(
        `SELECT id, title, rollout_path, created_at_ms, updated_at_ms, archived, preview,
                cwd, model, source, thread_source, agent_path, is_pinned,
                thread_section_id, section_position, project_id
           FROM threads ORDER BY updated_at_ms DESC LIMIT 500`,
      )
      .all();
  } catch {
    return [];
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    }
  }
}

/** 把 Codex 的 rollout 复制进门面目录（不改原文件），返回 id→新路径。 */
function copyRollouts(rows, destDir) {
  const map = new Map();
  for (const row of rows) {
    const src = row.rollout_path ? path.resolve(CODEX_HOME, String(row.rollout_path)) : "";
    if (!src || !fs.existsSync(src)) continue;
    const dest = path.join(destDir, `codex-${row.id}.jsonl`);
    try {
      fs.copyFileSync(src, dest);
      map.set(row.id, dest);
    } catch {
      /* ignore */
    }
  }
  return map;
}

function encode(obj) {
  const payload = Buffer.from(JSON.stringify(obj), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

let proxySocket = null;
let proxyBuffer = Buffer.alloc(0);
let proxyClientId = null;
const proxyPending = new Map();

function resetProxy() {
  if (proxySocket) {
    proxySocket.removeAllListeners();
    proxySocket.destroy();
  }
  proxySocket = null;
  proxyBuffer = Buffer.alloc(0);
  proxyClientId = null;
  for (const { reject } of proxyPending.values()) reject(new Error("codex ipc closed"));
  proxyPending.clear();
}

function connectProxy() {
  if (proxySocket) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const socket = net.connect(CODEX_IPC);
    socket.once("error", (error) => {
      proxySocket = null;
      reject(error);
    });
    socket.once("connect", () => {
      proxySocket = socket;
      socket.on("data", (chunk) => {
        proxyBuffer = Buffer.concat([proxyBuffer, chunk]);
        while (proxyBuffer.length >= 4) {
          const len = proxyBuffer.readUInt32LE(0);
          if (proxyBuffer.length < 4 + len) return;
          const body = JSON.parse(proxyBuffer.subarray(4, 4 + len).toString("utf8"));
          proxyBuffer = proxyBuffer.subarray(4 + len);
          if (body.type === "response" && body.requestId && proxyPending.has(body.requestId)) {
            const { resolve: done } = proxyPending.get(body.requestId);
            proxyPending.delete(body.requestId);
            done(body);
          }
        }
      });
      socket.on("close", resetProxy);
      socket.on("error", resetProxy);
      // Codex 桌面端要求先 initialize 才接受业务请求。
      const id = randomUUID();
      proxyPending.set(id, {
        resolve: (body) => {
          proxyClientId = body?.result?.clientId || null;
          resolve();
        },
        reject,
      });
      socket.write(encode({ type: "request", requestId: id, method: "initialize", params: { clientType: "webcontrolui" } }));
    });
  });
}

/** 把一次请求原样代理给 Codex IPC，返回它的 response 帧。 */
async function proxyRequest(method, params, version) {
  await connectProxy();
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      proxyPending.delete(requestId);
      reject(new Error(`${method} via codex ipc timed out`));
    }, 60000);
    proxyPending.set(requestId, {
      resolve: (body) => {
        clearTimeout(timer);
        resolve(body);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    proxySocket.write(
      encode({
        type: "request",
        requestId,
        sourceClientId: proxyClientId || undefined,
        method,
        params,
        version: Number.isFinite(version) ? version : 0,
      }),
    );
  });
}

module.exports = { readCodexThreads, copyRollouts, proxyRequest, iso, CODEX_HOME };
