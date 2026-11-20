/** Pure composer action decisions shared by phone and browser keyboards. */
export type ComposerSubmitDecision =
  | { kind: 'empty' }
  | { kind: 'queue' }
  | { kind: 'send' };

/**
 * A running turn does not refuse the message any more: the same send becomes a
 * queue entry, and the server drains it after the turn. An empty composer never
 * submits, so it falls through to "nothing to send".
 */
export function composerSubmitDecision(input: {
  running: boolean;
  text: string;
  attachmentCount: number;
}): ComposerSubmitDecision {
  const hasContent = Boolean(String(input.text || '').trim()) || input.attachmentCount > 0;
  if (!hasContent) return { kind: 'empty' };
  if (input.running) return { kind: 'queue' };
  return { kind: 'send' };
}

/** Android IMEs report composition as keyCode 229 even when key is Enter. */
export function shouldSubmitOnEnter(input: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode?: number;
}): boolean {
  return input.key === 'Enter'
    && !input.shiftKey
    && !input.isComposing
    && input.keyCode !== 229;
}
