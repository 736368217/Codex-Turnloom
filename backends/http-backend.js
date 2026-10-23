/**
 * Minimal HTTP backend adapter for Codex-Turnloom.
 *
 * The contract is intentionally small so a third-party agent can expose it in
 * roughly 100 lines:
 *
 *   GET  /threads                         -> [{ id, title, updatedAtMs, ... }]
 *   GET  /threads/:id/messages?limit&before -> { thread, messages, status, totalMessages }
 *   POST /threads/:id/messages { text }   -> { ok }
 *   POST /threads { text }                -> { threadId }
 *   POST /threads/:id/interrupt           -> { ok }
 *
 * No CODEX_HOME files are read or written in this mode.
 */

const VALID_STATES = new Set(["running", "waiting", "ended"]);

export function normalizeBackendState(value) {
  const state = String(value || "").trim().toLowerCase();
  if (VALID_STATES.has(state)) return state;
  if (state === "active" || state === "in_progress" || state === "thinking") return "running";
  if (state === "awaiting" || state === "needs_input" || state === "approval") return "waiting";
  if (state === "idle" || state === "complete" || state === "completed") return "ended";
  return "";
}

export function normalizeBackendStatus(rawStatus) {
  const status = rawStatus && typeof rawStatus === "object" ? rawStatus : { state: rawStatus };
  const state = normalizeBackendState(status.state || status.status) ||
    (status.thinking ? "running" : status.interactionRequired ? "waiting" : "ended");
  const thinking = Boolean(status.thinking ?? (state === "running" || state === "waiting"));
  return {
    ...status,
    state,
    thinking,
    interactionRequired: Boolean(status.interactionRequired ?? state === "waiting"),
    turnId: status.turnId || status.turn_id || null,
    startedAtMs: Number.isFinite(Number(status.startedAtMs)) ? Number(status.startedAtMs) : null
  };
}

export function normalizeBackendThread(rawThread) {
  const thread = rawThread && typeof rawThread === "object" ? rawThread : {};
  const projectId = thread.projectId ?? thread.project_id ?? null;
  const project = thread.project || (projectId
    ? {
        key: `project:${projectId}`,
        id: String(projectId),
        name: String(thread.projectName || thread.project_name || projectId),
        native: true
      }
    : null);
  return {
    ...thread,
    id: String(thread.id || thread.threadId || ""),
    title: String(thread.title || thread.name || "Untitled"),
    updatedAtMs: Number(thread.updatedAtMs ?? thread.updated_at_ms ?? thread.updatedAt) || 0,
    createdAtMs: Number(thread.createdAtMs ?? thread.created_at_ms) || null,
    archived: Boolean(thread.archived),
    preview: String(thread.preview || ""),
    cwd: String(thread.cwd || ""),
    model: String(thread.model || ""),
    pinned: Boolean(thread.pinned),
    project,
    status: normalizeBackendStatus(thread.status)
  };
}

export class HttpBackendClient {
  constructor({ baseUrl, token = "", fetchImpl = globalThis.fetch, timeoutMs = 30_000 } = {}) {
    if (!baseUrl) throw new Error("HTTP backend URL is required");
    if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
    this.baseUrl = String(baseUrl).replace(/\/+$/, "");
    this.token = String(token || "");
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async request(route, { method = "GET", query = null, body = undefined } = {}) {
    const url = new URL(`${this.baseUrl}${route.startsWith("/") ? route : `/${route}`}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== null && value !== undefined && value !== "") url.searchParams.set(key, String(value));
      }
    }
    const headers = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.token) {
      headers["x-access-token"] = this.token;
      headers.authorization = `Bearer ${this.token}`;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
      const text = await response.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
      }
      if (!response.ok) {
        const error = new Error(data?.error || `HTTP backend returned ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return data;
    } catch (error) {
      if (error?.name === "AbortError") {
        const timeoutError = new Error("HTTP backend request timed out");
        timeoutError.status = 504;
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async listThreads() {
    const data = await this.request("/threads");
    const rows = Array.isArray(data) ? data : Array.isArray(data?.threads) ? data.threads : [];
    return rows.map(normalizeBackendThread).filter((thread) => thread.id);
  }

  async findThread(threadId) {
    const threads = await this.listThreads();
    return threads.find((thread) => thread.id === String(threadId)) || null;
  }

  async getMessages(threadId, { limit = 80, before = "" } = {}) {
    const data = await this.request(`/threads/${encodeURIComponent(threadId)}/messages`, {
      query: { limit, before }
    });
    const thread = data?.thread ? normalizeBackendThread(data.thread) : await this.findThread(threadId);
    if (!thread) {
      const error = new Error("Thread not found");
      error.status = 404;
      throw error;
    }
    return {
      ...(data || {}),
      thread,
      status: normalizeBackendStatus(data?.status || thread?.status || {}),
      messages: Array.isArray(data?.messages) ? data.messages : []
    };
  }

  async sendMessage(threadId, text, images = []) {
    return this.request(`/threads/${encodeURIComponent(threadId)}/messages`, {
      method: "POST",
      body: { text: String(text || ""), images: Array.isArray(images) ? images : [] }
    });
  }

  async createThread(text, images = []) {
    return this.request("/threads", {
      method: "POST",
      body: { text: String(text || ""), images: Array.isArray(images) ? images : [] }
    });
  }

  async interrupt(threadId) {
    return this.request(`/threads/${encodeURIComponent(threadId)}/interrupt`, { method: "POST", body: {} });
  }

  async setPinned(threadId, pinned) {
    return this.request(`/threads/${encodeURIComponent(threadId)}/pin`, { method: "POST", body: { pinned: Boolean(pinned) } });
  }

  async getGoal(threadId) {
    return this.request(`/threads/${encodeURIComponent(threadId)}/goal`);
  }

  async setGoal(threadId, goal) {
    return this.request(`/threads/${encodeURIComponent(threadId)}/goal`, { method: "PUT", body: goal || {} });
  }

  async clearGoal(threadId) {
    return this.request(`/threads/${encodeURIComponent(threadId)}/goal`, { method: "DELETE" });
  }

  async compactThread(threadId) {
    return this.request(`/threads/${encodeURIComponent(threadId)}/compact`, { method: "POST", body: {} });
  }

  async branchThread(threadId, options = {}) {
    return this.request(`/threads/${encodeURIComponent(threadId)}/branch`, { method: "POST", body: options });
  }

  async respondToApproval(payload) {
    return this.request("/approval", { method: "POST", body: payload || {} });
  }

  async cancelQueuedSend(payload) {
    return this.request("/queue/cancel", { method: "POST", body: payload || {} });
  }

  async steerQueuedSend(payload) {
    return this.request("/queue/steer", { method: "POST", body: payload || {} });
  }

  async changeSignature(threadId) {
    const data = await this.getMessages(threadId, { limit: 1 });
    const lastMessage = data.messages.at(-1) || {};
    return [
      data.thread?.updatedAtMs || 0,
      data.status?.state || "",
      data.status?.turnId || "",
      data.totalMessages ?? data.messages.length,
      lastMessage.lineNumber ?? lastMessage.timestamp ?? ""
    ].join("|");
  }
}

export function createHttpBackend(options) {
  return new HttpBackendClient(options);
}
