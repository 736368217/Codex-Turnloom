import { secureGet, secureSet, secureRemove } from '../lib/nativeBridge';
const drafts = new Map<string, string>();
function key(scope: string, threadId: string): string { return `turnloom.draft.v2.${encodeURIComponent(scope)}.${encodeURIComponent(threadId)}`; }
export function readDraft(scope: string, threadId: string): string {
  const id = key(scope, threadId);
  if (drafts.has(id)) return drafts.get(id) || '';
  const text = secureGet(id) || '';
  drafts.set(id, text);
  return text;
}
export function saveDraft(scope: string, threadId: string, text: string): void {
  const id = key(scope, threadId);
  drafts.set(id, text);
  if (text) secureSet(id, text); else secureRemove(id);
}
