/**
 * Runtime status and model catalog cache. A single-writer in-memory store
 * keyed by harness scope; the React data store subscribes to it.
 *
 * Only the top-level `status` of GET /api/threads/:id/messages is authoritative.
 * Thread-list rows, loading indicators and POST submissions are never used to
 * invent a running turn.
 */

import {
  normalizeHealthCatalog, normalizeThreadStatus, listStatusOf,
  type ModelCatalog, type ThreadRuntimeStatus,
} from '../lib/chatContract';
import { createStore } from './store';
import { cacheKeyFor } from './sessionStore';
import { secureGet, secureSet, secureRemove } from '../lib/nativeBridge';

export type RuntimeStoreState = {
  scope: string;
  catalog: ModelCatalog | null;
  statusByThread: Record<string, ThreadRuntimeStatus>;
};

const EMPTY: RuntimeStoreState = { scope: '', catalog: null, statusByThread: {} };

export const runtimeStore = createStore<RuntimeStoreState>({ ...EMPTY });
const memory = new Map<string, RuntimeStoreState>();

function catalogKey(scope: string): string {
  return cacheKeyFor(scope, 'modelCatalog');
}

function readCatalog(scope: string): ModelCatalog | null {
  try {
    const raw = secureGet(catalogKey(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { scope?: string; health?: unknown };
    if (parsed.scope !== scope) return null;
    return normalizeHealthCatalog(parsed.health, scope);
  } catch {
    return null;
  }
}

/** Restore a same-scope snapshot after foreground revalidation / remount. */
export function selectRuntimeScope(scope: string): void {
  const id = String(scope || '');
  const cached = memory.get(id) || { scope: id, catalog: readCatalog(id), statusByThread: {} };
  memory.set(id, cached);
  if (runtimeStore.getState() !== cached) runtimeStore.setState(cached);
}

function mutate(patch: Partial<RuntimeStoreState>): void {
  const next = { ...runtimeStore.getState(), ...patch };
  memory.set(next.scope, next);
  runtimeStore.setState(next);
}

/** Cache /api/health by scope. Never fabricate model IDs or capabilities. */
export function applyHealth(scope: string, health: unknown): ModelCatalog {
  const catalog = normalizeHealthCatalog(health, scope);
  if (catalog.models.length) {
    mutate({ scope, catalog });
    try {
      secureSet(catalogKey(scope), JSON.stringify({ scope, health }));
    } catch { /* cache is best effort */ }
  }
  return catalog;
}

export function getModelCatalog(scope = runtimeStore.getState().scope): ModelCatalog | null {
  const state = runtimeStore.getState();
  if (state.scope === scope && state.catalog) return state.catalog;
  return memory.get(scope)?.catalog || readCatalog(scope);
}

export function clearHealthCache(scope: string): void {
  try { secureRemove(catalogKey(scope)); } catch { /* best effort */ }
  const cached = memory.get(scope);
  if (cached) memory.set(scope, { ...cached, catalog: null });
  if (runtimeStore.getState().scope === scope) mutate({ catalog: null });
}

/** Apply the top-level messages status; preserve prior state on failed polls. */
export function applyThreadStatus(scope: string, threadId: string, status: unknown): ThreadRuntimeStatus {
  const parsed = normalizeThreadStatus(status);
  if (runtimeStore.getState().scope !== scope) selectRuntimeScope(scope);
  mutate({ statusByThread: { ...runtimeStore.getState().statusByThread, [threadId]: parsed } });
  return parsed;
}

/** After a successful POST, only the next authoritative poll can claim running. */
export function markThreadSubmitted(scope: string, threadId: string): void {
  if (runtimeStore.getState().scope !== scope) selectRuntimeScope(scope);
  const current = runtimeStore.getState().statusByThread[threadId];
  if (current?.thinking) applyThreadStatus(scope, threadId, {});
}

export function getThreadStatus(scope: string, threadId: string): ThreadRuntimeStatus | null {
  const state = runtimeStore.getState();
  if (state.scope === scope) return state.statusByThread[threadId] || null;
  return memory.get(scope)?.statusByThread[threadId] || null;
}

/** Thread-list status is a projection, not a source of truth. */
export function threadListStatus(status: unknown): { state: 'ended' | 'running' | 'waiting'; thinking: boolean } {
  return listStatusOf(status);
}

export function resetRuntimeScope(scope: string): void {
  const cached = memory.get(scope);
  memory.set(scope, { scope, catalog: cached?.catalog || readCatalog(scope), statusByThread: {} });
  if (runtimeStore.getState().scope === scope) mutate({ statusByThread: {} });
}

export default runtimeStore;
