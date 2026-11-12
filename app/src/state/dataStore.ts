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
  type RequestContext,
} from '../lib/turnloomApi';
import { isCurrentContext, getActiveGeneration } from '../lib/turnloomApi';
import { cacheKeyFor, setOnline, markSynced, sessionStore } from './sessionStore';

export interface DataState {
  scope: string;
  threads: ThreadSummary[];
  messagesByThread: Record<string, ThreadMessage[]>;
  changesByThread: Record<string, ChangeEntry[]>;
  messageState: Record<string, { loading: boolean; error: string; loaded: boolean }>;
  loading: boolean;
  offline: boolean;
  error: string;
  lastSyncAt: number | null;
  cachedAt: number | null;
  runningCount: number;
  errorCount: number;
}

const EMPTY: DataState = {
  scope: '', threads: [], messagesByThread: {}, changesByThread: {}, messageState: {},
  loading: false, offline: false, error: '', lastSyncAt: null, cachedAt: null,
  runningCount: 0, errorCount: 0,
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

function statusOf(thread: ThreadSummary): string {
  const raw = thread.status;
  if (typeof raw === 'string') return raw.toLowerCase();
  if (raw && typeof raw === 'object') return String(raw.state || raw.label || '').toLowerCase();
  return '';
}

function deriveCounters(threads: ThreadSummary[]): { runningCount: number; errorCount: number } {
  let runningCount = 0;
  let errorCount = 0;
  for (const thread of threads) {
    const status = statusOf(thread);
    if (/run|active|working|exec|stream|thinking|progress/.test(status)) runningCount += 1;
    if (/error|fail|denied|reject/.test(status)) errorCount += 1;
  }
  return { runningCount, errorCount };
}

function current(context: RequestContext): boolean {
  return isCurrentContext(context) && context.generation === getActiveGeneration();
}

/** Immediately isolate all visible state when the harness/scope changes. */
export function resetForScope(context: RequestContext): void {
  const cached = readThreads(context.scope);
  dataStore.setState({
    ...EMPTY,
    scope: context.scope,
    threads: cached.threads,
    cachedAt: cached.cachedAt,
    ...deriveCounters(cached.threads),
  });
}

function ensureScope(context: RequestContext): void {
  const state = dataStore.getState();
  if (state.scope !== context.scope) resetForScope(context);
}

function applyThreads(context: RequestContext, threads: ThreadSummary[]): void {
  if (!current(context)) return;
  const list = threads.filter((row) => row && typeof row.id === 'string');
  persistThreads(context.scope, list);
  dataStore.setState({
    scope: context.scope, threads: list, loading: false, offline: false, error: '',
    lastSyncAt: Date.now(), cachedAt: Date.now(), ...deriveCounters(list),
  });
  markSynced();
}

function applyFailure(context: RequestContext, message: string): void {
  if (!current(context)) return;
  setOnline(false);
  dataStore.setState((prev) => ({
    loading: false, offline: true,
    error: prev.threads.length ? '' : message,
  }));
}

function actionable(result: { ok: false; status: number; error: string; offline: boolean }): string {
  if (result.status === 401) return '连接已失效，请重新配对这台机器。';
  if (result.offline || result.status === 0) return '暂时连不上电脑，请检查网络与桌面端服务后重试。';
  if (result.status === 403) return '电脑端当前不允许写入，请在桌面端开启写入后重试。';
  if (result.status === 404) return '服务未找到，请确认桌面端已升级到最新版本。';
  if (result.status === 409) return '电脑端正忙或请求冲突，请稍后重试。';
  if (result.status >= 500) return '电脑端服务出错，请检查桌面端状态后重试。';
  return result.error || '请求未成功，请重试。';
}

export async function refreshAll(context: RequestContext): Promise<void> {
  if (!current(context)) return;
  ensureScope(context);
  dataStore.setState({ loading: true });
  const health = await getHealth(context);
  if (!current(context)) return;
  if (!health.ok) {
    setOnline(false);
    applyFailure(context, actionable(health));
    return;
  }
  setOnline(true);
  const result = await getThreads(context, { limit: 60 });
  if (!current(context)) return;
  if (result.ok) applyThreads(context, Array.isArray(result.data.threads) ? result.data.threads : []);
  else { setOnline(!result.offline); applyFailure(context, actionable(result)); }
}

export async function refreshThreads(context: RequestContext): Promise<void> {
  if (!current(context)) return;
  ensureScope(context);
  const result = await getThreads(context, { limit: 60 });
  if (!current(context) || !result.ok) {
    if (result && !result.ok) applyFailure(context, actionable(result));
    return;
  }
  applyThreads(context, Array.isArray(result.data.threads) ? result.data.threads : []);
}

export async function refreshMessages(context: RequestContext, threadId: string, limit = 80): Promise<void> {
  if (!current(context) || !threadId) return;
  if (dataStore.getState().messageState[threadId]?.loading) return;
  const previous = dataStore.getState().messageState[threadId];
  dataStore.setState(prev => ({ messageState: { ...prev.messageState, [threadId]: { loading: true, loaded: previous?.loaded || false, error: '' } } }));
  const result = await getThreadMessages(context, threadId, { limit });
  if (!current(context)) return;
  const list = result.ok ? result.data?.messages || result.data?.items || [] : null;
  dataStore.setState(prev => prev.scope === context.scope ? {
    ...(Array.isArray(list) ? { messagesByThread: { ...prev.messagesByThread, [threadId]: list } } : {}),
    messageState: { ...prev.messageState, [threadId]: { loading: false, loaded: result.ok || previous?.loaded || false, error: result.ok ? '' : actionable(result) } },
  } : {});
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
export async function createThread(context: RequestContext, message: string, projectId = ''): Promise<string | null> {
  if (!current(context)) return null;
  ensureScope(context);
  const result = await postNewThread(context, {
    message,
    ...(projectId ? { projectId } : {}),
    clientRequestId: `app-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  });
  if (!current(context)) return null;
  if (!result.ok) { applyFailure(context, actionable(result)); return null; }
  const id = extractThreadId(result.data);
  if (!id) {
    applyFailure(context, '电脑端没有返回会话编号，请刷新会话列表确认是否已创建。');
    return null;
  }
  const optimistic: ThreadSummary = {
    id, title: message.slice(0, 48) || '新任务', preview: message.slice(0, 80),
    status: 'running', updatedAt: Date.now(),
  };
  const prev = dataStore.getState();
  applyThreads(context, [optimistic, ...prev.threads.filter((row) => row.id !== id)]);
  void refreshThreads(context);
  return id;
}

export async function sendMessage(context: RequestContext, threadId: string, message: string): Promise<boolean> {
  if (!current(context) || !threadId) return false;
  const result = await postSend(context, {
    threadId, message,
    clientRequestId: `app-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  });
  if (!current(context)) return false;
  if (!result.ok) { applyFailure(context, actionable(result)); return false; }
  const optimistic: ThreadMessage = {
    id: `sent-${Date.now()}`, role: 'user', text: message, createdAt: Date.now(),
  };
  dataStore.setState((prev) => prev.scope === context.scope
    ? { messagesByThread: { ...prev.messagesByThread, [threadId]: [...(prev.messagesByThread[threadId] || []), optimistic] } }
    : {});
  return true;
}

export async function interruptThread(context: RequestContext, threadId: string): Promise<boolean> {
  if (!current(context) || !threadId) return false;
  const result = await postInterrupt(context, { threadId });
  if (!current(context)) return false;
  if (!result.ok) { applyFailure(context, actionable(result)); return false; }
  return true;
}

export async function resolveApproval(
  context: RequestContext,
  threadId: string,
  id: string,
  decision: 'approve' | 'reject',
): Promise<boolean> {
  if (!current(context) || !threadId) return false;
  const result = await postApproval(context, { threadId, id, decision, approved: decision === 'approve' });
  if (!current(context)) return false;
  if (!result.ok) { applyFailure(context, actionable(result)); return false; }
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
