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
  postQueueCancel, postQueueSteer, postQueueRetry, getQueueStatus,
  postQueueReorder, postQueueResume,
  type ThreadSummary, type ThreadMessage, type ChangeEntry,
  type RequestContext, type SendOptions, type ApiResult,
  type QueueActionPayload, type QueueReorderDirection,
} from '../lib/turnloomApi';
import { actionableMessage } from '../lib/serverErrors';
import { recordDiagnostic, uploadDiagnostics } from '../lib/diagnostics';
import { isCurrentContext, getActiveGeneration } from '../lib/turnloomApi';
import { cacheKeyFor, setOnline, markSynced, sessionStore } from './sessionStore';
import { projectThread } from '../lib/threadProjection';
import {
  selectRuntimeScope, applyHealth, applyThreadStatus, applyQueueSnapshot,
  threadListStatus, markThreadSubmitted, getThreadStatus,
} from './runtimeStore';
import { mergeMessagePages } from '../lib/messagePaging';

export interface ActiveThread {
  id: string;
  title: string;
  project: string;
  reason: string;
}

/**
 * Global "what is running / what waits for you" snapshot from `/api/threads`.
 * It is pagination-independent; `truncated` means the host's candidate window
 * was cut, so the numbers are a lower bound and the UI must say so.
 */
export interface ActiveSnapshot {
  running: ActiveThread[];
  waiting: ActiveThread[];
  truncated: boolean;
}

function normalizeActiveThreads(raw: unknown): ActiveSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (!Array.isArray(row.running) && !Array.isArray(row.waiting)) return null;
  const list = (value: unknown): ActiveThread[] => (Array.isArray(value) ? value : []).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const entry = item as Record<string, unknown>;
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (!id) return [];
    return [{
      id,
      title: typeof entry.title === 'string' && entry.title.trim() ? entry.title.trim() : id,
      project: typeof entry.project === 'string' ? entry.project.trim() : '',
      reason: typeof entry.reason === 'string' ? entry.reason : '',
    }];
  });
  return { running: list(row.running), waiting: list(row.waiting), truncated: row.truncated === true };
}

export interface DataState {
  scope: string;
  threads: ThreadSummary[];
  /** Server truth for the running/waiting counts; null on old hosts. */
  active: ActiveSnapshot | null;
  messagesByThread: Record<string, ThreadMessage[]>;
  changesByThread: Record<string, ChangeEntry[]>;
  /** Authoritative per-thread runtime status, separate from message arrays. */
  statusByThread: Record<string, ReturnType<typeof threadListStatus>>;
  messageState: Record<string, { loading: boolean; error: string; loaded: boolean }>;
  messagePages: Record<string, { olderCursor: string | null; hasOlder: boolean; expanded: boolean; loading: boolean; error: string }>;
  loading: boolean;
  loadingMore: boolean;
  nextCursor: string | null;
  threadTotal: number | null;
  threadPages: number;
  offline: boolean;
  error: string;
  /** The reason this send failed only — never an older poll's error. */
  lastSendError: string;
  lastSyncAt: number | null;
  cachedAt: number | null;
  runningCount: number;
  errorCount: number;
}

const EMPTY: DataState = {
  scope: '', threads: [], active: null, messagesByThread: {}, changesByThread: {}, statusByThread: {}, messageState: {}, messagePages: {},
  loading: false, loadingMore: false, nextCursor: null, threadTotal: null, threadPages: 0,
  offline: false, error: '', lastSendError: '', lastSyncAt: null, cachedAt: null, runningCount: 0, errorCount: 0,
};

/** A local send/stop invalidates status polls that started before it. */
const statusEpoch = new Map<string, number>();
function epochKey(scope: string, threadId: string): string { return `${scope}\u0000${threadId}`; }
function epochFor(scope: string, threadId: string): number { return statusEpoch.get(epochKey(scope, threadId)) || 0; }
function bumpStatusEpoch(scope: string, threadId: string): void {
  statusEpoch.set(epochKey(scope, threadId), epochFor(scope, threadId) + 1);
}

const baseDataStore = createStore<DataState>({ ...EMPTY });
export const dataStore: typeof baseDataStore = {
  ...baseDataStore,
  setState(patch) {
    baseDataStore.setState(prev => {
      const next = { ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) };
      return { ...next, ...deriveCounters(next.threads, next.statusByThread) };
    });
  },
};

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

function deriveCounters(
  threads: ThreadSummary[],
  statuses: DataState['statusByThread'] = {},
): { runningCount: number; errorCount: number } {
  let runningCount = 0;
  let errorCount = 0;
  for (const thread of threads) {
    if (projectThread(thread, statuses).status.thinking) runningCount += 1;
    const raw = String(typeof thread.status === 'object' ? thread.status?.state || '' : thread.status || '').toLowerCase();
    if (/error|fail|denied|reject/.test(raw)) errorCount += 1;
  }
  return { runningCount, errorCount };
}

function statusMap(threads: ThreadSummary[], scope?: string): DataState['statusByThread'] {
  const map: DataState['statusByThread'] = {};
  for (const thread of threads) {
    const authoritative = scope ? getThreadStatus(scope, thread.id) : null;
    map[thread.id] = threadListStatus(authoritative || thread.status);
  }
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

function applyThreads(context: RequestContext, threads: ThreadSummary[], page?: { nextCursor?: string | null; total?: number; active?: unknown }, append = false): void {
  if (!current(context)) return;
  const prev = dataStore.getState();
  const incoming = Array.isArray(threads) ? threads.filter((row) => row && typeof row.id === 'string') : [];
  const ids = new Set<string>();
  // Poll the head without removing already loaded history or losing its cursor.
  const keepHistory = !append && prev.threadPages > 1 && page !== undefined;
  const rows = append ? [...prev.threads, ...incoming] : keepHistory ? [...incoming, ...prev.threads] : incoming;
  const list = rows.filter(row => !ids.has(row.id) && Boolean(ids.add(row.id)));
  persistThreads(context.scope, list);
  // A new host sends `active` on every page. An old host never does: fall back
  // to null so the strip keeps its page-filtered projection (honest, if partial).
  const nextActive = page && page.active !== undefined
    ? normalizeActiveThreads(page.active)
    : append ? prev.active : null;
  dataStore.setState({
    scope: context.scope, threads: list, active: nextActive, statusByThread: statusMap(list, context.scope), loading: false, loadingMore: false, offline: false, error: '',
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
  return actionableMessage(result);
}

/** A transport blip is worth one retry; the request id makes the resend idempotent. */
function transportFailure(result: { ok: false; status: number; error: string; offline: boolean }): boolean {
  return result.status === 0 && !/stale-context/i.test(result.error || '');
}

async function retryTransport<T>(
  context: RequestContext,
  run: () => Promise<ApiResult<T>>,
): Promise<ApiResult<T>> {
  const first = await run();
  if (first.ok || !transportFailure(first) || !current(context)) return first;
  await new Promise((resolve) => setTimeout(resolve, 700));
  if (!current(context)) return first;
  return run();
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
  const epoch = epochFor(context.scope, threadId);
  const previous = dataStore.getState().messageState[threadId];
  dataStore.setState(prev => ({ messageState: { ...prev.messageState, [threadId]: { loading: true, loaded: previous?.loaded || false, error: '' } } }));
  const result = await getThreadMessages(context, threadId, { limit });
  if (!current(context)) return;
  const statusIsCurrent = result.ok && epochFor(context.scope, threadId) === epoch;
  const list = result.ok ? result.data?.messages || result.data?.items || [] : null;
  // A failed poll or a result older than a local stop must NOT clear or replace the authoritative runtime status.
  if (statusIsCurrent) applyThreadStatus(context.scope, threadId, result.data?.status);
  dataStore.setState(prev => prev.scope === context.scope ? {
    ...(Array.isArray(list) ? { messagesByThread: { ...prev.messagesByThread, [threadId]: prev.messagePages[threadId]?.expanded ? mergeMessagePages(prev.messagesByThread[threadId] || [], list) : list } } : {}),
    ...(result.ok && !prev.messagePages[threadId]?.expanded && !prev.messagePages[threadId]?.loading ? { messagePages: { ...prev.messagePages, [threadId]: { olderCursor: typeof result.data.olderCursor === 'string' ? result.data.olderCursor : null, hasOlder: result.data.hasOlderMessages === true, expanded: false, loading: false, error: '' } } } : {}),
    ...(statusIsCurrent ? { offline: false, statusByThread: { ...prev.statusByThread, [threadId]: threadListStatus(result.data?.status) } } : {}),
    messageState: { ...prev.messageState, [threadId]: { loading: false, loaded: result.ok || previous?.loaded || false, error: result.ok ? '' : actionable(result) } },
  } : {});
}

/** History pages never change live runtime status. A service switch discards them. */
export async function loadOlderMessages(context: RequestContext, threadId: string): Promise<void> {
  const page = dataStore.getState().messagePages[threadId];
  if (!current(context) || !page?.olderCursor || page.loading) return;
  const cursor = page.olderCursor;
  dataStore.setState(prev => ({ messagePages: { ...prev.messagePages, [threadId]: { ...page, loading: true, error: '' } } }));
  const result = await getThreadMessages(context, threadId, { limit: 80, before: cursor });
  if (!current(context)) return;
  dataStore.setState(prev => {
    if (prev.scope !== context.scope) return {};
    if (!result.ok) return { messagePages: { ...prev.messagePages, [threadId]: { ...page, loading: false, error: actionable(result) } } };
    const rows = result.data.messages || result.data.items || [];
    const next = typeof result.data.olderCursor === 'string' && result.data.olderCursor !== cursor ? result.data.olderCursor : null;
    return {
      messagesByThread: { ...prev.messagesByThread, [threadId]: mergeMessagePages(Array.isArray(rows) ? rows : [], prev.messagesByThread[threadId] || []) },
      messagePages: { ...prev.messagePages, [threadId]: { olderCursor: next, hasOlder: result.data.hasOlderMessages === true, expanded: true, loading: false, error: '' } },
    };
  });
}

/** Refresh the authoritative status after send without allowing a pre-stop poll to win. */
export async function refreshThreadStatus(context: RequestContext, threadId: string): Promise<void> {
  if (!current(context) || !threadId) return;
  const epoch = epochFor(context.scope, threadId);
  const result = await getThreadMessages(context, threadId, { limit: 1 });
  if (!current(context) || !result.ok || epochFor(context.scope, threadId) !== epoch) return;
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
  const result = await retryTransport(context, () => postNewThread(context, options));
  if (!current(context)) return null;
  if (!result.ok) {
    const message = actionable(result);
    dataStore.setState({ lastSendError: message });
    applyFailure(context, message, result.offline);
    recordDiagnostic({
      kind: result.status === 0 ? 'timeout' : 'send',
      status: result.status,
      path: '/api/send',
      message,
      detail: { newThread: true },
    });
    return null;
  }
  dataStore.setState({ lastSendError: '' });
  const id = extractThreadId(result.data);
  if (!id) {
    applyFailure(context, '电脑端没有返回会话编号，请刷新会话列表确认是否已创建。');
    dataStore.setState({ lastSendError: '电脑端没有返回会话编号，请刷新会话列表确认是否已创建。' });
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
  // 2.4.1: the manual upload button is gone, so every confirmed send path has to
  // hand over pending records — a new thread's first message included.
  void uploadDiagnostics(context);
  return id;
}

export async function sendMessage(context: RequestContext, threadId: string, options: SendOptions): Promise<boolean> {
  if (!current(context) || !threadId) return false;
  const result = await retryTransport(context, () => postSend(context, { ...options, threadId }));
  if (!current(context)) return false;
  if (!result.ok) {
    const message = actionable(result);
    dataStore.setState({ lastSendError: message });
    applyFailure(context, message, result.offline);
    recordDiagnostic({
      kind: result.status === 0 ? 'timeout' : 'send',
      status: result.status,
      path: '/api/send',
      message,
      detail: { threadId, newThread: false },
    });
    return false;
  }
  dataStore.setState({ offline: false, error: '', lastSendError: '' });
  bumpStatusEpoch(context.scope, threadId);
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
  // A confirmed send is the honest moment to hand over any pending phone records.
  void uploadDiagnostics(context);
  return true;
}

export interface QueueSendOutcome {
  ok: boolean;
  queueLength: number;
  queuePaused: boolean;
  error: string;
}

/**
 * Running turn: the same payload becomes a queue entry instead of a message in
 * the running turn. No optimistic bubble is appended and "running" is never
 * cleared — the turn keeps going while the message waits.
 */
export async function sendQueuedMessage(
  context: RequestContext,
  threadId: string,
  options: SendOptions,
): Promise<QueueSendOutcome> {
  if (!current(context) || !threadId) return { ok: false, queueLength: 0, queuePaused: false, error: '' };
  const result = await retryTransport(context, () => postSend(context, { ...options, threadId, mode: 'queue' }));
  if (!current(context)) return { ok: false, queueLength: 0, queuePaused: false, error: '连接已切换，请重试。' };
  if (!result.ok) {
    const message = actionable(result);
    dataStore.setState({ lastSendError: message });
    applyFailure(context, message, result.offline);
    recordDiagnostic({
      kind: result.status === 0 ? 'timeout' : 'send',
      status: result.status,
      path: '/api/send',
      message,
      detail: { threadId, newThread: false, mode: 'queue' },
    });
    return { ok: false, queueLength: 0, queuePaused: false, error: message };
  }
  dataStore.setState({ offline: false, error: '', lastSendError: '' });
  const snapshot = applyQueueSnapshot(context.scope, threadId, result.data);
  // The status poll is authoritative for positions and delivery states.
  void refreshThreadStatus(context, threadId);
  // A queued send is a confirmed send too; without this, users who only talk to
  // a running thread would never upload diagnostics once the button is gone.
  void uploadDiagnostics(context);
  return { ok: true, queueLength: snapshot.queueLength, queuePaused: snapshot.queuePaused, error: '' };
}

export interface QueueActionResult {
  ok: boolean;
  error: string;
  data: QueueActionPayload | null;
}

/**
 * Shared queue mutation path. A 4xx here is a queue-state fact (item already
 * sending, turn already over), so it is reported where the action happened and
 * never turns the app into "offline"; only a transport failure touches the banner.
 */
async function queueAction(
  context: RequestContext,
  threadId: string,
  run: () => Promise<ApiResult<QueueActionPayload>>,
): Promise<QueueActionResult> {
  if (!current(context) || !threadId) return { ok: false, error: '', data: null };
  const result = await run();
  if (!current(context)) return { ok: false, error: '连接已切换，请重试。', data: null };
  if (!result.ok) {
    const message = actionable(result);
    if (result.offline) applyFailure(context, message, true);
    return { ok: false, error: message, data: null };
  }
  dataStore.setState({ offline: false, error: '' });
  applyQueueSnapshot(context.scope, threadId, result.data);
  return { ok: true, error: '', data: result.data || null };
}

export const cancelQueuedMessage = (context: RequestContext, threadId: string, itemId: string, edit: boolean): Promise<QueueActionResult> =>
  queueAction(context, threadId, () => postQueueCancel(context, { threadId, itemId, edit }));

export const steerQueuedMessage = (context: RequestContext, threadId: string, itemId: string): Promise<QueueActionResult> =>
  queueAction(context, threadId, () => postQueueSteer(context, { threadId, itemId }));

export const retryQueuedMessage = (context: RequestContext, threadId: string, itemId: string): Promise<QueueActionResult> =>
  queueAction(context, threadId, () => postQueueRetry(context, { threadId, itemId }));

export const reorderQueuedMessage = (context: RequestContext, threadId: string, itemId: string, direction: QueueReorderDirection): Promise<QueueActionResult> =>
  queueAction(context, threadId, () => postQueueReorder(context, { threadId, itemId, direction }));

export const resumeThreadQueue = (context: RequestContext, threadId: string): Promise<QueueActionResult> =>
  queueAction(context, threadId, () => postQueueResume(context, { threadId }));

/** Fill the panel when the messages status carries a count but no rows. */
export async function refreshQueue(context: RequestContext, threadId: string): Promise<void> {
  if (!current(context) || !threadId) return;
  const result = await getQueueStatus(context, threadId);
  if (!current(context) || !result.ok) return;
  applyQueueSnapshot(context.scope, threadId, result.data);
}

export async function interruptThread(context: RequestContext, threadId: string): Promise<boolean> {
  if (!current(context) || !threadId) return false;
  const result = await postInterrupt(context, { threadId });
  if (!current(context)) return false;
  if (!result.ok) { applyFailure(context, actionable(result), result.offline); return false; }
  bumpStatusEpoch(context.scope, threadId);
  applyThreadStatus(context.scope, threadId, {});
  // Stopping a turn pauses its queue on the server; the bar must say so at once.
  applyQueueSnapshot(context.scope, threadId, result.data);
  dataStore.setState((prev) => prev.scope === context.scope
    ? { statusByThread: { ...prev.statusByThread, [threadId]: threadListStatus({}) } }
    : {});
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
