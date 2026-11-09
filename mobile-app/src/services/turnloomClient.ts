/**
 * Turnloom HTTP client — the ONLY place in the app that knows the real server
 * routes. Every path here was verified against server.js (see
 * server.js). The spec's
 * `/threads`, `/threads/:id/messages`, `/threads/:id/interrupt` DO NOT exist.
 *
 * Endpoint map (client function -> real endpoint):
 *   getHealth               GET  /api/health
 *   exchangeAuthSession     POST /api/auth/session
 *   getThreads              GET  /api/threads
 *   getMessages             GET  /api/threads/:id/messages
 *   waitForChanges          GET  /api/threads/:id/changes
 *   sendMessage             POST /api/send
 *   createThread            POST /api/new-thread
 *   interrupt               POST /api/interrupt
 *   respondToApproval       POST /api/approval
 *   getProjects             GET  /api/projects
 *   getAccount              GET  /api/account
 *   getHostDiff             GET  /api/host/diff
 *   cancelQueuedSend        POST /api/queue/cancel
 *   steerQueuedSend         POST /api/queue/steer
 *   retryQueuedSend         POST /api/queue/retry
 *   setThreadPinned         POST /api/threads/:id/pin
 *
 * Auth: `x-access-token` on every request (public/app.js authHeaders()).
 * 401 -> onAuthRequired listener -> the UI shows the access-code gate.
 * `allowWrite: false` (health) disables ALL write operations locally.
 */
import { clearPairing, readPairing, updateAccessToken, type PairingConfig } from './pairing';
import type {
  AccountResponse,
  ApprovalDecision,
  ApprovalResult,
  ChangesResponse,
  HealthResponse,
  HostDiffResponse,
  MessagesResponse,
  NewThreadResult,
  PluginsResponse,
  ProjectsResponse,
  SendMode,
  SendResult,
  SkillsResponse,
  ThreadsResponse,
} from './types';

export class AuthRequiredError extends Error {
  constructor(message = '需要访问码，请重新输入') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

export class ReadOnlyError extends Error {
  constructor(message = '服务器处于只读模式，写操作已禁用') {
    super(message);
    this.name = 'ReadOnlyError';
  }
}

export class TurnloomHttpError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(status: number, message: string, payload: unknown) {
    super(message);
    this.name = 'TurnloomHttpError';
    this.status = status;
    this.payload = payload;
  }
}

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  /** Per-request timeout. Long polls pass a larger value. */
  timeoutMs?: number;
  /** External cancellation (e.g. screen unmount / stop polling). */
  signal?: AbortSignal;
  /** Conditional GET for /api/threads (If-None-Match). */
  ifNoneMatch?: string;
};

export type RequestResult<T> = {
  data: T;
  status: number;
  etag: string | null;
};

type AuthListener = (message: string) => void;
type ConfigListener = (config: PairingConfig | null) => void;

const DEFAULT_TIMEOUT_MS = 12_000;
const LONG_POLL_TIMEOUT_MS = 32_000;

function uuid(): string {
  const globalCrypto = globalThis.crypto;
  if (globalCrypto && typeof globalCrypto.randomUUID === 'function') return globalCrypto.randomUUID();
  // RFC4122-ish fallback for engines without randomUUID.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function buildUrl(serverUrl: string, path: string, query?: RequestOptions['query']): string {
  const base = serverUrl.replace(/\/+$/, '');
  const url = new URL(base + path);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value === null || value === undefined || value === '') return;
      url.searchParams.set(key, String(value));
    });
  }
  return url.toString();
}

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const value = (payload as { error?: unknown }).error;
    if (typeof value === 'string' && value.trim()) return value;
  }
  return fallback;
}

let sharedClient: TurnloomClient | null = null;

export class TurnloomClient {
  private config: PairingConfig | null = null;
  private allowWrite: boolean | null = null;
  private authListeners = new Set<AuthListener>();
  private configListeners = new Set<ConfigListener>();

  /** Load persisted pairing once at startup. */
  async load(): Promise<PairingConfig | null> {
    this.config = await readPairing();
    this.configListeners.forEach((listener) => listener(this.config));
    return this.config;
  }

  getConfig(): PairingConfig | null {
    return this.config;
  }

  isReadOnly(): boolean {
    return this.allowWrite === false;
  }

  onAuthRequired(listener: AuthListener): () => void {
    this.authListeners.add(listener);
    return () => this.authListeners.delete(listener);
  }

  onConfigChange(listener: ConfigListener): () => void {
    this.configListeners.add(listener);
    return () => this.configListeners.delete(listener);
  }

  /** Re-read after pairing / access-code updates. */
  async refreshConfig(): Promise<PairingConfig | null> {
    return this.load();
  }

  async setAccessToken(token: string): Promise<void> {
    await updateAccessToken(token);
    await this.load();
  }

  async signOut(): Promise<void> {
    await clearPairing();
    this.allowWrite = null;
    await this.load();
  }

  private endpoint(path: string): string {
    if (!this.config?.serverUrl) throw new Error('尚未配对电脑节点，请先扫码或输入服务器地址');
    return path;
  }

  /** Core fetch: token header, timeout via AbortController, 401/403/304 handling. */
  async request<T>(path: string, options: RequestOptions = {}): Promise<RequestResult<T>> {
    const config = this.config;
    if (!config) throw new Error('尚未配对电脑节点，请先扫码或输入服务器地址');

    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abortFromParent = () => controller.abort();
    if (options.signal) {
      if (options.signal.aborted) controller.abort();
      else options.signal.addEventListener('abort', abortFromParent, { once: true });
    }

    const headers: Record<string, string> = {
      accept: 'application/json',
    };
    if (config.token) headers['x-access-token'] = config.token;
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (options.ifNoneMatch) headers['if-none-match'] = options.ifNoneMatch;

    try {
      const response = await fetch(
        buildUrl(config.serverUrl, path, options.query),
        {
          method: options.method ?? 'GET',
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: controller.signal,
        }
      );

      const etag = response.headers.get('etag');
      if (response.status === 304) {
        return { data: undefined as T, status: 304, etag };
      }

      let payload: unknown = null;
      const text = await response.text();
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = text;
        }
      }

      if (response.status === 401) {
        const message = errorMessage(payload, '需要访问码');
        this.authListeners.forEach((listener) => listener(message));
        throw new AuthRequiredError(message);
      }
      if (!response.ok) {
        throw new TurnloomHttpError(
          response.status,
          errorMessage(payload, `网络请求失败（HTTP ${response.status}）`),
          payload
        );
      }
      return { data: payload as T, status: response.status, etag };
    } catch (error) {
      if (controller.signal.aborted && !(error instanceof AuthRequiredError)) {
        const aborted = new Error('请求超时或已取消');
        aborted.name = 'AbortError';
        throw aborted;
      }
      throw error;
    } finally {
      clearTimeout(timer);
      if (options.signal) options.signal.removeEventListener('abort', abortFromParent);
    }
  }

  /** Read-only gate for every mutating endpoint. */
  private requireWritable(): void {
    if (this.allowWrite === false) throw new ReadOnlyError();
  }

  // ------------------------------------------------------------------ reads

  async getHealth(options?: Pick<RequestOptions, 'signal' | 'timeoutMs'>): Promise<HealthResponse> {
    const { data } = await this.request<HealthResponse>(this.endpoint('/api/health'), {
      ...options,
    });
    this.allowWrite = data?.allowWrite !== false;
    return data;
  }

  async getThreads(options?: {
    limit?: number;
    cursor?: string;
    selectedId?: string;
    ifNoneMatch?: string;
    signal?: AbortSignal;
  }): Promise<RequestResult<ThreadsResponse>> {
    return this.request<ThreadsResponse>(this.endpoint('/api/threads'), {
      query: {
        limit: options?.limit,
        cursor: options?.cursor,
        selectedId: options?.selectedId,
      },
      ifNoneMatch: options?.ifNoneMatch,
      signal: options?.signal,
    });
  }

  async getMessages(
    threadId: string,
    options?: { limit?: number; before?: string; history?: 'full'; signal?: AbortSignal }
  ): Promise<MessagesResponse> {
    if (!/^[0-9a-fA-F-]{20,}$/.test(threadId)) {
      throw new Error('无效的会话 id');
    }
    const { data } = await this.request<MessagesResponse>(
      this.endpoint(`/api/threads/${encodeURIComponent(threadId)}/messages`),
      {
        query: {
          limit: options?.limit,
          before: options?.before,
          history: options?.history,
        },
        signal: options?.signal,
      }
    );
    return data;
  }

  /**
   * Long poll. Server clamps timeout to 250..30000 ms and returns
   * `{ cursor, changed }` only. Callers must re-fetch messages ONLY on changed.
   */
  async waitForChanges(
    threadId: string,
    options?: { cursor?: string; timeoutMs?: number; signal?: AbortSignal }
  ): Promise<ChangesResponse> {
    if (!/^[0-9a-fA-F-]{20,}$/.test(threadId)) {
      throw new Error('无效的会话 id');
    }
    const { data } = await this.request<ChangesResponse>(
      this.endpoint(`/api/threads/${encodeURIComponent(threadId)}/changes`),
      {
        query: {
          cursor: options?.cursor || '',
          timeout: Math.min(30_000, Math.max(250, options?.timeoutMs ?? 25_000)),
        },
        timeoutMs: LONG_POLL_TIMEOUT_MS,
        signal: options?.signal,
      }
    );
    return { cursor: String(data?.cursor ?? ''), changed: Boolean(data?.changed) };
  }

  async getProjects(options?: Pick<RequestOptions, 'signal'>): Promise<ProjectsResponse> {
    const { data } = await this.request<ProjectsResponse>(this.endpoint('/api/projects'), options);
    return data;
  }

  /** 宿主已安装插件（原版 public/app.js 的 loadPlugins 同一接口）。 */
  async getPlugins(options?: Pick<RequestOptions, 'signal'>): Promise<PluginsResponse> {
    const { data } = await this.request<PluginsResponse>(this.endpoint('/api/plugins'), options);
    return data;
  }

  /** 技能目录（含 builtin 操作；引用时 builtin 不写进 "Use skill" 行，与原版一致）。 */
  async getSkills(options?: Pick<RequestOptions, 'signal'>): Promise<SkillsResponse> {
    const { data } = await this.request<SkillsResponse>(this.endpoint('/api/skills'), options);
    return data;
  }

  async getAccount(options?: Pick<RequestOptions, 'signal'>): Promise<AccountResponse> {
    const { data } = await this.request<AccountResponse>(this.endpoint('/api/account'), options);
    return data;
  }

  /** Git diff data source. Never parsed out of message.content. */
  async getHostDiff(
    threadId: string,
    options?: { path?: string; signal?: AbortSignal }
  ): Promise<HostDiffResponse> {
    const { data } = await this.request<HostDiffResponse>(this.endpoint('/api/host/diff'), {
      query: { threadId, path: options?.path },
      signal: options?.signal,
    });
    return data;
  }

  // ----------------------------------------------------------------- writes

  /** Posts the token to obtain a session cookie; not auth-gated by the server. */
  async exchangeAuthSession(token: string): Promise<unknown> {
    const { data } = await this.request<unknown>(this.endpoint('/api/auth/session'), {
      method: 'POST',
      body: { token },
    });
    return data;
  }

  async sendMessage(args: {
    message: string;
    threadId?: string | null;
    newThread?: boolean;
    mode?: SendMode;
    model?: string;
    effort?: string;
    projectId?: string;
    projectPath?: string;
    images?: Array<{ name: string; mimeType: string; data: string }>;
    clientRequestId?: string;
  }): Promise<SendResult> {
    this.requireWritable();
    const { data } = await this.request<SendResult>(this.endpoint('/api/send'), {
      method: 'POST',
      body: {
        message: args.message,
        threadId: args.threadId ?? null,
        newThread: Boolean(args.newThread),
        mode: args.mode ?? 'start',
        model: args.model,
        effort: args.effort,
        projectId: args.projectId,
        projectPath: args.projectPath,
        images: args.newThread ? undefined : args.images,
        // 5-minute idempotency; a fresh UUID per send is mandatory.
        clientRequestId: args.clientRequestId ?? uuid(),
      },
    });
    return data;
  }

  /** Desktop mode returns a local draft with NO threadId; never fabricate one. */
  async createThread(message?: string): Promise<NewThreadResult> {
    const { data } = await this.request<NewThreadResult>(this.endpoint('/api/new-thread'), {
      method: 'POST',
      body: message ? { message } : {},
    });
    return data;
  }

  async interrupt(threadId: string): Promise<{ ok?: boolean; threadId?: string }> {
    this.requireWritable();
    const { data } = await this.request<{ ok?: boolean; threadId?: string }>(
      this.endpoint('/api/interrupt'),
      { method: 'POST', body: { threadId } }
    );
    return data;
  }

  /** Approval body MUST contain all four fields. */
  async respondToApproval(args: {
    threadId: string;
    requestId: string;
    approvalKind: string;
    decision: ApprovalDecision;
  }): Promise<ApprovalResult> {
    this.requireWritable();
    if (!args.requestId) throw new Error('缺少审批 requestId，无法提交');
    const { data } = await this.request<ApprovalResult>(this.endpoint('/api/approval'), {
      method: 'POST',
      body: {
        threadId: args.threadId,
        requestId: args.requestId,
        approvalKind: args.approvalKind || 'command',
        decision: args.decision,
      },
    });
    return data;
  }

  /** itemId 省略时即清空该会话全部排队消息（与 public/app.js clearQueueButton 同契约）。 */
  async cancelQueuedSend(threadId: string, itemId?: string, edit?: boolean): Promise<unknown> {
    this.requireWritable();
    const { data } = await this.request(this.endpoint('/api/queue/cancel'), {
      method: 'POST',
      body: { threadId, ...(itemId ? { itemId } : {}), ...(edit ? { edit: true } : {}) },
    });
    return data;
  }

  async steerQueuedSend(threadId: string, itemId: string): Promise<unknown> {
    this.requireWritable();
    const { data } = await this.request(this.endpoint('/api/queue/steer'), {
      method: 'POST',
      body: { threadId, itemId },
    });
    return data;
  }

  async retryQueuedSend(threadId: string, itemId: string): Promise<unknown> {
    this.requireWritable();
    const { data } = await this.request(this.endpoint('/api/queue/retry'), {
      method: 'POST',
      body: { threadId, itemId },
    });
    return data;
  }

  async setThreadPinned(threadId: string, pinned: boolean): Promise<unknown> {
    this.requireWritable();
    const { data } = await this.request(
      this.endpoint(`/api/threads/${encodeURIComponent(threadId)}/pin`),
      { method: 'POST', body: { pinned } }
    );
    return data;
  }
}

export function getTurnloomClient(): TurnloomClient {
  if (!sharedClient) sharedClient = new TurnloomClient();
  return sharedClient;
}
