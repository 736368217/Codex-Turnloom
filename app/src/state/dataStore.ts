/**
 * Per-harness thread/message/change caches and request isolation.
 *
 * All operations take a RequestContext captured when the request starts. A
 * late response from a previous harness or generation is discarded before it
 * can mutate state. Caches are namespaced by machine+harness scope in native
 * secure storage; a switch never shows another harness's conversations.
 */

import { createStore, useStore } from './store';
import { secureGet, secureSet, secureRemove } from '../lib/nativeBridge';
import {
  getThreads, getThreadMessages, getThreadChanges, getHealth,
  postNewThread, postSend, postInterrupt, postApproval, extractThreadId,
  type ThreadSummary, type ThreadMessage, type ChangeEntry,
  type RequestContext, type SendOptions,
} from '../lib/turnloomApi';
import { isCurrentContext, getActiveGeneration } from '../lib/turnloomApi';
import { cacheKeyFor, setOnline, markSynced, sessionStore } from './sessionStore';
import {
  selectRuntimeScope, applyHealth, applyThreadStatus,
  threadListStatus, markThreadSubmitted,
} from './runtimeStore';

export interface DataState {
  scope: string;
  threads: ThreadSummary[];
  messagesByThread: Record<string, ThreadMessage[]>;
  changesByThread: Record<string, ChangeEntry[]>;
  /** Authoritative per-thread runtime status, separate from message arrays. */
  statusByThread: Record<string, ReturnType<typeof threadListStatus>>;
  messageState: Record<string, { loading: boolean; error: string; loaded: boolean }>;
  loading: boolean;
  loadingMore: boolean;
  nextCursor: string | null;
  threadTotal: number | null;
  threadPages: number;
  offline: boolean;
  error: string;
  lastSyncAt: number | null;
  cachedAt: number | null;
  runningCount: number;
  errorCount: number;
}

const EMPTY: DataState = {
  scope: '', threads: [], messagesByThread: {}, changesByThread: {}, statusByThread: {}, messageState: {},
  loading: false, loadingMore: false, nextCursor: null, threadTotal: null, threadPages: 0,
  offline: false, error: '', lastSyncAt: null, cachedAt: null, runningCount: 0, errorCount: 0,
};

export const dataStore = createStore<DataState>({ ...EMPTY });

function readThreads(scope: string): { threads: ThreadSummary[]; cachedAt: number | null } {
  if (!scope || !sessionStore.getState().offlineCacheEnabled) return { threads: [], cachedAt: null };
  try {
    const raw = secureGet(cacheKeyFor(scope, 'threads'));
    if (!raw) return { threads: [], cachedAt: null };
    const parsed = JSON.parse(raw) as { threads?: unknown; cachedAt?: unknown };
    return {
      threads: Array.isArray(parsed.threads) ? parsed.threads.filter((row): row is ThreadSummary =>
        Boolean(row && typeof row === 'object' && typeof (row as ThreadSummary).id === 'string')) : [],
      cachedAt: typeof parsed.cachedAt === 'number' ? parsed.cachedAt : null,
    };
  } catch {
    return { threads: [], cachedAt: null };
  }
}

function persistThreads(scope: string, threads: ThreadSummary[]): void {
  if (!scope || !sessionStore.getState().offlineCacheEnabled) return;
  try { secureSet(cacheKeyFor(scope, 'threads'), JSON.stringify({ threads, cachedAt: Date.now() })); }
  catch { /* cache is best effort */ }
}

function deriveCounters(threads: ThreadSummary[]): { runningCount: number; errorCount: number } {
  let runningCount = 0;
  let errorCount = 0;
  for (const thread of threads) {
    const status = threadListStatus(thread.status);
    if (status.thinking) runningCount += 1;
    const raw = String(typeof thread.status === 'object' ? thread.status?.state || '' : thread.status || '').toLowerCase();
    if (/error|fail|denied|reject/.test(raw)) errorCount += 1;
  }
  return { runningCount, errorCount };
}

function statusMap(threads: ThreadSummary[]): Record<string, ReturnType<typeof threadListStatus>> {
  const map: Record<string, ReturnType<typeof threadListStatus>> = {};
  for (const thread of threads) map[thread.id] = threadListStatus(thread.status);
  return map;
}

function current(context: RequestContext): boolean {
  return isCurrentContext(context) && context.generation === getActiveGeneration();
}

/** Immediately isolate all visible state when the harness/scope changes. */
export function resetForScope(context: RequestContext): void {
  const cached = readThreads(context.scope);
  selectRuntimeScope(context.scope);
  dataStore.setState({
    ...EMPTY,
    scope: context.scope,
    threads: cached.threads,
    statusByThread: statusMap(cached.threads),
    cachedAt: cached.cachedAt,
    ...deriveCounters(cached.threads),
  });
}

/** A same-scope foreground revalidation keeps live state and the attachment tray. */
export function revalidateForForeground(context: RequestContext): void {
  if (dataStore.getState().scope !== context.scope) resetForScope(context);
  else selectRuntimeScope(context.scope);
  void refreshAll(context);
}

function ensureScope(context: RequestContext): void {
  if (dataStore.getState().scope !== context.scope) resetForScope(context);
}

let threadRequestVersion = 0;

function applyThreads(context: RequestContext, threads: ThreadSummary[], page?: { nextCursor?: string | null; total?: number }, append = false): void {
  if (!current(context)) return;
  const prev = dataStore.getState();
  const incoming = Array.isArray(threads) ? threads.filter((row) => row && typeof row.id === 'string') : [];
  const ids = new Set<string>();
  // Poll the head without removing already loaded history or losing its cursor.
  const keepHistory = !append && prev.threadPages > 1 && page !== undefined;
  const rows = append ? [...prev.threads, ...incoming] : keepHistory ? [...incoming, ...prev.threads] : incoming;
  const list = rows.filter(row => !ids.has(row.id) && Boolean(ids.add(row.id)));
  persistThreads(context.scope, list);
  dataStore.setState({
    scope: context.scope, threads: list, statusByThread: statusMap(list), loading: false, loadingMore: false, offline: false, error: '',
    ...(page ? {
      nextCursor: keepHistory ? prev.nextCursor : page.nextCursor || null,
      threadTotal: typeof page.total === 'number' ? page.total : null,
      threadPages: append ? prev.threadPages + 1 : keepHistory ? prev.threadPages : 1,
    } : {}),
    lastSyncAt: Date.now(), cachedAt: Date.now(), ...deriveCounters(list),
  });
  setOnline(true);
  markSynced();
}

function applyFailure(context: RequestContext, message: string, offline = false): void {
  if (!current(context)) return;
  setOnline(!offline);
  dataStore.setState({ loading: false, loadingMore: false, offline, error: message });
}

function actionable(result: { ok: false; status: number; error: string; offline: boolean }): string {
  if (result.status === 401) return '连接已失效，请重新配对这台机器。';
  if (result.offline || result.status === 0) return '暂时连不上电脑，请检查网络与桌面端服务后重试。';
  if (result.status === 403) return '电脑端当前不允许写入，请在桌面端开启写入后重试。';
  if (result.status === 404) return '服务或请求已不存在，请刷新后重试。';
  if (result.status === 409) return '请求已变化或已处理，请刷新后重新核对。';
  if (result.status >= 500) return '电脑端服务出错，请检查桌面端状态后重试。';
  return result.error || '请求未成功，请重试。';
}

export async function refreshAll(context: RequestContext): Promise<void> {
  if (!current(context)) return;
  ensureScope(context);
  dataStore.setState({ loading: true });
  const health = await getHealth(context);
  if (!current(context)) return;
  if (!health.ok) { applyFailure(context, actionable(health), health.offline); return; }
  applyHealth(context.scope, health.data);
  setOnline(true);
  await refreshThreads(context);
}

export async function refreshThreads(context: RequestContext): Promise<void> {
  if (!current(context)) return;
  ensureScope(context);
  const version = ++threadRequestVersion;
  dataStore.setState({ loading: true, loadingMore: false });
  const result = await getThreads(context, { limit: 60 });
  if (!current(context) || version !== threadRequestVersion) return;
  if (!result.ok) { applyFailure(context, actionable(result), result.offline); return; }
  applyThreads(context, result.data.threads || [], result.data);
}

export async function loadMoreThreads(context: RequestContext): Promise<void> {
  const prev = dataStore.getState();
  if (!current(context) || prev.scope !== context.scope || !prev.nextCursor || prev.loading || prev.loadingMore) return;
  const cursor = prev.nextCursor;
  const version = ++threadRequestVersion;
  dataStore.setState({ loadingMore: true, error: '' });
  const result = await getThreads(context, { limit: 60, cursor });
  if (!current(context) || version !== threadRequestVersion) return;
  if (!result.ok) { applyFailure(context, actionable(result), result.offline); return; }
  applyThreads(context, result.data.threads || [], {
    ...result.data, nextCursor: result.data.nextCursor === cursor ? null : result.data.nextCursor,
  }, true);
}

/** Refresh messages and persist the authoritative top-level status separately. */
export async function refreshMessages(context: RequestContext, threadId: string, limit = 80): Promise<void> {
  if (!current(context) || !threadId) return;
  if (dataStore.getState().messageState[threadId]?.loading) return;
  const previous = dataStore.getState().messageState[threadId];
  dataStore.setState(prev => ({ messageState: { ...prev.messageState, [threadId]: { loading: true, loaded: previous?.loaded || false, error: '' } } }));
  const result = await getThreadMessages(context, threadId, { limit });
  if (!current(context)) return;
  const list = result.ok ? result.data?.messages || result.data?.items || [] : null;
  // A failed poll must NOT clear the authoritative runtime status.
  if (result.ok) applyThreadStatus(context.scope, threadId, result.data?.status);
  dataStore.setState(prev => prev.scope === context.scope ? {
    ...(Array.isArray(list) ? { messagesByThread: { ...prev.messagesByThread, [threadId]: list } } : {}),
    ...(result.ok ? { offline: false, statusByThread: { ...prev.statusByThread, [threadId]: threadListStatus(result.data?.status) } } : {}),
    messageState: { ...prev.messageState, [threadId]: { loading: false, loaded: result.ok || previous?.loaded || false, error: result.ok ? '' : actionable(result) } },
  } : {});
}

/** Refresh the authoritative status after send/stop without waiting for a full UI cycle. */
export async function refreshThreadStatus(context: RequestContext, threadId: string): Promise<void> {
  if (!current(context) || !threadId) return;
  const result = await getThreadMessages(context, threadId, { limit: 80 });
  if (!current(context) || !result.ok) return;
  applyThreadStatus(context.scope, threadId, result.data?.status);
  dataStore.setState((prev) => prev.scope === context.scope
    ? { statusByThread: { ...prev.statusByThread, [threadId]: threadListStatus(result.data?.status) } }
    : {});
}

export async function refreshChanges(context: RequestContext, threadId: string): Promise<void> {
  if (!current(context) || !threadId) return;
  const result = await getThreadChanges(context, threadId);
  if (!current(context) || !result.ok) return;
  const list = result.data.changes || result.data.files || [];
  dataStore.setState((prev) => prev.scope === context.scope
    ? { changesByThread: { ...prev.changesByThread, [threadId]: list } }
    : {});
}

/** No local/offline thread is fabricated: only a real host thread id succeeds. */
export async function createThread(context: RequestContext, options: SendOptions & { projectId?: string }): Promise<string | null> {
  if (!current(context)) return null;
  ensureScope(context);
  const result = await postNewThread(context, options);
  if (!current(context)) return null;
  if (!result.ok) { applyFailure(context, actionable(result), result.offline); return null; }
  const id = extractThreadId(result.data);
  if (!id) {
    applyFailure(context, '电脑端没有返回会话编号，请刷新会话列表确认是否已创建。');
    return null;
  }
  // A list row's "running" is not authoritative; leave status ended until a poll.
  const optimistic: ThreadSummary = {
    id, title: options.message.slice(0, 48) || '新任务', preview: options.message.slice(0, 80),
    status: { state: 'ended', thinking: false }, updatedAt: Date.now(),
  };
  const prev = dataStore.getState();
  applyThreads(context, [optimistic, ...prev.threads.filter((row) => row.id !== id)]);
  void refreshThreads(context);
  return id;
}

export async function sendMessage(context: RequestContext, threadId: string, options: SendOptions): Promise<boolean> {
  if (!current(context) || !threadId) return false;
  const result = await postSend(context, { ...options, threadId });
  if (!current(context)) return false;
  if (!result.ok) { applyFailure(context, actionable(result), result.offline); return false; }
  dataStore.setState({ offline: false, error: '' });
  markThreadSubmitted(context.scope, threadId);
  const optimistic: ThreadMessage = {
    id: `sent-${Date.now()}`, role: 'user', kind: 'message', content: options.message,
    images: options.images || [], createdAt: Date.now(),
  };
  dataStore.setState((prev) => prev.scope === context.scope
    ? {
      messagesByThread: { ...prev.messagesByThread, [threadId]: [...(prev.messagesByThread[threadId] || []), optimistic] },
      statusByThread: { ...prev.statusByThread, [threadId]: threadListStatus({}) },
    }
    : {});
  void refreshThreadStatus(context, threadId);
  return true;
}

export async function interruptThread(context: RequestContext, threadId: string): Promise<boolean> {
  if (!current(context) || !threadId) return false;
  const result = await postInterrupt(context, { threadId });
  if (!current(context)) return false;
  if (!result.ok) { applyFailure(context, actionable(result), result.offline); return false; }
  applyThreadStatus(context.scope, threadId, {});
  dataStore.setState((prev) => prev.scope === context.scope
    ? { statusByThread: { ...prev.statusByThread, [threadId]: threadListStatus({}) } }
    : {});
  void refreshThreadStatus(context, threadId);
  return true;
}

export async function resolveApproval(
  context: RequestContext,
  threadId: string,
  requestId: string,
  approvalKind: 'command' | 'file' | 'permission',
  detailsHash: string,
  decision: 'approve' | 'approveForSession' | 'decline',
): Promise<boolean> {
  if (!current(context) || !threadId || !requestId || !detailsHash) return false;
  const result = await postApproval(context, { threadId, requestId, approvalKind, detailsHash, decision, approved: decision !== 'decline' });
  if (!current(context)) return false;
  if (!result.ok) { applyFailure(context, actionable(result), result.offline); return false; }
  dataStore.setState({ offline: false, error: '' });
  return true;
}

export function clearOfflineCache(context: RequestContext | null): void {
  if (context) secureRemove(cacheKeyFor(context.scope, 'threads'));
  // Clearing disk cache must not blank the live, already loaded session list.
  dataStore.setState({ cachedAt: null });
}

export function useDataState(): DataState {
  return useStore(dataStore);
}

export default dataStore;
