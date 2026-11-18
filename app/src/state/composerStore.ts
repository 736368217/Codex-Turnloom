/**
 * Per-thread composer state: drafts, turn preferences, pending request IDs and
 * the attachment tray. Small text/IDs use native storage; attachment bytes stay
 * ONLY in memory keyed by scope+thread so a foreground picker / AppRoot remount
 * does not lose them and nothing enormous is written to shared preferences.
 */

import { createStore, useStore } from './store';
import { secureGet, secureSet, secureRemove } from '../lib/nativeBridge';
import { cacheKeyFor } from './sessionStore';
import type { SendAttachment, SendPayload, TurnPreference } from '../lib/chatContract';

export interface ComposerState {
  scope: string;
  threadId: string;
  text: string;
  attachments: SendAttachment[];
  pendingIdentity: string;
  clientRequestId: string;
  preference: TurnPreference;
}

const EMPTY: ComposerState = {
  scope: '', threadId: '', text: '', attachments: [],
  pendingIdentity: '', clientRequestId: '', preference: { model: '', effort: '' },
};

export const composerStore = createStore<ComposerState>({ ...EMPTY });
const memory = new Map<string, ComposerState>();

function key(scope: string, threadId: string): string {
  return `${String(scope || '')}::${String(threadId || '')}`;
}

function prefKey(scope: string, threadId: string): string {
  return cacheKeyFor(scope, `prefs.${encodeURIComponent(threadId)}`);
}

function draftKey(scope: string, threadId: string): string {
  return cacheKeyFor(scope, `draft.${encodeURIComponent(threadId)}`);
}

function readPrefs(scope: string, threadId: string): TurnPreference {
  try {
    const parsed = JSON.parse(secureGet(prefKey(scope, threadId)) || '{}') as Partial<TurnPreference>;
    return {
      model: typeof parsed.model === 'string' ? parsed.model : '',
      effort: typeof parsed.effort === 'string' ? parsed.effort : '',
    };
  } catch {
    return { model: '', effort: '' };
  }
}

export function saveTurnPreference(scope: string, threadId: string, preference: TurnPreference): void {
  if (!scope || !threadId) return;
  try { secureSet(prefKey(scope, threadId), JSON.stringify(preference)); } catch { /* best effort */ }
  const id = key(scope, threadId);
  const current = memory.get(id) || { ...EMPTY, scope, threadId };
  memory.set(id, { ...current, preference });
  const state = composerStore.getState();
  if (state.scope === scope && state.threadId === threadId) composerStore.setState({ preference });
}

export function readTurnPreference(scope: string, threadId: string): TurnPreference {
  return readPrefs(scope, threadId);
}

/**
 * Idempotent scope/thread switch. Revalidation at the same scope restores the
 * in-memory tray even if AppRoot has remounted the React subtree.
 */
export function selectComposer(scope: string, threadId: string): void {
  const id = key(scope, threadId);
  const cached = memory.get(id);
  const loaded: ComposerState = cached || {
    ...EMPTY,
    scope, threadId,
    text: (() => { try { return secureGet(draftKey(scope, threadId)) || ''; } catch { return ''; } })(),
    preference: readPrefs(scope, threadId),
  };
  memory.set(id, loaded);
  const state = composerStore.getState();
  if (state.scope !== scope || state.threadId !== threadId || state !== loaded) {
    composerStore.setState(loaded);
  }
}

/** Read a specific scope/thread snapshot without changing the selected composer. */
export function composerStateFor(scope: string, threadId: string): ComposerState {
  const id = key(scope, threadId);
  const cached = memory.get(id);
  if (cached) return cached;
  let text = '';
  try { text = secureGet(draftKey(scope, threadId)) || ''; } catch { /* best effort */ }
  const loaded = { ...EMPTY, scope, threadId, text, preference: readPrefs(scope, threadId) };
  memory.set(id, loaded);
  return loaded;
}


/** Mutate exactly one scope/thread snapshot, never the currently selected one. */
function mutateScoped(scope: string, threadId: string, next: Partial<ComposerState>): void {
  const id = key(scope, threadId);
  const base = memory.get(id) || { ...EMPTY, scope, threadId, preference: readPrefs(scope, threadId) };
  const updated = { ...base, ...next };
  memory.set(id, updated);
  const state = composerStore.getState();
  if (state.scope === scope && state.threadId === threadId) composerStore.setState(updated);
}


function mutate(next: Partial<ComposerState>): void {
  const state = composerStore.getState();
  const updated = { ...state, ...next };
  memory.set(key(updated.scope, updated.threadId), updated);
  composerStore.setState(updated);
}

export function setComposerText(text: string): void {
  const state = composerStore.getState();
  mutate({ text });
  try {
    if (text) secureSet(draftKey(state.scope, state.threadId), text);
    else secureRemove(draftKey(state.scope, state.threadId));
  } catch { /* best effort */ }
}

export function setComposerAttachments(attachments: SendAttachment[], scope?: string, threadId?: string): void {
  if (scope !== undefined && threadId !== undefined) mutateScoped(scope, threadId, { attachments });
  else mutate({ attachments });
}

export function removeComposerAttachment(id: string, scope?: string, threadId?: string): void {
  if (scope !== undefined && threadId !== undefined) {
    const base = memory.get(key(scope, threadId)) || { ...EMPTY, scope, threadId };
    mutateScoped(scope, threadId, { attachments: base.attachments.filter((item) => item.id !== id) });
  } else mutate({ attachments: composerStore.getState().attachments.filter((item) => item.id !== id) });
}

/** Clear only the exact inputs that were sent; never wipe a newer draft. */
export function clearComposerInputs(
  scope: string,
  threadId: string,
  sentText: string,
  sentAttachments: SendAttachment[],
): void {
  const base = memory.get(key(scope, threadId));
  if (!base) return;
  // Keep a newer draft and tray when the user typed or picked while sending.
  const changed = base.text !== sentText ||
    base.attachments.map((item) => item.id).sort().join('|') !== sentAttachments.map((item) => item.id).sort().join('|');
  try { if (!changed) secureRemove(draftKey(scope, threadId)); } catch { /* best effort */ }
  if (changed) return;
  mutateScoped(scope, threadId, { text: '', attachments: [], pendingIdentity: '', clientRequestId: '' });
}
/**
 * A retry of byte-identical input (including model/effort/attachments) keeps
 * its clientRequestId so the host's idempotency guard prevents duplicates.
 */
export function clientRequestIdFor(identity: string): string {
  const state = composerStore.getState();
  if (state.pendingIdentity === identity && state.clientRequestId) return state.clientRequestId;
  const clientRequestId = `app-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  mutate({ pendingIdentity: identity, clientRequestId });
  return clientRequestId;
}

export function clearPendingRequest(): void {
  mutate({ pendingIdentity: '', clientRequestId: '' });
}

export function currentComposerState(): ComposerState {
  return composerStore.getState();
}

/** Pure helper used by send actions and contract tests. */
export function composerRequestPayload(
  state: ComposerState,
  options: { threadId?: string; message: string; send: SendPayload },
): Record<string, unknown> {
  return {
    threadId: options.threadId || state.threadId,
    message: options.message,
    clientRequestId: options.send.clientRequestId,
    ...(options.send.model ? { model: options.send.model } : {}),
    ...(options.send.effort ? { effort: options.send.effort } : {}),
    images: options.send.images,
    files: options.send.files,
  };
}

export function useComposerState(): ComposerState {
  return useStore(composerStore);
}

export default composerStore;
