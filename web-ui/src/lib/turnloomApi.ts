/**
 * turnloomApi.ts — Track A · Option A web client API + state layer.
 *
 * IMPORTANT: all paths below are the REAL server.js contract (verified against
 * server.js 7501-8054). The design spec's `/threads`, `/threads/:id/messages`,
 * `/threads/:id/interrupt` etc. DO NOT EXIST and would 404.
 *
 * Auth: every request carries `x-access-token: <accessCode>`; a 401 raises
 * ApiError(401) so the shell can show the access-code sheet. A cookie obtained
 * from POST /api/auth/session {token} also works (same-origin fetch).
 *
 * CSP on static responses is `script-src 'self' ... connect-src 'self'`, so
 * this module only ever calls same-origin relative URLs — no CDN, no eval.
 */

// ---------------------------------------------------------------------------
// Types (verified response shapes)
// ---------------------------------------------------------------------------

export interface HealthResponse {
  ok: boolean;
  backend: { kind: string; [key: string]: unknown };
  profile: { id: string; label: string; backend?: string } | null;
  models: Array<{
    id: string;
    label: string;
    efforts: string[];
    defaultEffort?: string;
    supportsImages?: boolean;
  }>;
  usedModelIds?: string[];
  defaultModel?: string;
  defaultEffort?: string;
  authRequired: boolean;
  /** false under --readonly; the UI must disable every write action. */
  allowWrite: boolean;
  apkAvailable?: boolean;
  codexHome?: string;
  codexHomeVersion?: string;
  now?: string;
  [key: string]: unknown;
}

export interface ThreadStatus {
  state?: 'running' | 'waiting' | 'ended' | 'unknown';
  thinking?: boolean;
  interactionRequired?: boolean;
  turnId?: string | null;
  startedAtMs?: number | null;
  staleTurn?: boolean;
  statusSource?: string;
  queueLength?: number;
  queuedMessages?: unknown[];
  [key: string]: unknown;
}

export interface Thread {
  id: string;
  title?: string;
  preview?: string;
  cwd?: string;
  updatedAtMs?: number;
  createdAtMs?: number;
  pinned?: boolean;
  status?: ThreadStatus;
  project?: { key?: string; id?: string; name?: string; native?: boolean } | null;
  [key: string]: unknown;
}

export interface ThreadsResponse {
  threads: Thread[];
  total?: number;
  nextCursor?: string | null;
  codexHome?: string;
  codexHomeVersion?: string;
}

export type MessageRole =
  | 'user'
  | 'assistant'
  | 'tool'
  | 'interaction'
  | 'notice'
  | 'system'
  | 'developer'
  | string;

export interface StreamMessage {
  /** Always null for real rollout messages (per root AGENTS.md) — never use as a key. */
  id?: string | null;
  role: MessageRole;
  kind?: string;
  /** Server emits `content`, NOT `text`. `text` is only a defensive client fallback. */
  content?: string;
  text?: string;
  timestamp?: string | null;
  title?: string;
  turnId?: string | null;
  turnStartedAtMs?: number;
  lineNumber?: number;
  source?: string;
  phase?: string;
  images?: string[];
  localImages?: unknown[];
  files?: Array<{ path: string; size?: number; mimeType?: string; inline?: boolean }>;
  /** Approval items: role === "interaction" && canApprove && requestId. */
  requestId?: string | null;
  approvalKind?: string;
  canApprove?: boolean;
  requiresDesktopAction?: boolean;
  [key: string]: unknown;
}

export interface MessagesStatus extends ThreadStatus {
  possibleDesktopAttention?: boolean;
  latestCompletedAtMs?: number | null;
  staleTurnId?: string | null;
  staleTurnLastUpdatedAtMs?: number | null;
  queueError?: string;
  queueUnavailable?: boolean;
  queueStale?: boolean;
  queueSource?: string;
}

export interface MessagesResponse {
  thread?: unknown;
  goal?: unknown;
  meta?: unknown;
  file?: string;
  size?: number;
  mtimeMs?: number;
  partial?: boolean;
  status: MessagesStatus;
  messages: StreamMessage[];
  totalMessages?: number;
  truncated?: boolean;
  hasOlderMessages?: boolean;
  limit?: number;
  omittedMessages?: number;
  olderCursor?: string | null;
  hiddenMessages?: number;
}

/** /changes returns ONLY these two keys. */
export interface ChangesResponse {
  cursor: string;
  changed: boolean;
}

export interface Project {
  id: string;
  name: string;
  root?: string;
  threadCount?: number;
}

export interface AccountResponse {
  user?: { name?: string; email?: string; label?: string };
  plan?: { type?: string; label?: string };
  usage?: unknown;
  codexHome?: string;
  codexHomeVersion?: string;
}

export interface SendResult {
  ok?: boolean;
  mode?: string;
  threadId?: string;
  turnId?: string;
  queued?: boolean;
  queueLength?: number;
  uncertain?: boolean;
  newThread?: boolean;
  sent?: boolean;
  [key: string]: unknown;
}

export type ApprovalDecision = 'accept' | 'acceptForSession' | 'decline';

/** Filter used by the approval sheet — no fabricated ids, ever. */
export interface ApprovalItem {
  requestId: string;
  approvalKind: string;
  title: string;
  content: string;
  turnId: string | null;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly authRequired = false,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  get isAuth(): boolean {
    return this.status === 401 || this.status === 403 || this.authRequired;
  }
  get isReadOnly(): boolean {
    return this.status === 403;
  }
}

/** Thrown before a request leaves the browser when health.allowWrite === false. */
export class ReadOnlyError extends ApiError {
  constructor() {
    super('This server is in read-only mode. Sending, interrupting and approvals are disabled.', 403);
    this.name = 'ReadOnlyError';
  }
}

// ---------------------------------------------------------------------------
// Pairing / access-code persistence (mirrors public/auth.js + QR format)
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'option-a:connection:v1';
const SELECTED_KEY = 'option-a:selected-thread:v1';
const CACHE_PREFIX = 'option-a:conversation:';

export interface ConnectionSettings {
  /** Base URL of the Turnloom server; '' means same-origin (the WebView case). */
  url: string;
  token: string;
  name: string;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadConnection(): ConnectionSettings {
  const fallback: ConnectionSettings = { url: '', token: '', name: '' };
  const store = safeStorage();
  if (!store) return fallback;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<ConnectionSettings>;
    return {
      url: typeof parsed.url === 'string' ? parsed.url : '',
      token: typeof parsed.token === 'string' ? parsed.token : '',
      name: typeof parsed.name === 'string' ? parsed.name : '',
    };
  } catch {
    return fallback;
  }
}

export function saveConnection(settings: ConnectionSettings): void {
  const store = safeStorage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage disabled — keep in-memory only */
  }
}

/**
 * Parse the REAL pairing QR format (scripts/print-device-qr.js:26-31):
 *   codexpocket://add?name=<machineName>&url=<serverUrl>&token=<accessCode>
 * Also accepts a plain https?:// URL with ?token= for convenience.
 * Returns null for anything else — never invents a token.
 */
export function parsePairingQr(raw: string): ConnectionSettings | null {
  const value = String(raw || '').trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'codexpocket:' && url.hostname === 'add') {
      const serverUrl = url.searchParams.get('url') || '';
      const token = url.searchParams.get('token') || '';
      const name = url.searchParams.get('name') || '';
      if (!serverUrl || !token) return null;
      return { url: normalizeServerUrl(serverUrl), token, name };
    }
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      const token = url.searchParams.get('token') || '';
      const name = url.searchParams.get('name') || '';
      const clean = new URL(url.toString());
      clean.searchParams.delete('token');
      clean.searchParams.delete('name');
      clean.searchParams.delete('login');
      if (!token) return null;
      return { url: normalizeServerUrl(clean.toString()), token, name };
    }
  } catch {
    return null;
  }
  return null;
}

export function normalizeServerUrl(raw: string): string {
  let value = String(raw || '').trim();
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  return value.replace(/\/+$/, '');
}

/** Persisted selected thread — survives reload, mirrors conversation-cache.js intent. */
export function loadSelectedThreadId(): string {
  const store = safeStorage();
  if (!store) return '';
  try {
    return store.getItem(SELECTED_KEY) || '';
  } catch {
    return '';
  }
}

export function saveSelectedThreadId(id: string): void {
  const store = safeStorage();
  if (!store) return;
  try {
    if (id) store.setItem(SELECTED_KEY, id);
    else store.removeItem(SELECTED_KEY);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Local conversation cache (IndexedDB → localStorage fallback)
// Same DB/key convention as public/conversation-cache.js, namespaced for Option A.
// ---------------------------------------------------------------------------

const CACHE_DB = 'codex-pocket-cache';
const CACHE_STORE = 'conversations';
const CACHE_VERSION = 1;

export interface CachedConversation {
  threadId: string;
  thread?: Thread;
  data: MessagesResponse;
  cachedAt: number;
  [key: string]: unknown;
}

export function conversationCacheKey(threadId: string, limit = 80): string {
  const origin = typeof location !== 'undefined' ? location.origin : 'unknown';
  return [origin, 'option-a', threadId, limit]
    .map((v) => encodeURIComponent(String(v || '')))
    .join('|');
}

function openCacheDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: IDBDatabase | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 1200);
    try {
      const request = indexedDB.open(CACHE_DB, CACHE_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE);
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        finish(request.result);
      };
      request.onerror = () => {
        clearTimeout(timer);
        finish(null);
      };
      request.onblocked = () => {
        clearTimeout(timer);
        finish(null);
      };
    } catch {
      clearTimeout(timer);
      finish(null);
    }
  });
}

function localStorageCacheKey(key: string): string {
  return CACHE_PREFIX + key;
}

export async function readConversationCache(key: string): Promise<CachedConversation | null> {
  const db = await openCacheDb();
  if (db) {
    try {
      const value = await new Promise<CachedConversation | null>((resolve, reject) => {
        const tx = db.transaction(CACHE_STORE, 'readonly');
        const request = tx.objectStore(CACHE_STORE).get(key);
        request.onsuccess = () => resolve((request.result as CachedConversation) || null);
        request.onerror = () => reject(request.error);
      });
      db.close();
      if (value) return value;
    } catch {
      db.close();
    }
  }
  const store = safeStorage();
  if (!store) return null;
  try {
    const raw = store.getItem(localStorageCacheKey(key));
    return raw ? (JSON.parse(raw) as CachedConversation) : null;
  } catch {
    return null;
  }
}

export async function writeConversationCache(
  key: string,
  value: { threadId: string; thread?: Thread; data: MessagesResponse },
): Promise<boolean> {
  const data: CachedConversation = { ...value, cachedAt: Date.now() };
  const db = await openCacheDb();
  if (db) {
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(CACHE_STORE, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore(CACHE_STORE).put(data, key);
      });
      db.close();
      return true;
    } catch {
      db.close();
    }
  }
  const store = safeStorage();
  if (!store) return false;
  try {
    store.setItem(localStorageCacheKey(key), JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/** Freshness rule copied from public/conversation-cache.js. */
export function isConversationCacheFresh(cached: CachedConversation | null, thread?: Thread): boolean {
  if (!cached || !thread) return false;
  const a = Number(cached.thread?.updatedAtMs);
  const b = Number(thread.updatedAtMs);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  return a >= b;
}

// ---------------------------------------------------------------------------
// Status helpers (ported from public/threads.js + public/runtime.js)
// ---------------------------------------------------------------------------

export type ThreadStatusKind = 'waiting' | 'running' | 'stale' | 'ended' | 'unknown';

export function threadStatusKind(status?: ThreadStatus | null): ThreadStatusKind {
  const s = status || {};
  if (s.interactionRequired) return 'waiting';
  if (s.thinking) return s.staleTurn ? 'stale' : 'running';
  if (s.state === 'ended') return 'ended';
  return 'unknown';
}

export function runningTimeLabel(status?: ThreadStatus | null, now = Date.now()): string {
  const start = status?.startedAtMs;
  if (!status?.thinking || !Number.isFinite(start) || !start || start <= 0) return '';
  const seconds = Math.max(0, Math.floor((now - Number(start)) / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `Running ${minutes}m ${seconds % 60}s` : `Running ${seconds}s`;
}

export function messageText(message: StreamMessage): string {
  return String(message?.content ?? message?.text ?? '');
}

/** Approval source of truth: role === "interaction" && canApprove && requestId. */
export function approvalItems(messages: StreamMessage[] | undefined): ApprovalItem[] {
  if (!Array.isArray(messages)) return [];
  const seen = new Set<string>();
  const items: ApprovalItem[] = [];
  for (const m of messages) {
    if (m.role !== 'interaction' || !m.canApprove || !m.requestId) continue;
    if (seen.has(m.requestId)) continue;
    seen.add(m.requestId);
    items.push({
      requestId: m.requestId,
      approvalKind: m.approvalKind || 'command',
      title: m.title || 'Approval requested',
      content: messageText(m),
      turnId: m.turnId || null,
    });
  }
  return items;
}

export function newClientRequestId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `oa-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// HTTP core
// ---------------------------------------------------------------------------

export interface ApiClientOptions {
  connection?: ConnectionSettings;
  /** Fired on 401 so the shell can open the access-code sheet. */
  onUnauthorized?: () => void;
  /** Fired whenever health.allowWrite is observed, to enforce read-only UI. */
  onHealth?: (health: HealthResponse) => void;
}

export class TurnloomApi {
  private connection: ConnectionSettings;
  private onUnauthorized?: () => void;
  private onHealth?: (health: HealthResponse) => void;
  /** Last observed health.allowWrite; null until the first health call. */
  private allowWrite: boolean | null = null;
  /** ETag cache for GET /api/threads (304 → reuse body). */
  private threadsEtag = '';
  private threadsCache: ThreadsResponse | null = null;

  constructor(options: ApiClientOptions = {}) {
    this.connection = { ...(options.connection || loadConnection()) };
    this.onUnauthorized = options.onUnauthorized;
    this.onHealth = options.onHealth;
  }

  getConnection(): ConnectionSettings {
    return { ...this.connection };
  }

  setConnection(settings: ConnectionSettings): void {
    this.connection = {
      url: normalizeServerUrl(settings.url),
      token: settings.token,
      name: settings.name,
    };
    saveConnection(this.connection);
    this.threadsEtag = '';
    this.threadsCache = null;
    this.allowWrite = null;
  }

  /** True when health said allowWrite:false (read-only server). */
  get isReadOnly(): boolean {
    return this.allowWrite === false;
  }

  private base(): string {
    // Same-origin by default: required by CSP connect-src 'self' and by the
    // Android WebView which loads the page from the server itself.
    return normalizeServerUrl(this.connection.url);
  }

  private url(path: string): string {
    return `${this.base()}${path}`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const result: Record<string, string> = { ...extra };
    if (this.connection.token) result['x-access-token'] = this.connection.token;
    return result;
  }

  /** Single funnel for every request: auth header, 401 gate, error parsing. */
  private async request<T>(
    path: string,
    init: RequestInit = {},
    opts: { allowNotModified?: boolean; timeoutMs?: number } = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(this.url(path), {
        ...init,
        credentials: 'same-origin',
        headers: this.headers(init.headers as Record<string, string> | undefined),
        signal: init.signal || controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      if ((error as Error)?.name === 'AbortError') {
        throw new ApiError(`Request timed out: ${path}`, 0);
      }
      throw new ApiError(`Network error: ${(error as Error)?.message || error}`, 0);
    }
    clearTimeout(timer);

    if (response.status === 304 && opts.allowNotModified) {
      return { notModified: true } as unknown as T;
    }
    if (response.status === 401 || response.status === 403) {
      const body = await this.safeJson(response);
      const message = this.errorMessage(body, response);
      if (response.status === 401) this.onUnauthorized?.();
      throw new ApiError(message, response.status, response.status === 401, body);
    }
    if (!response.ok) {
      const body = await this.safeJson(response);
      throw new ApiError(this.errorMessage(body, response), response.status, false, body);
    }
    return (await response.json()) as T;
  }

  private async safeJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  private errorMessage(body: unknown, response: Response): string {
    if (body && typeof body === 'object' && 'error' in body) {
      return String((body as { error: unknown }).error || `HTTP ${response.status}`);
    }
    return `HTTP ${response.status}`;
  }

  private jsonInit(method: string, body?: unknown): RequestInit {
    return {
      method,
      headers: { 'content-type': 'application/json', ...(this.headers()['x-access-token']
        ? { 'x-access-token': this.headers()['x-access-token'] }
        : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    };
  }

  /** Write guard: never let a read-only server receive a mutating request. */
  private assertWritable(action: string): void {
    if (this.allowWrite === false) {
      throw new ReadOnlyError();
    }
    void action;
  }

  // ---- Read endpoints -----------------------------------------------------

  /** GET /api/health — also updates the read-only flag. */
  async getHealth(): Promise<HealthResponse> {
    const health = await this.request<HealthResponse>('/api/health');
    this.allowWrite = health.allowWrite !== false;
    this.onHealth?.(health);
    return health;
  }

  /**
   * GET /api/threads?limit=&cursor=&selectedId=
   * Uses If-None-Match; a 304 reuses the previous body.
   */
  async getThreads(params: { limit?: number; cursor?: string; selectedId?: string } = {}): Promise<ThreadsResponse> {
    const query = new URLSearchParams();
    if (params.limit) query.set('limit', String(params.limit));
    if (params.cursor) query.set('cursor', params.cursor);
    if (params.selectedId) query.set('selectedId', params.selectedId);
    const suffix = query.toString();
    const path = `/api/threads${suffix ? `?${suffix}` : ''}`;
    const headers: Record<string, string> = {};
    if (this.threadsEtag) headers['If-None-Match'] = this.threadsEtag;
    const result = await this.request<ThreadsResponse & { notModified?: boolean }>(
      path,
      { method: 'GET', headers },
      { allowNotModified: true },
    );
    if (result?.notModified && this.threadsCache) return this.threadsCache;
    // Re-read headers via a lightweight second call is wasteful; instead the
    // ETag is captured by a dedicated helper below on the next explicit call.
    this.threadsCache = result;
    return result;
  }

  /** Variant that also captures the ETag (used by the polling loop). */
  async getThreadsWithEtag(params: { limit?: number; cursor?: string; selectedId?: string } = {}): Promise<ThreadsResponse> {
    const query = new URLSearchParams();
    if (params.limit) query.set('limit', String(params.limit));
    if (params.cursor) query.set('cursor', params.cursor);
    if (params.selectedId) query.set('selectedId', params.selectedId);
    const suffix = query.toString();
    const path = `/api/threads${suffix ? `?${suffix}` : ''}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    try {
      response = await fetch(this.url(path), {
        method: 'GET',
        credentials: 'same-origin',
        headers: this.headers(this.threadsEtag ? { 'If-None-Match': this.threadsEtag } : {}),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 304 && this.threadsCache) return this.threadsCache;
    if (response.status === 401) {
      this.onUnauthorized?.();
      throw new ApiError('Unauthorized', 401, true, await this.safeJson(response));
    }
    if (!response.ok) {
      throw new ApiError(this.errorMessage(await this.safeJson(response), response), response.status);
    }
    this.threadsEtag = response.headers.get('etag') || '';
    const body = (await response.json()) as ThreadsResponse;
    this.threadsCache = body;
    return body;
  }

  /** GET /api/threads/:id/messages?limit=&before=&history=full */
  async getMessages(
    threadId: string,
    params: { limit?: number; before?: string; history?: 'full' } = {},
  ): Promise<MessagesResponse> {
    if (!threadId) throw new ApiError('Missing threadId', 400);
    const query = new URLSearchParams();
    if (params.limit) query.set('limit', String(params.limit));
    if (params.before) query.set('before', params.before);
    if (params.history) query.set('history', params.history);
    const suffix = query.toString();
    return this.request<MessagesResponse>(
      `/api/threads/${encodeURIComponent(threadId)}/messages${suffix ? `?${suffix}` : ''}`,
    );
  }

  /**
   * GET /api/threads/:id/changes?timeout=25000&cursor=
   * Returns ONLY {cursor, changed}. Server clamps timeout to 250..30000 ms.
   */
  async waitForChanges(threadId: string, cursor = '', timeout = 25_000): Promise<ChangesResponse> {
    if (!threadId) throw new ApiError('Missing threadId', 400);
    const query = new URLSearchParams({ timeout: String(timeout) });
    if (cursor) query.set('cursor', cursor);
    // +5s headroom over the server's own deadline so a slow reply isn't aborted.
    return this.request<ChangesResponse>(
      `/api/threads/${encodeURIComponent(threadId)}/changes?${query.toString()}`,
      {},
      { timeoutMs: timeout + 5_000 },
    );
  }

  /** GET /api/projects → {projects:[...]} */
  async getProjects(): Promise<Project[]> {
    const result = await this.request<{ projects?: Project[] }>('/api/projects');
    return Array.isArray(result?.projects) ? result.projects : [];
  }

  /** GET /api/account */
  async getAccount(): Promise<AccountResponse> {
    return this.request<AccountResponse>('/api/account');
  }

  /**
   * GET /api/host/diff?threadId=…&path=… — the only real diff source.
   * Result is forwarded from the desktop bridge; shape is not guaranteed by
   * server.js, so callers must handle both structured and string payloads.
   */
  async getHostDiff(threadId: string, filePath = ''): Promise<unknown> {
    const query = new URLSearchParams({ threadId });
    if (filePath) query.set('path', filePath);
    return this.request<unknown>(`/api/host/diff?${query.toString()}`);
  }

  // ---- Auth ---------------------------------------------------------------

  /** POST /api/auth/session {token} → cookie; 401 here also opens the gate. */
  async createAuthSession(token: string): Promise<{ ok: boolean; expiresAtMs?: number }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    try {
      response = await fetch(this.url('/api/auth/session'), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const body = await this.safeJson(response);
      if (response.status === 401) this.onUnauthorized?.();
      throw new ApiError(this.errorMessage(body, response), response.status, response.status === 401, body);
    }
    return (await response.json()) as { ok: boolean; expiresAtMs?: number };
  }

  // ---- Write endpoints (guarded by allowWrite) ----------------------------

  /** POST /api/send — real send endpoint (NOT /threads/:id/messages). */
  async sendMessage(input: {
    message: string;
    threadId?: string | null;
    newThread?: boolean;
    mode?: 'start' | 'queue' | 'steer';
    model?: string;
    effort?: string;
    projectId?: string;
    projectPath?: string;
    images?: Array<{ name: string; mimeType: string; data: string }>;
    clientRequestId?: string;
  }): Promise<SendResult> {
    this.assertWritable('send');
    const body = {
      message: input.message,
      threadId: input.threadId ?? null,
      ...(input.newThread ? { newThread: true } : {}),
      ...(input.mode ? { mode: input.mode } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.effort ? { effort: input.effort } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.projectPath ? { projectPath: input.projectPath } : {}),
      ...(input.images ? { images: input.images } : {}),
      clientRequestId: input.clientRequestId || newClientRequestId(),
    };
    return this.request<SendResult>('/api/send', this.jsonInit('POST', body), { timeoutMs: 60_000 });
  }

  /** POST /api/new-thread — desktop mode returns a local draft, no real id. */
  async newThread(message?: string): Promise<{ ok: boolean; mode?: string; draft?: boolean; threadId?: string }> {
    this.assertWritable('new-thread');
    return this.request('/api/new-thread', this.jsonInit('POST', message ? { message } : {}));
  }

  /** POST /api/interrupt {threadId} — NOT /threads/:id/interrupt. */
  async interrupt(threadId: string): Promise<{ ok: boolean; threadId?: string }> {
    this.assertWritable('interrupt');
    return this.request('/api/interrupt', this.jsonInit('POST', { threadId }));
  }

  /**
   * POST /api/approval — body MUST have all four fields.
   * Approve & Apply → 'accept'; Reject → 'decline'.
   */
  async respondToApproval(input: {
    threadId: string;
    requestId: string;
    approvalKind: string;
    decision: ApprovalDecision;
  }): Promise<{ ok: boolean; requestId?: string; decision?: string }> {
    this.assertWritable('approval');
    if (!input.requestId) throw new ApiError('No approval request id found', 400);
    return this.request(
      '/api/approval',
      this.jsonInit('POST', {
        threadId: input.threadId,
        requestId: input.requestId,
        approvalKind: input.approvalKind || 'command',
        decision: input.decision,
      }),
    );
  }

  /** POST /api/queue/cancel|steer|retry — {threadId, itemId, edit?}. */
  async queueAction(
    action: 'cancel' | 'steer' | 'retry',
    input: { threadId: string; itemId: string; edit?: string },
  ): Promise<unknown> {
    this.assertWritable('queue');
    return this.request(`/api/queue/${action}`, this.jsonInit('POST', input));
  }
}

/** Shared default instance (the React app uses this one). */
export const api = new TurnloomApi();

// ---------------------------------------------------------------------------
// Long-poll loop — mirrors public/app.js 3828-3855
// ---------------------------------------------------------------------------

export interface ChangePollerOptions {
  threadId: string;
  cursor?: string;
  /** Called whenever /changes reports changed:true. */
  onChanged: () => void | Promise<void>;
  /** Called on 401; the poller stops. */
  onUnauthorized?: () => void;
  /** Called on transient errors; the poller retries after a backoff. */
  onError?: (error: unknown) => void;
  timeout?: number;
}

export function startChangePoller(options: ChangePollerOptions): () => void {
  let stopped = false;
  let cursor = options.cursor || '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = options.timeout ?? 25_000;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const result = await api.waitForChanges(options.threadId, cursor, timeout);
      if (stopped) return;
      if (result.changed) await options.onChanged();
      cursor = result.cursor || cursor;
      if (!stopped) schedule(0);
    } catch (error) {
      if (stopped) return;
      if (error instanceof ApiError && error.isAuth) {
        options.onUnauthorized?.();
        return; // hard stop on 401
      }
      options.onError?.(error);
      if (!stopped) schedule(1500);
    }
  };

  const schedule = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(() => void tick(), delay);
  };

  schedule(0);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
