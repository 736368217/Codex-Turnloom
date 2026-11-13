/** Pure composer action decisions shared by phone and browser keyboards. */
export type ComposerSubmitDecision =
  | { kind: 'empty' }
  | { kind: 'blocked-running' }
  | { kind: 'send' };

export function composerSubmitDecision(input: {
  running: boolean;
  text: string;
  attachmentCount: number;
}): ComposerSubmitDecision {
  if (input.running) return { kind: 'blocked-running' };
  if (!String(input.text || '').trim() && input.attachmentCount <= 0) return { kind: 'empty' };
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
