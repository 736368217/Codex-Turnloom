/**
 * NEGATIVE FIXTURE — this file must never typecheck.
 *
 * `ThreadMessage` used to end with `[key: string]: unknown`, so a misspelled
 * field (`createAt` instead of `createdAt`) compiled silently and the chat
 * screen rendered nothing. The date-separator bug shipped exactly that way.
 * `test/message-type-guard.test.cjs` compiles this file on its own and asserts
 * tsc fails.
 */
import type { ThreadMessage } from '../../app/src/lib/turnloomApi';

export const typo: ThreadMessage = {
  id: 'fixture',
  createAt: '2026-11-22T00:00:00Z'
};
