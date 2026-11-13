/**
 * Typed client for the shared /api/* protocol (repair 2.1).
 *
 * Android's file:// page cannot rely on cross-origin fetch, so requests are
 * executed by the native HTTP bridge. Each request carries an explicit routing
 * token in the x-access-token header; the token never enters a URL, a log or
 * an error message. The scope/generation pair makes late responses from a
 * previous machine or harness harmless, and native requests can be cancelled.
 */

import {
  nativeHttpRequest, cancelAllNativeRequests, hasNativeHttp,
  type NativeRequestHandle,
} from './nativeBridge';
import { normalizeBaseUrl } from './machinePairing';

export const API_ENDPOINTS = {
  harnesses: '/api/harnesses',
  health: '/api/health',
  authSession: '/api/auth/session',
  threads: '/api/threads',
  threadMessages: '/api/threads/:id/messages',
  threadChanges: '/api/threads/:id/changes',
  newThread: '/api/new-thread',
  send: '/api/send',
  interrupt: '/api/interrupt',
  approval: '/api/approval',
  hostDiff: '/api/host/diff',
  projects: '/api/projects',
  account: '/api/account',
  appUpdate: '/api/app/update',
  apk: '/api/apk',
  queueCancel: '/api/queue/cancel',
  queueSteer: '/api/queue/steer',
  queueRetry: '/api/queue/retry',
  queueImage: '/api/queue/image',
} as const;

export const ACCESS_TOKEN_HEADER = 'x-access-token';

export type ApiResult<T> =
  | { ok: true; status: number; data: T; offline: false }
  | { ok: false; status: number; error: string; offline: boolean };

export interface ThreadRuntimeStatusPayload {
  thinking?: boolean;
  interactionRequired?: boolean;
  staleTurn?: boolean;
  turnId?: string | null;
  startedAtMs?: number | null;
  [key: string]: unknown;
}

export interface ThreadStatus {
  state?: string;
  label?: string;
  running?: boolean;
  thinking?: boolean;
  interactionRequired?: boolean;
  staleTurn?: boolean;
  [key: string]: unknown;
}

export interface ModelCatalogEntry {
  id: string;
  label?: string;
  efforts?: string[];
  defaultEffort?: string;
  supportsImages?: boolean;

}

export interface ApiAttachment {
  name: string;
  mimeType: string;
  /** Plain base64. Native picker data URLs are stripped before sending. */
  data: string;
}
export interface SendOptions {
  message: string;
  clientRequestId: string;
  model?: string;
  effort?: string;
  images?: ApiAttachment[];
  files?: ApiAttachment[];
  threadId?: string;
  projectId?: string;
}

export interface MessagesEnvelope {
  thread?: ThreadSummary;
  messages?: ThreadMessage[];
  items?: ThreadMessage[];
  status?: ThreadRuntimeStatusPayload;
  [key: string]: unknown;
}

export interface HealthEnvelope extends HealthInfo {
  models?: ModelCatalogEntry[];
  defaultModel?: string;
  defaultEffort?: string;
}
export interface ThreadSummary {
  id: string;
  title?: string;
  name?: string;
  preview?: string;
  status?: ThreadStatus | string;
  updatedAt?: string | number;
  createdAt?: string | number;
  cwd?: string;
  projectId?: string;
  [key: string]: unknown;
}

export interface ThreadMessage {
  id?: string;
  role?: 'user' | 'assistant' | 'system' | string;
  text?: string;
  content?: string;
  createdAt?: string | number;
  kind?: string;
  [key: string]: unknown;
}

export interface ChangeEntry {
  path?: string;
  type?: string;
  status?: string;
  additions?: number;
  deletions?: number;
  [key: string]: unknown;
}

export interface QueueItem {
  id?: string;
  itemId?: string;
  threadId?: string;
  text?: string;
  state?: string;
  [key: string]: unknown;
}
export type QueueAction = 'cancel' | 'steer' | 'retry' | 'image';

export interface HealthInfo {
  ok?: boolean;
  authRequired?: boolean;
  version?: string;
  backend?: { kind?: string; url?: string; profile?: string | null } | null;
  [key: string]: unknown;
}

export interface AccountInfo {
  user?: { name?: string; email?: string; label?: string } | null;
  plan?: { type?: string; label?: string } | null;
  backend?: { kind?: string; url?: string } | null;
  [key: string]: unknown;
}

export interface ProjectInfo {
  id?: string;
  name?: string;
  path?: string;
  [key: string]: unknown;
}

export interface AppUpdateInfo {
  available: boolean;
  packageName: string;
  versionCode: number;
  versionName: string;
  apkUrl: string;
  sha256: string;
  sizeBytes: number;
  notes: string;
}

export interface DiscoveryEnvelope {
  ok?: boolean;
  protocol?: string;
  version?: number;
  machineId?: string;
  machineName?: string;
  defaultHarnessId?: string;
  harnesses?: unknown[];
  [key: string]: unknown;
}

export interface ConnectionTarget {
  origin: string;
  token: string;
}

export interface RequestContext {
  target: ConnectionTarget;
  scope: string;
  generation: number;
  timeoutMs?: number;
}

interface ClientConfig {
  baseUrl: string;
  token: string;
  timeoutMs: number;
}

const config: ClientConfig = { baseUrl: '', token: '', timeoutMs: 10_000 };
let authEpoch = 0;
let activeGeneration = 0;
let activeScope = '';
let unauthorizedHandler: ((epoch: number) => void) | null = null;
let networkStateHandler: ((online: boolean) => void) | null = null;

export function setUnauthorizedHandler(handler: ((epoch: number) => void) | null): void {
  unauthorizedHandler = handler;
}

export function setNetworkStateHandler(handler: ((online: boolean) => void) | null): void {
  networkStateHandler = handler;
}

/** Legacy global configuration is kept for callers that still use it. */
export function configureClient(patch: Partial<ClientConfig>): void {
  if (typeof patch.baseUrl === 'string') config.baseUrl = normalizeBaseUrl(patch.baseUrl);
  if (typeof patch.token === 'string') config.token = patch.token.trim();
  if (typeof patch.timeoutMs === 'number' && patch.timeoutMs > 0) config.timeoutMs = patch.timeoutMs;
}

export function getBaseUrl(): string { return config.baseUrl; }
export function hasToken(): boolean { return config.token.length > 0; }

/** Switch the active machine/harness generation and cancel obsolete requests. */
export function setActiveRequestScope(scope: string, target?: ConnectionTarget): void {
  activeScope = String(scope);
  activeGeneration += 1;
  authEpoch += 1;
  if (target) configureClient({ baseUrl: target.origin, token: target.token });
  cancelAllNativeRequests();
}

export function getActiveGeneration(): number { return activeGeneration; }
export function getActiveScope(): string { return activeScope; }

/** Read the currently configured target without exposing it in logs. */
export function getCurrentTarget(): ConnectionTarget {
  return { origin: config.baseUrl, token: config.token };
}

export function isCurrentContext(context: RequestContext): boolean {
  return context.scope === activeScope && context.generation === activeGeneration;
}

function fail<T>(status: number, error: string, offline: boolean): ApiResult<T> {
  return { ok: false, status, error, offline };
}

function endpointWithId(template: string, id: string): string {
  return template.replace(':id', encodeURIComponent(id));
}

function resolveUrl(origin: string, path: string, query?: Record<string, string | number | undefined>): string {
  const full = `${origin.replace(/\/+$/, '')}${path}`;
  if (!query) return full;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length ? `${full}?${parts.join('&')}` : full;
}

/** Strip server error fields that might accidentally include a token. */
function safeServerError(payload: unknown, status: number, transportError?: string): string {
  const body = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const candidate = typeof body.error === 'string' ? body.error : typeof body.message === 'string' ? body.message : '';
  if (/^[a-z0-9._:-]{1,80}$/i.test(candidate)) return candidate;
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 429) return 'rate-limited';
  if (status === 0) return transportError || 'OFFLINE';
  return `HTTP-${status}`;
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  timeoutMs?: number;
  /** Suppress global online/offline reporting for background or pre-pairing checks. */
  quiet?: boolean;
}

/**
 * Core native HTTP request. The returned handle lets the caller cancel it;
 * `requestWithContext` additionally rejects stale results at the store layer.
 */
export function startNativeRequest<T>(
  context: RequestContext,
  path: string,
  options: RequestOptions = {},
): { handle: NativeRequestHandle; promise: Promise<ApiResult<T>> } {
  const method = options.method || 'GET';
  const url = resolveUrl(normalizeBaseUrl(context.target.origin), path, options.query);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (context.target.token) headers[ACCESS_TOKEN_HEADER] = context.target.token;
  let body: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const requestHandle = nativeHttpRequest({
    url,
    method,
    headers,
    ...(body !== undefined ? { body } : {}),
    timeoutMs: options.timeoutMs ?? context.timeoutMs ?? config.timeoutMs,
  });
  const promise = requestHandle.promise.then((response): ApiResult<T> => {
    if (!isCurrentContext(context)) return fail<T>(0, 'stale-context', true);
    if (!hasNativeHttp()) {
      if (!options.quiet) networkStateHandler?.(false);
      return fail<T>(0, 'transport-unavailable', true);
    }
    if (response.status === 0) {
      if (!options.quiet) networkStateHandler?.(false);
      return fail<T>(0, response.error || 'OFFLINE', true);
    }
    let payload: unknown = null;
    if (response.body) {
      try { payload = JSON.parse(response.body); } catch { payload = null; }
    }
    if (response.status === 401) {
      if (isCurrentContext(context)) unauthorizedHandler?.(authEpoch);
      return fail<T>(401, 'unauthorized', false);
    }
    const success = response.status >= 200 && response.status < 300;
    if (!success) {
      if (!options.quiet) networkStateHandler?.(true);
      return fail<T>(response.status, safeServerError(payload, response.status, response.error), false);
    }
    if (!options.quiet) networkStateHandler?.(true);
    return { ok: true, status: response.status, data: payload as T, offline: false };
  });
  return { handle: requestHandle, promise };
}

export async function requestWithContext<T>(
  context: RequestContext,
  path: string,
  options: RequestOptions = {},
): Promise<ApiResult<T>> {
  if (!isCurrentContext(context)) return fail<T>(0, 'stale-context', true);
  const { handle, promise } = startNativeRequest<T>(context, path, options);
  const result = await promise;
  if (!isCurrentContext(context)) {
    handle.cancel();
    return fail<T>(0, 'stale-context', true);
  }
  return result;
}

/** Convenience request against the current active target (legacy callers). */
export async function request<T>(
  path: string,
  init: RequestInit = {},
  query?: Record<string, string | number | undefined>,
): Promise<ApiResult<T>> {
  const method = String(init.method || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET';
  let body: unknown;
  if (typeof init.body === 'string') {
    try { body = JSON.parse(init.body); } catch { body = {}; }
  }
  return requestWithContext<T>(
    { target: getCurrentTarget(), scope: activeScope, generation: activeGeneration },
    path,
    { method, ...(body !== undefined ? { body } : {}), ...(query ? { query } : {}) },
  );
}

function get<T>(context: RequestContext, path: string, query?: Record<string, string | number | undefined>, timeoutMs?: number): Promise<ApiResult<T>> {
  return requestWithContext<T>(context, path, { method: 'GET', ...(query ? { query } : {}), ...(timeoutMs ? { timeoutMs } : {}) });
}

function post<T>(context: RequestContext, path: string, body: unknown, timeoutMs?: number): Promise<ApiResult<T>> {
  return requestWithContext<T>(context, path, { method: 'POST', body, ...(timeoutMs ? { timeoutMs } : {}) });
}

/** One machine token is used only for this discovery request. */
export function discoverHarnesses(pairing: { serverUrl: string; machineToken: string }, scope: string): Promise<ApiResult<DiscoveryEnvelope>> {
  setActiveRequestScope(scope);
  return requestWithContext<DiscoveryEnvelope>(
    {
      target: { origin: pairing.serverUrl, token: pairing.machineToken },
      scope,
      generation: activeGeneration,
      timeoutMs: 10_000,
    },
    API_ENDPOINTS.harnesses,
    { quiet: true },
  );
}

/** Verify the selected harness token before any session is persisted. */
export function verifyHarness(target: ConnectionTarget, scope: string): Promise<ApiResult<HealthEnvelope>> {
  setActiveRequestScope(scope, target);
  return requestWithContext<HealthEnvelope>(
    { target, scope, generation: activeGeneration, timeoutMs: 10_000 },
    API_ENDPOINTS.health,
    { quiet: true },
  );
}

export const getHealth = (context: RequestContext): Promise<ApiResult<HealthEnvelope>> => get(context, API_ENDPOINTS.health);
export const postAuthSession = (context: RequestContext, body: { code?: string; token?: string; [key: string]: unknown }): Promise<ApiResult<{ ok?: boolean; token?: string }>> => post(context, API_ENDPOINTS.authSession, body);
export const getThreads = (context: RequestContext, params?: { limit?: number; cursor?: string; selectedId?: string }): Promise<ApiResult<{ threads?: ThreadSummary[]; total?: number; nextCursor?: string | null }>> => get(context, API_ENDPOINTS.threads, params);
export const getThreadMessages = (context: RequestContext, threadId: string, params?: { limit?: number; before?: string }): Promise<ApiResult<MessagesEnvelope>> => get(context, endpointWithId(API_ENDPOINTS.threadMessages, threadId), params);
export const getThreadChanges = (context: RequestContext, threadId: string): Promise<ApiResult<{ changes?: ChangeEntry[]; files?: ChangeEntry[]; cursor?: string; changed?: boolean; [key: string]: unknown }>> => get(context, endpointWithId(API_ENDPOINTS.threadChanges, threadId), { timeout: 250 }, 12_000);

/** Real new-thread / send responses: strictly require an id returned by the host. */
export function extractThreadId(data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const body = data as Record<string, unknown>;
  const thread = body.thread && typeof body.thread === 'object' && !Array.isArray(body.thread)
    ? body.thread as Record<string, unknown>
    : null;
  const result = body.result && typeof body.result === 'object' && !Array.isArray(body.result)
    ? body.result as Record<string, unknown>
    : null;
  const nestedResult = result?.result && typeof result.result === 'object' && !Array.isArray(result.result)
    ? result.result as Record<string, unknown>
    : null;
  const candidate = body.threadId ?? body.conversationId ?? body.id ??
    body.newThreadId ?? body.sessionId ?? thread?.id ?? result?.threadId ??
    result?.conversationId ?? nestedResult?.threadId ?? nestedResult?.conversationId;
  const id = typeof candidate === 'string' ? candidate.trim() : '';
  return id || null;
}

/** Both send routes carry the exact model/effort IDs and plain-base64 payloads. */
function sendBody(body: SendOptions, newThread: boolean): Record<string, unknown> {
  return {
    ...(newThread ? { newThread: true } : { threadId: String(body.threadId || '') }),
    message: body.message,
    clientRequestId: body.clientRequestId,
    ...(body.model ? { model: body.model } : {}),
    ...(body.effort ? { effort: body.effort } : {}),
    ...(body.projectId ? { projectId: body.projectId } : {}),
    images: body.images || [],
    files: body.files || [],
  };
}

/** The createThread flow uses /api/send with newThread:true on the native backend. */
export const postNewThread = (context: RequestContext, body: SendOptions): Promise<ApiResult<{ ok?: boolean; threadId?: string | null; [key: string]: unknown }>> =>
  post(context, API_ENDPOINTS.send, sendBody(body, true), 30_000);

export const postSend = (context: RequestContext, body: SendOptions): Promise<ApiResult<{ ok?: boolean; threadId?: string | null; [key: string]: unknown }>> =>
  post(context, API_ENDPOINTS.send, sendBody(body, false), 30_000);

export const postInterrupt = (context: RequestContext, body: { threadId: string }): Promise<ApiResult<{ ok?: boolean }>> => post(context, API_ENDPOINTS.interrupt, body);
export const postApproval = (context: RequestContext, body: { threadId: string; id: string; decision: 'approve' | 'reject'; approved: boolean }): Promise<ApiResult<{ ok?: boolean }>> => post(context, API_ENDPOINTS.approval, body);
export const getHostDiff = (context: RequestContext, params?: { threadId?: string; path?: string }): Promise<ApiResult<{ diff?: string; lines?: string[] }>> => get(context, API_ENDPOINTS.hostDiff, params);
export const getProjects = (context: RequestContext): Promise<ApiResult<{ projects?: ProjectInfo[] }>> => get(context, API_ENDPOINTS.projects);
export const getAccount = (context: RequestContext): Promise<ApiResult<AccountInfo>> => get(context, API_ENDPOINTS.account);
export const getAppUpdate = (context: RequestContext): Promise<ApiResult<AppUpdateInfo>> => get(context, API_ENDPOINTS.appUpdate, undefined, 12_000);

export const postQueueCancel = (context: RequestContext, body: { threadId?: string; itemId?: string; edit?: boolean }): Promise<ApiResult<QueueItem>> => post(context, API_ENDPOINTS.queueCancel, body);
export const postQueueSteer = (context: RequestContext, body: { threadId?: string; itemId?: string; text?: string }): Promise<ApiResult<QueueItem>> => post(context, API_ENDPOINTS.queueSteer, body);
export const postQueueRetry = (context: RequestContext, body: { threadId?: string; itemId?: string }): Promise<ApiResult<QueueItem>> => post(context, API_ENDPOINTS.queueRetry, body);
export const getQueueImage = (context: RequestContext, params: { threadId: string; itemId: string; index?: number }): Promise<ApiResult<{ url?: string }>> => get(context, API_ENDPOINTS.queueImage, params);

export const queueEndpointFor = (action: QueueAction): string => {
  switch (action) {
    case 'cancel': return API_ENDPOINTS.queueCancel;
    case 'steer': return API_ENDPOINTS.queueSteer;
    case 'retry': return API_ENDPOINTS.queueRetry;
    case 'image': return API_ENDPOINTS.queueImage;
    default: return API_ENDPOINTS.queueImage;
  }
};

export const turnloomApi = {
  getHealth, postAuthSession, getThreads, getThreadMessages, getThreadChanges,
  postNewThread, postSend, postInterrupt, postApproval, getHostDiff, getProjects,
  getAccount, getAppUpdate, postQueueCancel, postQueueSteer, postQueueRetry,
  getQueueImage, queueEndpointFor, configureClient, setUnauthorizedHandler,
  setNetworkStateHandler, request, requestWithContext, startNativeRequest,
  discoverHarnesses, verifyHarness, setActiveRequestScope, getCurrentTarget,
  getActiveGeneration, getActiveScope, isCurrentContext, extractThreadId,
  getBaseUrl, hasToken, endpoints: API_ENDPOINTS,
};

export default turnloomApi;
